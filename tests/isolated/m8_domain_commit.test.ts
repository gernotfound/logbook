import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, del, get } from 'idb-keyval';
import { UserDataSchema } from '../../src/lib/schema';
import type { CachedGlobalCatalog, UserData } from '../../src/types';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import { activateGuestSession, GUEST_SESSION_KEY } from '../../src/lib/sync/session';

const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'm8-test',
        updatedAt: '2026-09-15T00:00:00.000Z',
        schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [],
    foods: [],
    cachedAt: 0,
};

vi.mock('../../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: vi.fn(async () => catalog),
}));

const base = (): UserData => UserDataSchema.parse({ profile: { height: '170', gender: 'M' } }) as unknown as UserData;

describe('M8 domain commit durability', () => {
    beforeEach(async () => {
        lockAllVaults();
        localStorage.clear();
        await clear();
        vi.stubGlobal('navigator', { locks: {
            request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
        } });
        await createAndMigrateVault('user:a');
    });
    afterEach(() => {
        lockAllVaults();
        vi.unstubAllGlobals();
    });

    it('keeps the public facade bindings identical to the extracted transactional domain module', async () => {
        const facade = await import('../../src/lib/sync/localRepository');
        const domain = await import('../../src/lib/sync/localDomainCommit');
        expect(facade.commitDomainOperations).toBe(domain.commitDomainOperations);
        expect(facade.WorkoutIntentConflictError).toBe(domain.WorkoutIntentConflictError);
    });

    it('rejects a session-invalidated no-op domain patch without changing durable journal', async () => {
        const { initializeLocal, commitDomainOperations, readLocal } = await import('../../src/lib/sync/localRepository');
        const initial = base();
        await initializeLocal('user:a', initial);
        const before = await readLocal('user:a');
        await expect(commitDomainOperations('user:a', { type: 'profile.patch', patch: { height: '170' } }, initial, () => false))
            .rejects.toThrow('Commit locale invalidato dal cambio sessione');
        expect(await readLocal('user:a')).toEqual(before);
    });

    it('preserves the public identity of the extracted nutrition conflict resolver', async () => {
        const facade = await import('../../src/lib/sync/localRepository');
        const extracted = await import('../../src/lib/sync/localNutritionConflict');
        expect(facade.clearNutritionConflict).toBe(extracted.clearNutritionConflict);
    });

    it('persists business state and semantic journal under the same envelope revision', async () => {
        const { initializeLocal, commitDomainOperations, readLocal } = await import('../../src/lib/sync/localRepository');
        await initializeLocal('user:a', base());

        const result = await commitDomainOperations('user:a', { type: 'profile.patch', patch: { height: '171' } }, base());
        const stored = await readLocal('user:a');
        expect(await get('logbook:v2:user:a')).toMatch(/^tlb-sealed:v1:/);

        expect(result.data.profile?.height).toBe('171');
        expect(result.operations).toHaveLength(1);
        expect(result.operations[0].path).toEqual(['profile', 'height']);
        expect(stored?.data.profile?.height).toBe('171');
        expect(stored?.actorSeq).toBe(1);
        expect(stored?.revision).toBe(1);
        expect(stored?.pending).toEqual(result.operations);
        expect(stored?.clock[stored.actorId]).toBe(1);
    });

    it('persists training-cycle strategy in IndexedDB with its semantic journal', async () => {
        const { initializeLocal, commitDomainOperations, readLocal } = await import('../../src/lib/sync/localRepository');
        const initial = base();
        await initializeLocal('user:a', initial);

        const cycle = {
            id: 'cycle-strategy',
            name: 'Ciclo volume',
            durationWeeks: 6,
            strategy: {
                intent: 'development' as const,
                progressionFocus: 'volume' as const,
                primaryMuscles: ['quads'],
            },
            routines: [],
        };
        const result = await commitDomainOperations(
            'user:a',
            { type: 'training-cycle.upsert', cycle },
            initial,
        );
        const stored = await readLocal('user:a');

        expect(result.data.trainingCycles?.[0]?.strategy).toEqual(cycle.strategy);
        expect(stored?.data.trainingCycles?.[0]?.strategy).toEqual(cycle.strategy);
        expect(stored?.pending.some(operation => operation.path[0] === 'trainingCycles')).toBe(true);
    });

    it('serializes concurrent domain commits without losing either intent', async () => {
        const { initializeLocal, commitDomainOperations, readLocal } = await import('../../src/lib/sync/localRepository');
        const initial = base();
        await initializeLocal('user:a', initial);

        await Promise.all([
            commitDomainOperations('user:a', { type: 'profile.patch', patch: { height: '171' } }, initial),
            commitDomainOperations('user:a', { type: 'profile.patch', patch: { dob: '1990-01-01' } }, initial),
        ]);

        const stored = await readLocal('user:a');
        expect(stored?.data.profile?.height).toBe('171');
        expect(stored?.data.profile?.dob).toBe('1990-01-01');
        expect(stored?.actorSeq).toBe(2);
        expect(new Set(stored?.pending.map(op => op.path.join('/')))).toEqual(new Set(['profile/height', 'profile/dob']));
    });

    it('preserves a pending nutrition conflict and fingerprint through an unrelated domain commit until explicit CAS clear', async () => {
        const { initializeLocal, commitDomainOperations, readLocal, clearNutritionConflict } = await import('../../src/lib/sync/localRepository');
        const { getNutritionConflictFingerprint } = await import('../../src/lib/utils/object');
        const initial = UserDataSchema.parse({
            profile: { height: '170', gender: 'M' },
            nutritionPlanning: { totalKcal: 2500, onDaysCount: 3 },
            pendingConflicts: {
                nutritionPlanning: { totalKcal: 3000, onDaysCount: 4 },
            },
        }) as unknown as UserData;
        const fingerprint = getNutritionConflictFingerprint(initial.pendingConflicts?.nutritionPlanning);
        await initializeLocal('user:a', initial);

        const result = await commitDomainOperations('user:a', {
            type: 'profile.patch',
            patch: { height: '171' },
        }, initial);
        const committed = await readLocal('user:a');

        expect(result.data.profile?.height).toBe('171');
        expect(result.data.nutritionPlanning?.totalKcal).toBe(2500);
        expect(getNutritionConflictFingerprint(committed?.data.pendingConflicts?.nutritionPlanning)).toBe(fingerprint);

        await clearNutritionConflict('user:a', fingerprint);
        const cleared = await readLocal('user:a');

        expect(cleared?.data.profile?.height).toBe('171');
        expect(cleared?.data.nutritionPlanning?.totalKcal).toBe(2500);
        expect(cleared?.data.pendingConflicts?.nutritionPlanning).toBeUndefined();
    });

    it('fences stale-session conflict clearing inside the IndexedDB transaction and preserves the journal', async () => {
        const { initializeLocal, commitDomainOperations, clearNutritionConflict, readLocal } = await import('../../src/lib/sync/localRepository');
        const { getNutritionConflictFingerprint } = await import('../../src/lib/utils/object');
        const initial = UserDataSchema.parse({
            pendingConflicts: { nutritionPlanning: { totalKcal: 3000, onDaysCount: 4 } },
        }) as unknown as UserData;
        const fingerprint = getNutritionConflictFingerprint(initial.pendingConflicts?.nutritionPlanning);
        await initializeLocal('user:a', initial);
        await commitDomainOperations('user:a', { type: 'profile.patch', patch: { height: '171' } }, initial);
        const before = await readLocal('user:a');

        let sessionActive = true;
        const clearing = clearNutritionConflict('user:a', fingerprint, () => sessionActive);
        sessionActive = false;
        await expect(clearing).rejects.toThrow(/invalidata dal cambio sessione/i);
        expect(await readLocal('user:a')).toEqual(before);
    });

    it('does not recreate a missing owner archive from an obsolete nutrition conflict', async () => {
        const { initializeLocal, clearNutritionConflict, readLocal } = await import('../../src/lib/sync/localRepository');
        const { getNutritionConflictFingerprint } = await import('../../src/lib/utils/object');
        const initial = UserDataSchema.parse({
            pendingConflicts: { nutritionPlanning: { totalKcal: 3000, onDaysCount: 4 } },
        }) as unknown as UserData;
        const fingerprint = getNutritionConflictFingerprint(initial.pendingConflicts?.nutritionPlanning);
        await initializeLocal('user:a', initial);
        await del('logbook:v2:user:a');

        await expect(clearNutritionConflict('user:a', fingerprint, () => true))
            .rejects.toThrow(/archivio locale assente/i);
        expect(await readLocal('user:a')).toBeUndefined();
    });

    it('keeps offline activity durable with semantic operations ready for later synchronization', async () => {
        const { initializeLocal, commitDomainOperations, readLocal } = await import('../../src/lib/sync/localRepository');
        const { projectDocuments, applyRemoteDocuments } = await import('../../src/lib/sync/documentProjection');
        const { applySemanticOperations } = await import('../../src/lib/sync/semanticProjection');
        const initial = base();
        await initializeLocal('user:a', initial);

        await commitDomainOperations('user:a', [
            { type: 'activity-steps.set', date: '2026-09-24', steps: 12345, source: 'manual', capturedAt: 100 },
            { type: 'cardio-session.upsert', date: '2026-09-24', session: { id: 'cardio-1', modality: 'bike', durationMinutes: 35, intensity: 'moderate', source: 'manual' } },
        ], initial);
        const stored = await readLocal('user:a');
        expect(stored?.data.nutrition?.['2026-09-24']).toMatchObject({ steps: 12345, cardioSessions: [{ id: 'cardio-1', durationMinutes: 35 }] });
        expect(stored?.pending.some(operation => operation.path.join('/').includes('steps'))).toBe(true);
        expect(stored?.pending.some(operation => operation.path.join('/').includes('cardioSessions/cardio-1'))).toBe(true);

        const remoteBase = projectDocuments(initial, catalog);
        const replayed = applySemanticOperations(remoteBase, stored?.pending ?? []).documents;
        const synchronized = applyRemoteDocuments(initial, replayed, catalog);
        expect(synchronized.nutrition?.['2026-09-24']).toMatchObject({ steps: 12345, cardioSessions: [{ id: 'cardio-1', durationMinutes: 35 }] });
    });

    it('persists exercise deletion and routine cleanup atomically in one envelope revision', async () => {
        const { initializeLocal, commitDomainOperations, readLocal } = await import('../../src/lib/sync/localRepository');
        const { projectDocuments, applyRemoteDocuments } = await import('../../src/lib/sync/documentProjection');
        const { applySemanticOperations } = await import('../../src/lib/sync/semanticProjection');
        const initial = UserDataSchema.parse({
            library: [
                { id: 'e-delete', name: 'Da eliminare', setsCount: 3, sets: [] },
                { id: 'e-keep', name: 'Da mantenere', setsCount: 3, sets: [] },
            ],
            routines: [
                {
                    id: 'r1',
                    name: 'Upper',
                    exercises: [
                        { exId: 'e-delete', setsCount: 3 },
                        { exId: 'e-keep', setsCount: 4 },
                    ],
                },
                { id: 'r2', name: 'Full body', exercises: [{ exId: 'e-delete', setsCount: 2 }] },
            ],
            history: [{
                id: 'w1',
                date: '2026-09-20',
                exercises: [{ id: 'se-delete-history', exId: 'e-delete', sessionNote: '', sets: [] }],
            }],
        }) as unknown as UserData;
        await initializeLocal('user:a', initial);

        const result = await commitDomainOperations('user:a', { type: 'exercise.delete', id: 'e-delete' }, initial);
        const stored = await readLocal('user:a');

        expect(result.data.library?.map(item => item.id)).toEqual(['e-keep']);
        expect(stored?.data.routines?.map(routine => routine.exercises.map(exercise => exercise.exId))).toEqual([['e-keep'], []]);
        expect(stored?.data.history?.[0]?.exercises[0]?.exId).toBe('e-delete');
        expect(stored?.actorSeq).toBe(1);
        expect(stored?.revision).toBe(1);
        expect(stored?.pending).toEqual(result.operations);
        expect(stored?.pending.some(operation => operation.path[0] === 'library')).toBe(true);
        expect(stored?.pending.some(operation => operation.path[0] === 'routines')).toBe(true);

        const replayed = applySemanticOperations(projectDocuments(initial, catalog), stored?.pending ?? []).documents;
        const synchronized = applyRemoteDocuments(initial, replayed, catalog);
        expect(synchronized.library?.map(item => item.id)).toEqual(['e-keep']);
        expect(synchronized.routines?.map(routine => routine.exercises.map(exercise => exercise.exId))).toEqual([['e-keep'], []]);
        expect(synchronized.history?.[0]?.exercises[0]?.exId).toBe('e-delete');
    });

    it('keeps the durable envelope unchanged when exercise deletion is rejected before commit', async () => {
        const { initializeLocal, commitDomainOperations, readLocal } = await import('../../src/lib/sync/localRepository');
        const initial = UserDataSchema.parse({
            library: [{ id: 'e-keep', name: 'Da mantenere', setsCount: 3, sets: [] }],
            routines: [{ id: 'r1', name: 'Upper', exercises: [{ exId: 'e-keep', setsCount: 3 }] }],
        }) as unknown as UserData;
        await initializeLocal('user:a', initial);
        const beforeFailure = await readLocal('user:a');

        await expect(commitDomainOperations('user:a', { type: 'exercise.delete', id: 'invalid/id' }, initial))
            .rejects.toThrow(/identificativo non valido/i);

        const stored = await readLocal('user:a');
        expect(stored).toEqual(beforeFailure);
        expect(stored?.actorSeq).toBe(0);
        expect(stored?.revision).toBe(0);
        expect(stored?.pending).toEqual([]);
    });

    it('rejects a domain commit invalidated before the IndexedDB transaction and does not recreate purged state', async () => {
        const { initializeLocal, commitDomainOperations, readLocal } = await import('../../src/lib/sync/localRepository');
        const initial = base();
        await initializeLocal('user:a', initial);

        let current = false;
        await expect(commitDomainOperations(
            'user:a',
            { type: 'profile.patch', patch: { height: '171' } },
            initial,
            () => current,
        )).rejects.toThrow(/invalidato/i);

        const stored = await readLocal('user:a');
        expect(stored?.data.profile?.height).toBe('170');
        expect(stored?.pending).toEqual([]);
        expect(stored?.actorSeq).toBe(0);
    });

    it('does not enqueue cloud journal operations for guest ownership', async () => {
        const { initializeLocal, commitDomainOperations, readLocal } = await import('../../src/lib/sync/localRepository');
        const initial = base();
        const guestSessionId = 'm8-current-guest-session';
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, guestSessionId);
        activateGuestSession(guestSessionId);
        await createAndMigrateVault('guest');
        await initializeLocal('guest', initial);
        await commitDomainOperations('guest', { type: 'profile.patch', patch: { height: '172' } }, initial);
        const stored = await readLocal('guest');

        expect(stored?.data.profile?.height).toBe('172');
        expect(stored?.pending).toEqual([]);
        expect(stored?.actorSeq).toBe(1);
    });
});
