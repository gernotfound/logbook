import { describe, expect, it } from 'vitest';
import { UserDataSchema } from '../src/lib/schema';
import { formatAdvancedSetSummary, getSetObservedTonnage, getSetTechnique, getSetTotalReps } from '../src/lib/advancedSets';
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

    it('normalizes advanced historical segment values for safe editing', () => {
        const workout = { id: 'w1', exercises: [{ exId: 'bench', sessionNote: '', sets: [{
            id: 's1', kg: 100, reps: 8, technique: 'cluster', segments: [{ id: 'seg1', kg: 90, reps: 4, time: 12, restBeforeSeconds: 15 }],
        }] }] } as unknown as WorkoutSession;
        const editing = prepareHistoricalWorkoutForEditing(workout, runtime);
        expect(editing.exercises[0].sets[0].segments?.[0]).toMatchObject({ kg: '90', reps: '4', time: '12', restBeforeSeconds: 15 });
    });
});
