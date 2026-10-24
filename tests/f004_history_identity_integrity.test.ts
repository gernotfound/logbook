import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/telemetryHub', () => ({
    telemetryHub: { trackError: vi.fn() },
}));

import type { CachedGlobalCatalog, UserData, WorkoutSession } from '../src/types';
import { DomainParsers, UserDataSchema } from '../src/lib/schema';
import { createBackup, decodeImport } from '../src/lib/backup';
import { mergeUserData } from '../src/lib/merge';
import { applyDomainOperations } from '../src/lib/sync/domainOperations';
import { applyRemoteDocuments, projectDocuments } from '../src/lib/sync/documentProjection';
import { initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import { sanitizeHistoryMonthDocument } from '../src/lib/sync/monthlyIntegrity';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { requireUnlockedLocalKey } from '../src/lib/sync/secureArchiveSession';
import { openLocalJson, sealLocalJson, SEALED_LOCAL_PREFIX } from '../src/lib/sync/secureArchiveCipher';

const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'f004-test',
        updatedAt: '2026-09-29T00:00:00.000Z',
        schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [],
    foods: [],
    cachedAt: 0,
};

const validWorkout: WorkoutSession = {
    id: 'workout-ok',
    date: '2026-09-29',
    routineName: 'Upper',
    exercises: [],
    pains: [],
};

const malformedHistory: unknown[] = [
    validWorkout,
    { ...validWorkout, id: '' },
    { ...validWorkout, id: '   ' },
    { ...validWorkout, id: 'bad/id' },
    { ...validWorkout, id: 'undefined' },
    { ...validWorkout, id: true },
    { date: '2026-09-29', exercises: [] },
    null,
    { ...validWorkout, id: 'workout-ok', routineName: 'Duplicate' },
    { ...validWorkout, id: 42, routineName: 'Numeric id' },
    { id: 'recoverable', date: '2026-09-29', waterLiters: '2.5', exercises: 'corrupted' },
];

const expectedIds = ['workout-ok', '42', 'recoverable'];

describe('F-004 training history identity integrity', () => {
    beforeEach(async () => {
        await clear();
    });

    it('quarantines missing, empty, invalid and duplicate workout identities while preserving recoverable records', () => {
        const parsed = DomainParsers.parseHistory(malformedHistory);
        expect(parsed.map(item => item.id)).toEqual(expectedIds);
        expect(parsed.find(item => item.id === 'recoverable')).toMatchObject({
            id: 'recoverable',
            waterLiters: 2.5,
            exercises: [],
        });

        const userData = UserDataSchema.parse({ history: malformedHistory }) as unknown as UserData;
        expect(userData.history?.map(item => item.id)).toEqual(expectedIds);
    });

    it('quarantines ghost workouts during encrypted owner envelope recovery', async () => {
        const owner = 'user:test-user-id';
        await prepareUnlockedTestArchive(owner);
        const base = UserDataSchema.parse({}) as unknown as UserData;
        await initializeLocal(owner, base);

        const key = 'logbook:v2:' + owner;
        const raw = await get<string>(key);
        expect(raw?.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);
        const unlocked = requireUnlockedLocalKey(owner);
        const record = openLocalJson(unlocked, owner, key, raw!) as { data: UserData; baseline: UserData };
        record.data.history = malformedHistory as WorkoutSession[];
        record.baseline.history = malformedHistory as WorkoutSession[];
        await set(key, sealLocalJson(unlocked, owner, key, record));
        expect((await get<string>(key))?.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);

        const envelope = await readLocal(owner);
        expect(envelope?.data.history?.map(item => item.id)).toEqual(expectedIds);
        expect(envelope?.baseline.history?.map(item => item.id)).toEqual(expectedIds);
    });

    it('preserves a prototype-named workout identity as an own monthly record without changing the object prototype', () => {
        // Dynamic business IDs must remain data keys when a remote shard is read.
        // A normal property assignment would invoke the "__proto__" setter and
        // silently drop this record from Object.values() during hydration.
        const unusualId = '__proto__';
        const workout = { ...validWorkout, id: unusualId };
        const month = Object.fromEntries([[unusualId, workout]]);
        const sanitized = sanitizeHistoryMonthDocument('2026-09', month);
        expect(Object.keys(sanitized)).toEqual([unusualId]);
        expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype);
        expect(Object.hasOwn(sanitized, unusualId)).toBe(true);
        expect(sanitized[unusualId]).toMatchObject(workout);

        const base = UserDataSchema.parse({}) as unknown as UserData;
        const hydrated = applyRemoteDocuments(base, new Map([['history_months/2026-09', month]]), catalog);
        expect(hydrated.history?.find(item => item.id === unusualId)).toMatchObject(workout);
        const projected = projectDocuments(hydrated, catalog).get('history_months/2026-09');
        expect(Object.hasOwn(projected ?? {}, unusualId)).toBe(true);
        expect(projected?.[unusualId]).toMatchObject(workout);
    });

    it('does not re-project or re-sync quarantined workouts from history_months', () => {
        const base = UserDataSchema.parse({}) as unknown as UserData;
        const remoteDocuments = new Map<string, Record<string, unknown>>([
            ['history_months/2026-09', {
                'workout-ok': validWorkout,
                empty: { ...validWorkout, id: '' },
                missing: { date: '2026-09-29', exercises: [] },
                invalidType: { ...validWorkout, id: true },
                invalidPath: { ...validWorkout, id: 'bad/id' },
                duplicate: { ...validWorkout, id: 'workout-ok', routineName: 'Duplicate' },
                '42': { ...validWorkout, id: 42, routineName: 'Numeric id' },
                recoverable: { id: 'recoverable', date: '2026-09-29', waterLiters: '2.5', exercises: 'corrupted' },
            }],
        ]);

        const hydrated = applyRemoteDocuments(base, remoteDocuments, catalog);
        expect(hydrated.history?.map(item => String(item.id)).sort()).toEqual(expectedIds.map(String).sort());

        const projected = projectDocuments(hydrated, catalog);
        const historyMonth = projected.get('history_months/2026-09') ?? {};
        expect(Object.keys(historyMonth).sort()).toEqual([...expectedIds].sort());
        expect(Object.values(historyMonth).some((item: any) => !item.id)).toBe(false);
    });

    it('keeps deterministic merge free from ghost and duplicate history records', () => {
        const cloud = { history: malformedHistory } as unknown as UserData;
        const guest = {
            history: [
                { ...validWorkout, id: 'guest-workout', routineName: 'Guest' },
                { ...validWorkout, id: '' },
            ],
        } as unknown as UserData;

        const merged = mergeUserData(cloud, guest);
        expect(merged.history?.map(item => item.id)).toEqual([
            'workout-ok',
            '42',
            'recoverable',
            'guest-workout',
        ]);
    });

    it('rejects invalid and duplicate history identities at the backup import boundary', () => {
        const backup = createBackup(UserDataSchema.parse({}) as unknown as UserData, 'guest') as any;

        backup.userData = { history: [validWorkout, { ...validWorkout, id: '' }] };
        expect(() => decodeImport(backup, 'guest')).toThrow(/identificativo .*valido/i);

        backup.userData = { history: [validWorkout, { ...validWorkout, id: 'bad/id' }] };
        expect(() => decodeImport(backup, 'guest')).toThrow(/identificativo .*valido/i);

        backup.userData = { history: [validWorkout, { ...validWorkout, routineName: 'Duplicate' }] };
        expect(() => decodeImport(backup, 'guest')).toThrow(/identificativo duplicato/i);
    });

    it('keeps history upsert, delete and workout.complete usable after quarantine', () => {
        const hydrated = UserDataSchema.parse({ history: malformedHistory }) as unknown as UserData;

        const upserted = applyDomainOperations(hydrated, {
            type: 'history.upsert',
            workout: { id: 'workout-new', date: '2026-09-29', exercises: [] },
        });
        expect(upserted.history?.some(item => item.id === 'workout-new')).toBe(true);

        const deleted = applyDomainOperations(upserted, {
            type: 'history.delete',
            id: 'workout-ok',
        });
        expect(deleted.history?.some(item => item.id === 'workout-ok')).toBe(false);

        const finished: WorkoutSession = {
            id: 'workout-complete',
            date: '2026-09-29',
            globalStartTime: 100,
            globalEndTime: 200,
            exercises: [],
        };
        const completed = applyDomainOperations(
            { ...deleted, activeWorkout: finished },
            { type: 'workout.complete', workout: finished, expectedActiveWorkoutId: String(finished.id), activePains: [] },
        );
        expect(completed.activeWorkout).toBeNull();
        expect(completed.history?.some(item => item.id === 'workout-complete')).toBe(true);
    });
});
