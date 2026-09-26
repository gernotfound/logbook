import { describe, expect, it } from 'vitest';
import { UserDataSchema } from '../src/lib/schema';
import { formatAdvancedSetSummary, getRoutineSetPlan, getSetObservedTonnage, getSetTechnique, getSetTotalReps } from '../src/lib/advancedSets';
import { calculateSetVolume } from '../src/lib/calc/workout';
import { buildRoutineWorkout, prepareHistoricalWorkoutForEditing } from '../src/hooks/workout/workoutSessionPreparation';
import type { UserData, WorkoutRoutine, WorkoutSession } from '../src/types';

const runtime = (() => {
    let n = 0;
    return { generateId: (prefix: string) => prefix + '_' + (++n), getLocalDateString: () => '2026-09-24', now: () => 1 };
})();

describe('advanced set segments', () => {
    it('keeps legacy dropsets readable without rewriting them', () => {
        const set = { id: 's1', kg: '100', reps: '8', rir: 0, dropsets: [{ id: 'd1', kg: '80', reps: '5' }] };
        expect(getSetTechnique(set)).toBe('dropset');
        expect(getSetTotalReps(set)).toBe(13);
        expect(getSetObservedTonnage(set)).toBe(1200);
        expect(formatAdvancedSetSummary(set)).toContain('Dropset');
        expect(set.rir).toBe(0);
    });

    it('preserves generalized segments through schema parsing', () => {
        const parsed = UserDataSchema.parse({ history: [{ id: 'w1', exercises: [{ exId: 'bench', sessionNote: '', sets: [{
            id: 's1', kg: '100', reps: '8', rir: 0, technique: 'rest_pause',
            segments: [{ id: 'seg1', kg: '100', reps: '3', restBeforeSeconds: 20 }],
        }]}]}] }) as UserData;
        const set = parsed.history![0].exercises[0].sets[0];
        expect(set.technique).toBe('rest_pause');
        expect(set.segments?.[0]).toMatchObject({ kg: '100', reps: '3', restBeforeSeconds: 20 });
        expect(set.rir).toBe(0);
    });

    it('keeps segment persistence limited to the supported structure', () => {
        const parsed = UserDataSchema.parse({ history: [{ id: 'w-meta', exercises: [{ exId: 'bench', sessionNote: '', sets: [{
            id: 's-meta', kg: '100', reps: '8', technique: 'cluster',
            segments: [{
                id: 'seg-meta', kg: '90', reps: '4', restBeforeSeconds: 20,
                unsupportedMetadata: 'ignored',
            }],
        }]}]}] }) as UserData;
        const segment = parsed.history![0].exercises[0].sets[0].segments?.[0];
        expect(segment).toEqual({ id: 'seg-meta', kg: '90', reps: '4', restBeforeSeconds: 20 });
    });

    it('keeps progression contracts limited to supported role and metric', () => {
        const parsed = UserDataSchema.parse({ routines: [{
            id: 'r-meta', name: 'Routine', exercises: [{
                exId: 'bench', setsCount: 1,
                progressionContract: {
                    role: 'primary', metric: 'performance', unsupportedMetadata: 'ignored',
                },
            }],
        }] }) as UserData;
        expect(parsed.routines?.[0].exercises[0].progressionContract).toEqual({
            role: 'primary', metric: 'performance',
        });
    });

    it('applies per-set routine plans without forcing one technique on the exercise', () => {
        const routine = { id: 'r1', name: 'R', exercises: [{ exId: 'bench', setsCount: 3, setPlans: [
            { technique: 'straight' }, { technique: 'cluster', restSeconds: 15, segmentCount: 3 },
            { technique: 'diminishing', target: { type: 'reps', reps: 10 } },
        ] }] } as WorkoutRoutine;
        const workout = buildRoutineWorkout({ library: [{ id: 'bench', name: 'Bench', setsCount: 3, sets: [] }] }, routine, undefined, runtime);
        expect(workout.exercises[0].sets[0].technique).toBeUndefined();
        expect(workout.exercises[0].sets[1].segments).toHaveLength(2);
        expect(workout.exercises[0].sets[1].segments?.every(s => s.restBeforeSeconds === 15)).toBe(true);
        expect(workout.exercises[0].sets[2].target?.reps).toBe(10);
    });

    it('includes generalized segments in observed volume', () => {
        const set = {
            id: 's1', kg: '100', reps: '8', technique: 'rest_pause' as const,
            segments: [{ id: 'seg1', kg: '100', reps: '3', restBeforeSeconds: 20 }],
        };
        expect(calculateSetVolume(set, null, 80)).toBe(1100);
    });

    it('normalizes advanced historical segment values for safe editing', () => {
        const workout = { id: 'w1', exercises: [{ exId: 'bench', sessionNote: '', sets: [{
            id: 's1', kg: 100, reps: 8, technique: 'cluster', segments: [{ id: 'seg1', kg: 90, reps: 4, time: 12, restBeforeSeconds: 15 }],
        }] }] } as unknown as WorkoutSession;
        const editing = prepareHistoricalWorkoutForEditing(workout, runtime);
        expect(editing.exercises[0].sets[0].segments?.[0]).toMatchObject({ kg: '90', reps: '4', time: '12', restBeforeSeconds: 15 });
    });

    it('quarantines malformed or duplicate segment identities at the schema boundary', () => {
        const parsed = UserDataSchema.parse({ history: [{ id: 'w1', exercises: [{ exId: 'bench', sets: [{
            id: 's1', kg: '100', reps: '8', technique: 'cluster',
            segments: [
                { id: 'seg1', kg: '90', reps: '4' },
                { id: 'seg1', kg: '80', reps: '3' },
                { id: '', kg: '70', reps: '2' },
            ],
        }] }] }] }) as UserData;
        expect(parsed.history?.[0].exercises[0].sets[0].segments).toEqual([
            expect.objectContaining({ id: 'seg1', kg: '90', reps: '4' }),
        ]);
    });

    it('round-trips generalized set plans with segment count, rest and targets', () => {
        const plan = getRoutineSetPlan({
            id: 's1', kg: '100', reps: '8', technique: 'rest_pause',
            target: { type: 'reps', reps: 12 },
            segments: [
                { id: 'seg1', kg: '100', reps: '3', restBeforeSeconds: 20 },
                { id: 'seg2', kg: '100', reps: '2', restBeforeSeconds: 20 },
            ],
        });
        expect(plan).toEqual({ technique: 'rest_pause', target: { type: 'reps', reps: 12 }, segmentCount: 3, restSeconds: 20 });
        const routine = { id: 'r2', name: 'R2', exercises: [{ exId: 'bench', setsCount: 1, setPlans: [plan] }] } as WorkoutRoutine;
        const workout = buildRoutineWorkout({ library: [{ id: 'bench', name: 'Bench', setsCount: 3, sets: [] }] }, routine, undefined, runtime);
        expect(workout.exercises[0].sets[0].segments).toHaveLength(2);
        expect(workout.exercises[0].sets[0].target?.reps).toBe(12);
    });

});
