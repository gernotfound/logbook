import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithAuthenticatedTestOwner, emptyUserData } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { captureSession } from '../../../src/lib/sync/session';
import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import { Logic } from '../../../src/lib/logic';
import type { WorkoutSession } from '../../../src/types';
import { useAppStore } from '../../../src/store/useAppStore';
import { mockLibrary } from './exerciseSearchTestFixture';

    describe('4. TrainingSession Ad-Hoc Extra Exercise Integration', () => {
        beforeEach(async () => {
            await prepareUnlockedTestArchive('user:test-user-id');
        });

        it('4.1: TrainingSession renders ExerciseSearchDropdown for extra exercises', () => {
            const activeWorkout: WorkoutSession = {
                id: 'w_test_1',
                routineId: 'rot_push',
                routineName: 'Scheda Spinta Base',
                date: Logic.getLocalDateString(),
                globalStartTime: Date.now(),
                exercises: [
                    {
                        exId: 'ex_bench',
                        sessionNote: '',
                        sets: [{ id: 's_1', kg: '80', reps: '8', done: true }]
                    }
                ]
            };

            const initialUserData = {
                profile: {} as any,
                library: mockLibrary as any,
                routines: [
                    {
                        id: 'rot_push',
                        name: 'Scheda Spinta Base',
                        exercises: [{ exId: 'ex_bench', setsCount: 3 }]
                    }
                ],
                trainingCycles: [],
                customFoods: [],
                supplements: [],
                history: [],
                nutrition: {},
                nutritionPlanning: {} as any,
                activeWorkout: null,
                activeCycleId: null
            };

            const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, {
                localWorkout: activeWorkout,
                userData: initialUserData
            });

            // Extra exercise section has search dropdown
            expect(container.textContent).toContain('Aggiungi esercizio');
            const searchInput = (container.querySelector('.exercise-search-container input') ||
                container.querySelector('input[role="combobox"]')) as HTMLInputElement;
            expect(searchInput).not.toBeNull();

            // Search for extra exercise
            fireEvent.change(searchInput, { target: { value: 'plank' } });
            const item = container.querySelector('.exercise-dropdown-item') as HTMLElement;
            expect(item).not.toBeNull();
            expect(item.textContent).toContain('Plank');

            // Click to add extra exercise
            fireEvent.click(item);

            // localWorkout should have 2 exercises
            const state = useAppStore.getState();
            expect(state.localWorkout?.exercises.length).toBe(2);
            expect(state.localWorkout?.exercises[1].exId).toBe('ex_plank');

            // Routine blueprint in userData.routines must remain strictly unchanged
            const blueprint = state.userData?.routines?.find(r => r.id === 'rot_push');
            expect(blueprint?.exercises.length).toBe(1);
            expect(blueprint?.exercises[0].exId).toBe('ex_bench');
        });

        it('4.2: Store snapshot-save preserves ad-hoc exercise IDs in history after flush', async () => {
            const activeWorkout: WorkoutSession = {
                id: 'w_test_2',
                routineId: 'rot_push',
                routineName: 'Scheda Spinta Base',
                date: Logic.getLocalDateString(),
                globalStartTime: Date.now() - 3600000,
                exercises: [
                    {
                        id: 'se_bench',
                        exId: 'ex_bench',
                        sessionNote: '',
                        sets: [{ id: 's_1', kg: '90', reps: '6', done: true }]
                    },
                    {
                        id: 'se_treadmill',
                        exId: 'ex_treadmill',
                        sessionNote: '',
                        sets: [{ id: 's_2', kg: '', reps: '', time: '900', distance: '2.5', speed: '10', done: true }]
                    }
                ]
            };

            const owner = captureSession().owner;
            const initialData = {
                ...emptyUserData,
                library: mockLibrary as any,
                routines: useAppStore.getState().userData?.routines ?? [],
                history: [],
                activeWorkout,
            };
            await initializeLocal(owner, initialData);
            useAppStore.setState({
                localWorkout: activeWorkout,
                userData: initialData,
                dataOwner: owner,
            });

            // Simulate workout finish logic
            const currentWorkout = useAppStore.getState().localWorkout!;
            const finishedWorkout: WorkoutSession = {
                ...currentWorkout,
                globalEndTime: Date.now(),
                globalDurationStr: '01:00:00',
                date: currentWorkout.date
            };

            const pendingSave = useAppStore.getState().saveUserData((prev) => {
                if (!prev) return prev;
                return { ...prev, history: [finishedWorkout, ...(prev.history || [])], activeWorkout: null };
            });
            // Exercise the production flush boundary rather than depending
            // on a debounced cloud timer in this standalone store test.
            await useAppStore.getState().flushPendingSyncs();
            await pendingSave;
            useAppStore.setState({ localWorkout: null });

            const updatedState = useAppStore.getState();
            expect(updatedState.localWorkout).toBeNull();
            expect(updatedState.userData?.history?.length).toBe(1);
            expect(updatedState.userData?.history?.[0]?.exercises.length).toBe(2);
            expect(updatedState.userData?.history?.[0]?.exercises[1]?.exId).toBe('ex_treadmill');

            // Blueprint still unchanged
            const blueprint = updatedState.userData?.routines?.find(r => r.id === 'rot_push');
            expect(blueprint?.exercises.length).toBe(1);

            const durable = await readLocal(owner);
            expect(durable?.data.history).toHaveLength(1);
            expect(durable?.data.history[0]?.exercises.map(exercise => exercise.exId))
                .toEqual(['ex_bench', 'ex_treadmill']);
        });
    })
