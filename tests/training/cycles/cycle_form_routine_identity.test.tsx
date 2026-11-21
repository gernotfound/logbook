import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCycleForm } from '../../../src/components/Training/planning/useCycleForm';

const seed = [
    { routineId: 'a', frequencyPerWeek: 1 },
    { routineId: 'b', frequencyPerWeek: 1 },
    { routineId: 'c', frequencyPerWeek: 1 },
];

describe('cycle editor: stable routine identity during queued updates', () => {
    it('moves the intended routine after a removal batched in the same React update', () => {
        const { result } = renderHook(() => useCycleForm({
            routines: [],
            onSave: vi.fn(),
            showAlert: vi.fn(async () => undefined),
        }));
        act(() => result.current.state.setCycleRoutines(seed));

        act(() => {
            result.current.handlers.handleRemoveRoutine('b');
            result.current.handlers.handleMoveRoutine('c', -1);
        });

        expect(result.current.state.cycleRoutines.map(routine => routine.routineId)).toEqual(['c', 'a']);
        expect(result.current.state.cycleRoutines.every(routine => Boolean(routine.routineId))).toBe(true);
    });

    it('does not move or delete a different routine when an ID becomes stale', () => {
        const { result } = renderHook(() => useCycleForm({
            routines: [],
            onSave: vi.fn(),
            showAlert: vi.fn(async () => undefined),
        }));
        act(() => result.current.state.setCycleRoutines(seed));
        act(() => {
            result.current.handlers.handleRemoveRoutine('b');
            result.current.handlers.handleMoveRoutine('b', 1);
            result.current.handlers.handleRemoveRoutine('unknown');
        });
        expect(result.current.state.cycleRoutines.map(routine => routine.routineId)).toEqual(['a', 'c']);

        act(() => {
            result.current.handlers.handleMoveRoutine('a', -1);
            result.current.handlers.handleMoveRoutine('c', 1);
        });
        expect(result.current.state.cycleRoutines.map(routine => routine.routineId)).toEqual(['a', 'c']);
    });
});
