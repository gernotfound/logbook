import { describe, it, expect, beforeEach, vi } from 'vitest';
import { captureSession } from '../../../src/lib/sync/session';
import { deviceKey, protectedDeviceKey } from '../../../src/lib/sync/deviceStorage';
import { renderHook, act } from '@testing-library/react';
import { useAppStore } from '../../../src/store/useAppStore';
import { useWorkoutSetMutations } from '../../../src/hooks/workout/useWorkoutSetMutations';
import { useWorkoutSession } from '../../../src/hooks/useWorkoutSession';
import type { WorkoutSession } from '../../../src/types';
import { installWorkoutReorderFixture } from './workoutReorderFixture';

describe('Workout exercise reordering hooks and bounds', () => {
    beforeEach(installWorkoutReorderFixture);

    describe('2. Exercise Reordering Logic & Boundary Guards (useWorkoutSetMutations)', () => {
        it('2.1: moveExercise down swaps adjacent exercises correctly', () => {
            const initialWorkout: WorkoutSession = {
                id: 'w1',
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [] },
                    { id: 'se_3', exId: 'ex_pullup', sessionNote: '', sets: [] }
                ]
            };

            let workoutState: WorkoutSession | null = initialWorkout;
            const setLocalWorkout = vi.fn((updater: any) => {
                workoutState = typeof updater === 'function' ? updater(workoutState) : updater;
            });
            const showConfirm = vi.fn().mockResolvedValue(true);

            const { result } = renderHook(() => useWorkoutSetMutations({ setLocalWorkout, showConfirm }));

            act(() => {
                result.current.moveExercise(0, 'down');
            });

            expect(workoutState?.exercises[0].id).toBe('se_2');
            expect(workoutState?.exercises[1].id).toBe('se_1');
            expect(workoutState?.exercises[2].id).toBe('se_3');
        });

        it('2.2: moveExercise up swaps adjacent exercises correctly', () => {
            const initialWorkout: WorkoutSession = {
                id: 'w1',
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [] },
                    { id: 'se_3', exId: 'ex_pullup', sessionNote: '', sets: [] }
                ]
            };

            let workoutState: WorkoutSession | null = initialWorkout;
            const setLocalWorkout = vi.fn((updater: any) => {
                workoutState = typeof updater === 'function' ? updater(workoutState) : updater;
            });
            const showConfirm = vi.fn().mockResolvedValue(true);

            const { result } = renderHook(() => useWorkoutSetMutations({ setLocalWorkout, showConfirm }));

            act(() => {
                result.current.moveExercise(2, 'up');
            });

            expect(workoutState?.exercises[0].id).toBe('se_1');
            expect(workoutState?.exercises[1].id).toBe('se_3');
            expect(workoutState?.exercises[2].id).toBe('se_2');
        });

        it('2.3: Boundary Guard: moving index 0 up does nothing (no mutation)', () => {
            const initialWorkout: WorkoutSession = {
                id: 'w1',
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [] }
                ]
            };

            let workoutState: WorkoutSession | null = initialWorkout;
            const setLocalWorkout = vi.fn((updater: any) => {
                workoutState = typeof updater === 'function' ? updater(workoutState) : updater;
            });
            const showConfirm = vi.fn().mockResolvedValue(true);

            const { result } = renderHook(() => useWorkoutSetMutations({ setLocalWorkout, showConfirm }));

            act(() => {
                result.current.moveExercise(0, 'up'); // targetIndex = -1
            });

            expect(workoutState?.exercises[0].id).toBe('se_1');
            expect(workoutState?.exercises[1].id).toBe('se_2');
        });

        it('2.4: Boundary Guard: moving last index down does nothing (no mutation)', () => {
            const initialWorkout: WorkoutSession = {
                id: 'w1',
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [] }
                ]
            };

            let workoutState: WorkoutSession | null = initialWorkout;
            const setLocalWorkout = vi.fn((updater: any) => {
                workoutState = typeof updater === 'function' ? updater(workoutState) : updater;
            });
            const showConfirm = vi.fn().mockResolvedValue(true);

            const { result } = renderHook(() => useWorkoutSetMutations({ setLocalWorkout, showConfirm }));

            act(() => {
                result.current.moveExercise(1, 'down'); // targetIndex = 2 >= total 2
            });

            expect(workoutState?.exercises[0].id).toBe('se_1');
            expect(workoutState?.exercises[1].id).toBe('se_2');
        });

        it('2.5: reorderExercises with invalid indices returns original state immutably', () => {
            const initialWorkout: WorkoutSession = {
                id: 'w1',
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [] }
                ]
            };

            let workoutState: WorkoutSession | null = initialWorkout;
            const setLocalWorkout = vi.fn((updater: any) => {
                workoutState = typeof updater === 'function' ? updater(workoutState) : updater;
            });
            const showConfirm = vi.fn().mockResolvedValue(true);

            const { result } = renderHook(() => useWorkoutSetMutations({ setLocalWorkout, showConfirm }));

            act(() => {
                result.current.reorderExercises(0, 0); // same index
                result.current.reorderExercises(-1, 0); // negative
                result.current.reorderExercises(0, 5); // out of bounds
            });

            expect(workoutState).toBe(initialWorkout);
            expect(workoutState?.exercises).toBe(initialWorkout.exercises);
            expect(workoutState?.exercises[0]).toBe(initialWorkout.exercises[0]);
            expect(workoutState?.exercises).toEqual([{ id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [] }]);
            expect(setLocalWorkout).toHaveBeenCalledTimes(3);
        });

        it('2.6: moveExercise works via useWorkoutSession hook', async () => {
            const owner = captureSession().owner;
            const initialWorkout: WorkoutSession = {
                id: 'w1',
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [] }
                ]
            };
            useAppStore.setState({ localWorkout: initialWorkout });

            const { result } = renderHook(() => useWorkoutSession());

            act(() => {
                result.current.moveExercise(0, 'down');
            });

            const active = useAppStore.getState().localWorkout;
            expect(active?.exercises[0].id).toBe('se_2');
            expect(active?.exercises[1].id).toBe('se_1');
            expect(localStorage.getItem(protectedDeviceKey('workout', owner))).toMatch(/^tlb-sealed:v1:/);
            expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
        });
    });
});
