import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRoutineExerciseEditor } from '../../../src/hooks/trainingRoutines/useRoutineExerciseEditor';
import type { RoutineExercise } from '../../../src/types';

const original: RoutineExercise[] = [
    { exId: 'bench', setsCount: 2, setPlans: [
        { technique: 'dropset', segmentCount: 3 },
        { technique: 'straight' },
    ] },
    { exId: 'row', setsCount: 1, minReps: 6 },
];

describe('routine exercise editor state', () => {
    it('hydrates the given in-memory draft without altering its exercise order or plans', () => {
        const draft = structuredClone(original);
        const { result } = renderHook(() => useRoutineExerciseEditor(draft));
        expect(result.current.routineExercises).toEqual(original);
        expect(result.current.routineExercises).toBe(draft);
    });

    it('retains uncommitted invalid series input and all per-set techniques until corrected', () => {
        const { result } = renderHook(() => useRoutineExerciseEditor(structuredClone(original)));
        act(() => result.current.handleUpdateSetsCount(0, '2.5'));
        expect(result.current.routineExercises[0].setsCount).toBe('2.5');
        expect(result.current.routineExercises[0].setPlans).toEqual(original[0].setPlans);
        act(() => result.current.handleUpdateSetsCount(0, '3'));
        expect(result.current.routineExercises[0].setsCount).toBe(3);
        expect(result.current.routineExercises[0].setPlans).toEqual([
            { technique: 'dropset', segmentCount: 3 },
            { technique: 'straight' },
            { technique: 'straight' },
        ]);
        expect(original[0].setsCount).toBe(2);
    });

    it('retains advanced set targets and updates the intended exercise only', () => {
        const { result } = renderHook(() => useRoutineExerciseEditor(structuredClone(original)));
        act(() => result.current.handleUpdateSetPlanField(0, 0, 'restSeconds', '90'));
        act(() => result.current.handleUpdateSetPlanField(0, 0, 'targetReps', '8'));
        act(() => result.current.handleUpdateSetPlanField(0, 0, 'segmentCount', '4'));
        expect(result.current.routineExercises[0].setPlans?.[0]).toEqual({
            technique: 'dropset', restSeconds: 90, segmentCount: 4,
            target: { type: 'reps', reps: 8 },
        });
        expect(result.current.routineExercises[1]).toEqual(original[1]);
    });

    it('updates exercise metadata, positions and removal without mutating the original draft', () => {
        const input = structuredClone(original);
        const { result } = renderHook(() => useRoutineExerciseEditor(input));
        act(() => result.current.handleUpdateExerciseMetadata(0, 'technicalStandard', 'Pausa controllata'));
        act(() => result.current.handleUpdateExerciseMetadata(0, 'role', 'primary'));
        act(() => result.current.handleUpdateReps(1, 'maxReps', '12'));
        expect(result.current.routineExercises[0]).toEqual(expect.objectContaining({
            technicalStandard: 'Pausa controllata', progressionContract: { role: 'primary' },
        }));
        expect(result.current.routineExercises[1].maxReps).toBe(12);
        act(() => result.current.moveExercise(0, 1));
        expect(result.current.routineExercises.map(ex => ex.exId)).toEqual(['row', 'bench']);
        act(() => result.current.handleRemoveExerciseFromRoutine(0));
        expect(result.current.routineExercises.map(ex => ex.exId)).toEqual(['bench']);
        expect(input).toEqual(original);
    });

    it('does not manufacture undefined exercises when a delayed UI callback uses a stale index', () => {
        const { result } = renderHook(() => useRoutineExerciseEditor(structuredClone(original)));
        const before = result.current.routineExercises;
        act(() => {
            result.current.handleUpdateSetsCount(5, '3');
            result.current.handleUpdateSetsCount(-1, '3');
            result.current.handleUpdateReps(5, 'minReps', '8');
            result.current.handleUpdateSetPlan(5, 0, 'cluster');
            result.current.handleUpdateSetPlanField(5, 0, 'segmentCount', '4');
            result.current.handleUpdateExerciseMetadata(5, 'technicalStandard', 'Stale');
            result.current.handleRemoveExerciseFromRoutine(5);
            result.current.moveExercise(5, -1);
            result.current.moveExercise(-1, 1);
            result.current.moveExercise(0, 3);
        });
        expect(result.current.routineExercises).toBe(before);
        expect(result.current.routineExercises).toHaveLength(2);
        expect(result.current.routineExercises.map(ex => ex.exId)).toEqual(['bench', 'row']);
    });

    it('removes the originally confirmed item after a reorder, not its former neighbor', () => {
        const { result } = renderHook(() => useRoutineExerciseEditor(structuredClone(original)));
        const selected = result.current.routineExercises[0];
        act(() => result.current.moveExercise(0, 1));
        expect(result.current.routineExercises.map(item => item.exId)).toEqual(['row', 'bench']);

        act(() => result.current.handleRemoveExerciseFromRoutine(0, selected));
        expect(result.current.routineExercises.map(item => item.exId)).toEqual(['row']);
    });

    it('preserves an edited item when an old delete confirmation resolves afterward', () => {
        const { result } = renderHook(() => useRoutineExerciseEditor(structuredClone(original)));
        const selected = result.current.routineExercises[0];
        act(() => result.current.handleUpdateSetPlan(0, 0, 'cluster'));
        const edited = result.current.routineExercises;
        expect(edited[0]).not.toBe(selected);

        act(() => result.current.handleRemoveExerciseFromRoutine(0, selected));
        expect(result.current.routineExercises).toBe(edited);
        expect(result.current.routineExercises.map(item => item.exId)).toEqual(['bench', 'row']);
    });

    it('fails closed when a recovery payload unexpectedly reuses the same item object twice', () => {
        const selected = structuredClone(original[0]);
        const { result } = renderHook(() => useRoutineExerciseEditor([selected, selected]));
        const before = result.current.routineExercises;
        act(() => result.current.handleRemoveExerciseFromRoutine(1, selected));
        expect(result.current.routineExercises).toBe(before);
    });

    it('ignores an invalid set index without replacing a valid exercise snapshot', () => {
        const { result } = renderHook(() => useRoutineExerciseEditor(structuredClone(original)));
        const before = result.current.routineExercises;
        act(() => {
            result.current.handleUpdateSetPlan(0, 7, 'dropset');
            result.current.handleUpdateSetPlanField(0, -1, 'restSeconds', '90');
        });
        expect(result.current.routineExercises).toBe(before);
    });
});
