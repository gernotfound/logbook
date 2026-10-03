import { beforeEach, describe, expect, it } from 'vitest';
import { UserDataSchema } from '../src/lib/schema';
import { mergeUserData } from '../src/lib/merge';
import type { CachedGlobalCatalog, UserData, WorkoutSession } from '../src/types';
import { diffDocuments } from '../src/lib/sync/semanticProjection';
import { applyDomainOperations } from '../src/lib/sync/domainOperations';
import { assertHistoryMonthDocument, assertNutritionMonthDocument, requireCanonicalWorkoutDate } from '../src/lib/sync/monthlyIntegrity';
import { classifySyncFailure } from '../src/lib/sync/syncFailure';
import { useAppStore } from '../src/store/useAppStore';
import { getInitialLocalWorkout } from '../src/store/slices/createWorkoutSlice';
import { deviceKey } from '../src/lib/sync/deviceStorage';
import { clearAuthenticatedOwnerHint, readAuthenticatedOwnerHint, rememberAuthenticatedOwner } from '../src/lib/sync/authOwnerHint';
import { storageOwner } from '../src/lib/sync/session';
import { auth } from '../src/lib/firebase';

const parse = (value: unknown): UserData => UserDataSchema.parse(value) as unknown as UserData;

const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'audit-remediation',
        updatedAt: '2026-10-03T00:00:00.000Z',
        schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [],
    foods: [],
    cachedAt: 0,
};

function workout(id: string, exerciseIds: Array<[string, string]> = []): WorkoutSession {
    return {
        id,
        date: '2026-10-03',
        exercises: exerciseIds.map(([instanceId, exId], index) => ({
            id: instanceId,
            exId,
            sessionNote: '',
            sets: [{ id: `s-${index}`, kg: '10', reps: '10' }],
        })),
    };
}

describe('AUDIT 01-04 remediation invariants', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('uses one strict business-identity contract at the UserData gateway and strips unknown top-level fields', () => {
        const parsed = parse({
            routines: [
                { id: 'bad/id', name: 'Bad', exercises: [] },
                { id: 'undefined', name: 'Bad sentinel', exercises: [] },
                { id: 'ok', name: 'Good', exercises: [] },
            ],
            extension: { shadow: true },
        });

        expect(parsed.routines?.map(item => item.id)).toEqual(['ok']);
        expect(parsed).not.toHaveProperty('extension');
    });

    it('quarantines nested workout ghosts before semantic synchronization', () => {
        const parsed = parse({
            history: [{
                id: 'w-1',
                date: '2026-10-03',
                exercises: [
                    { exId: 'bench', sessionNote: '', sets: [] },
                    {
                        id: 'se-1',
                        exId: 'bench',
                        sessionNote: '',
                        sets: [
                            { kg: '80', reps: '8' },
                            { id: 's-1', kg: '80', reps: '8' },
                            { id: 's-1', kg: '82', reps: '8' },
                        ],
                    },
                    { id: 'se-1', exId: 'squat', sessionNote: '', sets: [] },
                ],
            }],
        });

        expect(parsed.history?.[0]?.exercises).toHaveLength(1);
        expect(parsed.history?.[0]?.exercises[0]).toMatchObject({ id: 'se-1', exId: 'bench' });
        expect(parsed.history?.[0]?.exercises[0].sets).toHaveLength(1);
        expect(parsed.history?.[0]?.exercises[0].sets[0].id).toBe('s-1');
    });

    it('keys workout exercise instances by SessionExercise.id even when exId is repeated', () => {
        const base = new Map<string, Record<string, unknown>>([
            ['', { activeWorkout: workout('w-1', [['se-1', 'bench']]) }],
        ]);
        const desired = new Map<string, Record<string, unknown>>([
            ['', { activeWorkout: workout('w-1', [['se-1', 'bench'], ['se-2', 'bench']]) }],
        ]);

        const operations = diffDocuments(base, desired, 'actor', 1, { actor: 1 });

        expect(operations.some(op => op.path.join('/') === 'activeWorkout/exercises')).toBe(false);
        expect(operations).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: ['activeWorkout', 'exercises', '$order'], value: ['se-1', 'se-2'] }),
            expect.objectContaining({ path: ['activeWorkout', 'exercises', 'se-2'] }),
        ]));
    });

    it('rejects stale workout completion and deletes catalog override fields with explicit undefined', () => {
        const before = parse({
            activeWorkout: workout('w-current'),
            catalogOverrides: {
                exercises: { bench: { name: 'Bench custom', notes: 'keep' } },
                foods: {},
                hiddenExerciseIds: [],
                hiddenFoodIds: [],
            },
        });

        expect(() => applyDomainOperations(before, {
            type: 'workout.complete',
            workout: workout('w-stale'),
            activePains: [],
        })).toThrow(/non corrisponde alla sessione attiva/i);

        const patched = applyDomainOperations(before, {
            type: 'catalog.exercise.patch',
            id: 'bench',
            patch: { name: undefined },
        });
        expect(patched.catalogOverrides?.exercises?.bench).toEqual({ notes: 'keep' });
    });

    it('enforces path/key/embedded temporal identity for monthly shards and forbids implicit today fallback', () => {
        expect(() => assertHistoryMonthDocument('2026-09', {
            'w-1': workout('w-1'),
        })).toThrow(/appartiene a 2026-10/i);

        expect(() => assertNutritionMonthDocument('2026-10', {
            '2026-10-03': { date: '2026-10-04', kcal: 0, carbs: 0, pro: 0, fat: 0 },
        })).toThrow(/diversa da day.date/i);

        expect(() => requireCanonicalWorkoutDate({})).toThrow(/identità temporale/i);
    });

    it('preserves guest local-only conflicts during guest-to-account merge', () => {
        const cloud = parse({});
        const guest = parse({
            pendingConflicts: {
                nutritionPlanning: { onDaysCount: 4, totalKcal: 2400 },
            },
        });

        const merged = mergeUserData(cloud, guest);
        expect(merged.pendingConflicts?.nutritionPlanning).toMatchObject({ onDaysCount: 4, totalKcal: 2400 });
    });

    it('treats App Check unavailability as durable local-pending rather than failed', () => {
        const error = Object.assign(new Error('App Check unavailable'), { code: 'app-check-unavailable' });
        expect(classifySyncFailure(error).status).toBe('local-pending');
    });

    it('recovers the device workout synchronously from the durable envelope shadow when device storage is missing', () => {
        const owner = 'user:recovery';
        const durable = workout('w-recovered', [['se-1', 'bench']]);

        const recovered = getInitialLocalWorkout(owner, durable);

        expect(recovered?.id).toBe('w-recovered');
        expect(JSON.parse(localStorage.getItem(deviceKey('workout', owner))!)).toMatchObject({ id: 'w-recovered' });
    });

    it('persists and clears a strict authenticated owner hint without consulting Firebase Auth', () => {
        expect(readAuthenticatedOwnerHint()).toBeNull();
        expect(rememberAuthenticatedOwner('abc')).toBe('user:abc');
        expect(readAuthenticatedOwnerHint()).toBe('user:abc');
        clearAuthenticatedOwnerHint('user:abc');
        expect(readAuthenticatedOwnerHint()).toBeNull();
    });

    it('keeps the hinted authenticated owner authoritative while Firebase Auth is still unresolved', () => {
        const previous = (auth as any).currentUser;
        try {
            (auth as any).currentUser = null;
            rememberAuthenticatedOwner('offline-user');
            expect(storageOwner()).toBe('user:offline-user');
        } finally {
            (auth as any).currentUser = previous;
            clearAuthenticatedOwnerHint();
        }
    });

    it('keeps setLocalWorkout strictly device-local and leaves cloud-facing UserData untouched', () => {
        const live = workout('live');
        const historical = { ...workout('history'), isEditingHistory: true };
        useAppStore.setState({
            userData: parse({ activeWorkout: live }),
            localWorkout: live,
            localPersistenceBlocked: false,
        });

        useAppStore.getState().setLocalWorkout(historical);

        expect(useAppStore.getState().localWorkout?.id).toBe('history');
        expect(useAppStore.getState().userData?.activeWorkout?.id).toBe('live');
    });
});
