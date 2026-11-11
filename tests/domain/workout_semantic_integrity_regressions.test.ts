import { beforeEach, describe, expect, it } from 'vitest';
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData, WorkoutSession } from '../../src/types';
import { diffDocuments } from '../../src/lib/sync/semanticProjection';
import { applyDomainOperations } from '../../src/lib/sync/domainOperations';

const parse = (value: unknown): UserData => UserDataSchema.parse(value) as unknown as UserData;

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

describe('Workout and catalog semantic operation integrity', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('rejects nested workout ghosts at the domain persistence boundary', () => {
        const malformed = {
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
                    ],
                },
            ],
        } as WorkoutSession;

        expect(() => applyDomainOperations(parse({}), {
            type: 'active-workout.set',
            workout: malformed,
        })).toThrow(/identificativo non valido/i);
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
            expectedActiveWorkoutId: 'w-stale',
            activePains: [],
        })).toThrow(/non corrisponde alla sessione attiva/i);

        const patched = applyDomainOperations(before, {
            type: 'catalog.exercise.patch',
            id: 'bench',
            patch: { name: undefined },
        });
        expect(patched.catalogOverrides?.exercises?.bench).toEqual({ notes: 'keep' });
    });
});
