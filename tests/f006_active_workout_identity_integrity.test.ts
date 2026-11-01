import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/telemetryHub', () => ({
    telemetryHub: { trackError: vi.fn() },
}));

import type { CachedGlobalCatalog, UserData, WorkoutSession } from '../src/types';
import { DomainParsers, UserDataSchema, WorkoutSessionSchema } from '../src/lib/schema';
import { createBackup, decodeImport, prepareImport } from '../src/lib/backup';
import { applyDomainOperations } from '../src/lib/sync/domainOperations';
import { applyRemoteDocuments, projectDocuments } from '../src/lib/sync/documentProjection';
import { initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../src/lib/sync/deviceStorage';
import { updateArchiveRecord } from '../src/lib/sync/secureArchiveRepository';
import { persistPlainWorkoutSnapshot, unwrapWorkoutDeviceSnapshot } from '../src/lib/sync/workoutDeviceIntent';
import { captureSession } from '../src/lib/sync/session';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { DeviceWorkoutCorruptError, getInitialLocalWorkout } from '../src/store/slices/createWorkoutSlice';
import { useAppStore } from '../src/store/useAppStore';

const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'f006-test',
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
    id: 'active-ok',
    date: '2026-09-29',
    routineName: 'Upper',
    globalStartTime: 100,
    exercises: [],
    pains: [],
};

const invalidActiveWorkouts: unknown[] = [
    { ...validWorkout, id: '' },
    { ...validWorkout, id: '   ' },
    { ...validWorkout, id: 'undefined' },
    { ...validWorkout, id: 'null' },
    { ...validWorkout, id: 'bad/id' },
    { ...validWorkout, id: true },
    { date: '2026-09-29', exercises: [] },
    {},
];

describe('F-006 active workout persisted business identity', () => {
    beforeEach(async () => {
        await clear();
        localStorage.clear();
        useAppStore.setState({ userData: null, localWorkout: null });
    });

    it('keeps generic transient workout parsing id-optional while quarantining persisted activeWorkout identities', () => {
        const transient = WorkoutSessionSchema.parse({ date: '2026-09-29', exercises: [] });
        expect(transient.id).toBeUndefined();

        for (const invalid of invalidActiveWorkouts) {
            expect(DomainParsers.parseActiveWorkout(invalid)).toBeNull();
            const parsed = UserDataSchema.parse({ activeWorkout: invalid }) as unknown as UserData;
            expect(parsed.activeWorkout).toBeNull();
        }

        expect(DomainParsers.parseActiveWorkout({ ...validWorkout, id: '  active-trimmed  ' })?.id).toBe('active-trimmed');
        expect(DomainParsers.parseActiveWorkout({ ...validWorkout, id: 42 })?.id).toBe('42');
        expect(DomainParsers.parseActiveWorkout(validWorkout)).toMatchObject(validWorkout);
    });

    it('quarantines malformed active workouts from IndexedDB and device-local recovery without losing valid sessions', async () => {
        const base = UserDataSchema.parse({}) as unknown as UserData;
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        await initializeLocal(owner, base);

        const key = 'logbook:v2:' + owner;
        await updateArchiveRecord<any>(owner, raw => ({
            ...raw,
            data: { ...raw.data, activeWorkout: { date: '2026-09-29', exercises: [] } },
            baseline: { ...raw.baseline, activeWorkout: { ...validWorkout, id: 'bad/id' } },
        }));
        expect(await get<string>(key)).toMatch(/^tlb-sealed:v1:/);

        const envelope = await readLocal(owner);
        expect(envelope?.data.activeWorkout).toBeNull();
        expect(envelope?.baseline.activeWorkout).toBeNull();

        // A new bootstrap cannot replace an existing durable envelope.
        // Reset the test fixture explicitly before seeding its next lifecycle.
        await clear();
        await prepareUnlockedTestArchive(owner);
        await initializeLocal(owner, UserDataSchema.parse({ activeWorkout: validWorkout }) as unknown as UserData);
        expect(await get<string>(key)).toMatch(/^tlb-sealed:v1:/);
        expect((await readLocal(owner))?.data.activeWorkout).toMatchObject(validWorkout);

        const sealedKey = protectedDeviceKey('workout', owner);
        writeDeviceValue('workout', JSON.stringify({ date: '2026-09-29', exercises: [] }), owner);
        const invalidCiphertext = localStorage.getItem(sealedKey);
        expect(invalidCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(() => getInitialLocalWorkout(owner)).toThrow(DeviceWorkoutCorruptError);
        expect(localStorage.getItem(sealedKey)).toBe(invalidCiphertext);

        persistPlainWorkoutSnapshot(validWorkout, owner);
        expect(getInitialLocalWorkout(owner)).toMatchObject(validWorkout);
        expect(localStorage.getItem(sealedKey)).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
    });

    it('does not adopt or persist a malformed remote active workout into runtime state', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const base = UserDataSchema.parse({}) as unknown as UserData;
        useAppStore.getState().setUserData({
            ...base,
            activeWorkout: { date: '2026-09-29', exercises: [] } as WorkoutSession,
        });

        expect(useAppStore.getState().userData?.activeWorkout).toBeNull();
        expect(useAppStore.getState().localWorkout).toBeNull();
        expect(localStorage.getItem(protectedDeviceKey('workout', owner))).toBeNull();
        expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();

        useAppStore.getState().setUserData({ ...base, activeWorkout: validWorkout });
        expect(useAppStore.getState().userData?.activeWorkout).toMatchObject(validWorkout);
        expect(useAppStore.getState().localWorkout).toMatchObject(validWorkout);
        expect(localStorage.getItem(protectedDeviceKey('workout', owner))).toMatch(/^tlb-sealed:v1:/);
        const recovered = unwrapWorkoutDeviceSnapshot(JSON.parse(readDeviceValueStrict('workout', owner)!), owner).workout;
        expect(recovered).toMatchObject(validWorkout);
        expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
    });

    it('quarantines malformed cloud activeWorkout before resume and does not re-project it', () => {
        const base = UserDataSchema.parse({}) as unknown as UserData;
        const malformedRemote = new Map<string, Record<string, unknown>>([
            ['', { activeWorkout: { date: '2026-09-29', exercises: [] } }],
        ]);

        const hydrated = applyRemoteDocuments(base, malformedRemote, catalog);
        expect(hydrated.activeWorkout).toBeNull();
        expect(projectDocuments(hydrated, catalog).get('')?.activeWorkout).toBeNull();

        const validRemote = new Map<string, Record<string, unknown>>([
            ['', { activeWorkout: validWorkout }],
        ]);
        const validHydrated = applyRemoteDocuments(base, validRemote, catalog);
        expect(validHydrated.activeWorkout).toMatchObject(validWorkout);
        expect(projectDocuments(validHydrated, catalog).get('')?.activeWorkout).toMatchObject(validWorkout);
    });

    it('rejects malformed activeWorkout during backup restore without changing or sanitizing the source backup', () => {
        const current = UserDataSchema.parse({ profile: { height: '180' } }) as unknown as UserData;
        const backup = createBackup(current, 'guest') as any;
        backup.userData = {
            ...current,
            profile: { height: '181' },
            activeWorkout: { date: '2026-09-29', exercises: [] },
        };

        const original = structuredClone(backup);
        expect(() => decodeImport(backup, 'guest')).toThrow('allenamento attivo non valido');
        expect(backup).toEqual(original);
        expect(current.profile?.height).toBe('180');

        backup.userData = { ...current, activeWorkout: null };
        expect(prepareImport(current, decodeImport(backup, 'guest').data, 'restore').data.activeWorkout).toBeNull();

        backup.userData = { ...current, activeWorkout: validWorkout };
        const validRestored = prepareImport(current, decodeImport(backup, 'guest').data, 'restore').data;
        expect(validRestored.activeWorkout).toMatchObject(validWorkout);
    });

    it('preserves the normal resume -> modify -> complete cycle for a valid recovered workout', () => {
        const recovered = UserDataSchema.parse({ activeWorkout: validWorkout }) as unknown as UserData;
        const modifiedWorkout: WorkoutSession = {
            ...validWorkout,
            moodRating: 4,
        };

        const modified = applyDomainOperations(recovered, {
            type: 'active-workout.set',
            workout: modifiedWorkout,
        });
        expect(modified.activeWorkout).toMatchObject({ id: 'active-ok', moodRating: 4 });

        const finishedWorkout: WorkoutSession = {
            ...modifiedWorkout,
            globalEndTime: 200,
            globalDurationStr: '00:01:40',
        };
        const completed = applyDomainOperations(modified, {
            type: 'workout.complete',
            workout: finishedWorkout,
            expectedActiveWorkoutId: String(finishedWorkout.id),
            activePains: [],
        });

        expect(completed.activeWorkout).toBeNull();
        expect(completed.history?.[0]).toMatchObject({ id: 'active-ok', moodRating: 4 });
    });
});
