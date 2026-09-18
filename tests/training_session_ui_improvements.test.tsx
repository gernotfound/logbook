import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SessionExerciseCard from '../src/components/Training/session/SessionExerciseCard';
import SessionSetRow from '../src/components/Training/session/SessionSetRow';
import TrainingSession from '../src/components/Training/TrainingSession';
import { useDialogStore } from '../src/store/useDialogStore';
import { useAppStore } from '../src/store/useAppStore';
import { renderWithProviders, emptyUserData } from './setup';
import type { WorkoutSession } from '../src/types';

describe('Training Session UI Improvements Suite (R1, R2, R3)', () => {
    const mockLibrary = [
        { id: 'ex_bench', name: 'Panca Piana', setsCount: 3, trackingType: 'weight_reps' },
        { id: 'ex_plank', name: 'Plank', setsCount: 3, trackingType: 'time' },
        { id: 'ex_treadmill', name: 'Tapis Roulant', setsCount: 1, trackingType: 'cardio' }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.setState({
            userData: {
                ...emptyUserData,
                library: mockLibrary,
                routines: [
                    {
                        id: 'routine_1',
                        name: 'Scheda Petto',
                        exercises: [{ exId: 'ex_bench', setsCount: 3 }]
                    }
                ]
            },
            localWorkout: null,
            syncing: false,
            saveError: null
        });
    });

    describe('R1: Graphic Restyling of Exercises and Sets', () => {
        it('R1.1: Exercises container in TrainingSession does NOT have .card gray background class', () => {
            const activeWorkout: WorkoutSession = {
                id: 'sess_1',
                routineId: 'routine_1',
                routineName: 'Scheda Petto',
                date: '2026-08-20',
                globalStartTime: Date.now(),
                exercises: [
                    {
                        exId: 'ex_bench',
                        sets: [{ id: 's1', kg: '80', reps: '10' }],
                        sessionNote: ''
                    }
                ]
            };

            renderWithProviders(<TrainingSession />, {
                localWorkout: activeWorkout,
                userData: {
                    ...emptyUserData,
                    library: mockLibrary,
                    routines: [{ id: 'routine_1', name: 'Scheda Petto', exercises: [{ exId: 'ex_bench', setsCount: 3 }] }]
                }
            });

            // Heading of routine exists
            const routineHeading = screen.getByText('Scheda Petto');
            expect(routineHeading).toBeDefined();

            // The parent of the exercise list should NOT have the .card class
            const exerciseContainer = routineHeading.parentElement;
            expect(exerciseContainer?.classList.contains('card')).toBe(false);
        });

        it('R1.2: SessionSetRow exposes labeled weight and repetition fields', () => {
            const setObj = { id: 's1', kg: '80', reps: '10' };

            const { container } = render(
                <SessionSetRow
                    set={setObj}
                    sIndex={0}
                    exIndex={0}
                    trackingType="weight_reps"
                    isOpenMenu={false}
                    onToggleMenu={() => {}}
                    onRemoveSet={() => {}}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                />
            );

            const row = container.querySelector('.set-row');
            expect(row).not.toBeNull();
            expect((screen.getByRole('spinbutton', { name: 'Serie 1, chilogrammi', exact: true }) as HTMLInputElement).value).toBe('80');
            expect((screen.getByRole('spinbutton', { name: 'Serie 1, ripetizioni', exact: true }) as HTMLInputElement).value).toBe('10');
        });
    });

    describe('R2: Set Button Layout & Functionality', () => {
        it('R2.1: Renders two side-by-side buttons for "Rimuovi serie" and "Aggiungi serie"', () => {
            const exItem = {
                id: 'item_1',
                exId: 'ex_bench',
                sets: [
                    { id: 's1', kg: '', reps: '' },
                    { id: 's2', kg: '', reps: '' }
                ],
                sessionNote: ''
            };
            const libDef = { id: 'ex_bench', name: 'Panca Piana', trackingType: 'weight_reps' };

            render(
                <SessionExerciseCard
                    exItem={exItem}
                    exIndex={0}
                    libDef={libDef}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={() => {}}
                    onToggleSetup={() => {}}
                    onRemoveExercise={() => {}}
                    onUpdateSetupNote={() => {}}
                    onUpdateSessionNote={() => {}}
                    onAddSet={() => {}}
                    onRemoveSet={() => {}}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onToggleSpecialMenu={() => {}}
                />
            );

            const removeBtn = screen.getByText('- Rimuovi serie');
            const addBtn = screen.getByText('+ Aggiungi serie');

            expect(removeBtn).toBeDefined();
            expect(addBtn).toBeDefined();

            // Check that they share the same parent flex container
            expect(removeBtn.parentElement).toBe(addBtn.parentElement);
            const parentStyle = removeBtn.parentElement?.getAttribute('style') || '';
            expect(parentStyle).toContain('display: flex');
        });

        it('R2.2: "Rimuovi serie" removes only the last set index', async () => {
            const onRemoveSetSpy = vi.fn();
            const exItem = {
                id: 'item_1',
                exId: 'ex_bench',
                sets: [
                    { id: 's1', kg: '', reps: '' },
                    { id: 's2', kg: '', reps: '' },
                    { id: 's3', kg: '', reps: '' }
                ],
                sessionNote: ''
            };
            const libDef = { id: 'ex_bench', name: 'Panca Piana', trackingType: 'weight_reps' };

            render(
                <SessionExerciseCard
                    exItem={exItem}
                    exIndex={0}
                    libDef={libDef}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={() => {}}
                    onToggleSetup={() => {}}
                    onRemoveExercise={() => {}}
                    onUpdateSetupNote={() => {}}
                    onUpdateSessionNote={() => {}}
                    onAddSet={() => {}}
                    onRemoveSet={onRemoveSetSpy}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onToggleSpecialMenu={() => {}}
                />
            );

            const removeBtn = screen.getByText('- Rimuovi serie');
            await act(async () => {
                fireEvent.click(removeBtn);
            });

            // Must call onRemoveSet with index 2 (last element of 3 sets)
            expect(onRemoveSetSpy).toHaveBeenCalledTimes(1);
            expect(onRemoveSetSpy).toHaveBeenCalledWith(0, 2);
        });

        it('R2.3: "Rimuovi serie" is disabled when sets array is empty', async () => {
            const onRemoveSetSpy = vi.fn();
            const exItem = {
                id: 'item_1',
                exId: 'ex_bench',
                sets: [],
                sessionNote: ''
            };
            const libDef = { id: 'ex_bench', name: 'Panca Piana', trackingType: 'weight_reps' };

            render(
                <SessionExerciseCard
                    exItem={exItem}
                    exIndex={0}
                    libDef={libDef}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={() => {}}
                    onToggleSetup={() => {}}
                    onRemoveExercise={() => {}}
                    onUpdateSetupNote={() => {}}
                    onUpdateSessionNote={() => {}}
                    onAddSet={() => {}}
                    onRemoveSet={onRemoveSetSpy}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onToggleSpecialMenu={() => {}}
                />
            );

            const removeBtn = screen.getByText('- Rimuovi serie') as HTMLButtonElement;
            expect(removeBtn.disabled).toBe(true);

            await act(async () => {
                fireEvent.click(removeBtn);
            });

            expect(onRemoveSetSpy).not.toHaveBeenCalled();
        });
    });

    describe('R3: Protection Against Accidental Deletion', () => {
        it('R3.1: Does NOT prompt confirmation if last set is unedited (empty/zero fields)', async () => {
            const showConfirmSpy = vi.spyOn(useDialogStore.getState(), 'showConfirm');
            const onRemoveSetSpy = vi.fn();

            const exItem = {
                id: 'item_1',
                exId: 'ex_bench',
                sets: [
                    { id: 's1', kg: '80', reps: '10' },
                    { id: 's2', kg: '', reps: '' } // Unedited set
                ],
                sessionNote: ''
            };
            const libDef = { id: 'ex_bench', name: 'Panca Piana', trackingType: 'weight_reps' };

            render(
                <SessionExerciseCard
                    exItem={exItem}
                    exIndex={0}
                    libDef={libDef}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={() => {}}
                    onToggleSetup={() => {}}
                    onRemoveExercise={() => {}}
                    onUpdateSetupNote={() => {}}
                    onUpdateSessionNote={() => {}}
                    onAddSet={() => {}}
                    onRemoveSet={onRemoveSetSpy}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onToggleSpecialMenu={() => {}}
                />
            );

            const removeBtn = screen.getByText('- Rimuovi serie');
            await act(async () => {
                fireEvent.click(removeBtn);
            });

            expect(showConfirmSpy).not.toHaveBeenCalled();
            expect(onRemoveSetSpy).toHaveBeenCalledWith(0, 1);
        });

        it('R3.2: Shows confirmation dialog when last set contains weight/reps, and deletes when confirmed', async () => {
            const showConfirmSpy = vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValue(true);
            const onRemoveSetSpy = vi.fn();

            const exItem = {
                id: 'item_1',
                exId: 'ex_bench',
                sets: [
                    { id: 's1', kg: '80', reps: '10' },
                    { id: 's2', kg: '85', reps: '8' } // Filled set
                ],
                sessionNote: ''
            };
            const libDef = { id: 'ex_bench', name: 'Panca Piana', trackingType: 'weight_reps' };

            render(
                <SessionExerciseCard
                    exItem={exItem}
                    exIndex={0}
                    libDef={libDef}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={() => {}}
                    onToggleSetup={() => {}}
                    onRemoveExercise={() => {}}
                    onUpdateSetupNote={() => {}}
                    onUpdateSessionNote={() => {}}
                    onAddSet={() => {}}
                    onRemoveSet={onRemoveSetSpy}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onToggleSpecialMenu={() => {}}
                />
            );

            const removeBtn = screen.getByText('- Rimuovi serie');
            await act(async () => {
                fireEvent.click(removeBtn);
            });

            expect(showConfirmSpy).toHaveBeenCalledTimes(1);
            expect(onRemoveSetSpy).toHaveBeenCalledWith(0, 1);
        });

        it('R3.3: Cancels deletion when user declines confirmation dialog', async () => {
            const showConfirmSpy = vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValue(false);
            const onRemoveSetSpy = vi.fn();

            const exItem = {
                id: 'item_1',
                exId: 'ex_bench',
                sets: [
                    { id: 's1', kg: '80', reps: '10' }
                ],
                sessionNote: ''
            };
            const libDef = { id: 'ex_bench', name: 'Panca Piana', trackingType: 'weight_reps' };

            render(
                <SessionExerciseCard
                    exItem={exItem}
                    exIndex={0}
                    libDef={libDef}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={() => {}}
                    onToggleSetup={() => {}}
                    onRemoveExercise={() => {}}
                    onUpdateSetupNote={() => {}}
                    onUpdateSessionNote={() => {}}
                    onAddSet={() => {}}
                    onRemoveSet={onRemoveSetSpy}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onToggleSpecialMenu={() => {}}
                />
            );

            const removeBtn = screen.getByText('- Rimuovi serie');
            await act(async () => {
                fireEvent.click(removeBtn);
            });

            expect(showConfirmSpy).toHaveBeenCalledTimes(1);
            expect(onRemoveSetSpy).not.toHaveBeenCalled();
        });

        it('R3.4: Detects filled data in time tracking exercises and special sets (dropsets/isometrics)', async () => {
            const showConfirmSpy = vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValue(true);
            const onRemoveSetSpy = vi.fn();

            // Case A: time tracking exercise
            const exItemTime = {
                id: 'item_plank',
                exId: 'ex_plank',
                sets: [{ id: 's_plank', time: '60s' }],
                sessionNote: ''
            };
            const libDefTime = { id: 'ex_plank', name: 'Plank', trackingType: 'time' };

            const { unmount } = render(
                <SessionExerciseCard
                    exItem={exItemTime}
                    exIndex={0}
                    libDef={libDefTime}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={() => {}}
                    onToggleSetup={() => {}}
                    onRemoveExercise={() => {}}
                    onUpdateSetupNote={() => {}}
                    onUpdateSessionNote={() => {}}
                    onAddSet={() => {}}
                    onRemoveSet={onRemoveSetSpy}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onToggleSpecialMenu={() => {}}
                />
            );

            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });

            expect(showConfirmSpy).toHaveBeenCalledTimes(1);
            expect(onRemoveSetSpy).toHaveBeenCalledWith(0, 0);
            unmount();
            showConfirmSpy.mockClear();
            onRemoveSetSpy.mockClear();

            // Case B: Dropset filled
            const exItemDropset = {
                id: 'item_ds',
                exId: 'ex_bench',
                sets: [
                    {
                        id: 's_ds',
                        kg: '',
                        reps: '',
                        dropsets: [{ id: 'ds_1', kg: '50', reps: '6' }]
                    }
                ],
                sessionNote: ''
            };
            const libDefWeight = { id: 'ex_bench', name: 'Panca Piana', trackingType: 'weight_reps' };

            render(
                <SessionExerciseCard
                    exItem={exItemDropset}
                    exIndex={0}
                    libDef={libDefWeight}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={() => {}}
                    onToggleSetup={() => {}}
                    onRemoveExercise={() => {}}
                    onUpdateSetupNote={() => {}}
                    onUpdateSessionNote={() => {}}
                    onAddSet={() => {}}
                    onRemoveSet={onRemoveSetSpy}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onToggleSpecialMenu={() => {}}
                />
            );

            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });

            expect(showConfirmSpy).toHaveBeenCalledTimes(1);
            expect(onRemoveSetSpy).toHaveBeenCalledWith(0, 0);
        });
    });

    describe('Full Session Integration Lifecycle', () => {
        it('Interactively adds and removes sets during an active workout session', async () => {
            const activeWorkout: WorkoutSession = {
                id: 'sess_live',
                routineId: 'routine_1',
                routineName: 'Scheda Petto',
                date: '2026-08-20',
                globalStartTime: Date.now(),
                exercises: [
                    {
                        exId: 'ex_bench',
                        sets: [
                            { id: 's1', kg: '80', reps: '10' },
                            { id: 's2', kg: '80', reps: '10' }
                        ],
                        sessionNote: ''
                    }
                ]
            };

            renderWithProviders(<TrainingSession />, {
                localWorkout: activeWorkout,
                userData: {
                    ...emptyUserData,
                    library: mockLibrary,
                    routines: [{ id: 'routine_1', name: 'Scheda Petto', exercises: [{ exId: 'ex_bench', setsCount: 3 }] }]
                }
            });

            // 1. Add a 3rd set
            const addBtn = screen.getByText('+ Aggiungi serie');
            await act(async () => {
                fireEvent.click(addBtn);
            });

            let currentWorkout = useAppStore.getState().localWorkout;
            expect(currentWorkout?.exercises[0].sets).toHaveLength(3);

            // 2. Remove the empty 3rd set (no confirmation needed)
            const showConfirmSpy = vi.spyOn(useDialogStore.getState(), 'showConfirm');
            const removeBtn = screen.getByText('- Rimuovi serie');

            await act(async () => {
                fireEvent.click(removeBtn);
            });

            expect(showConfirmSpy).not.toHaveBeenCalled();
            currentWorkout = useAppStore.getState().localWorkout;
            expect(currentWorkout?.exercises[0].sets).toHaveLength(2);

            // 3. Remove the filled 2nd set (confirmation confirmed)
            showConfirmSpy.mockResolvedValueOnce(true);
            await act(async () => {
                fireEvent.click(removeBtn);
            });

            expect(showConfirmSpy).toHaveBeenCalledTimes(1);
            currentWorkout = useAppStore.getState().localWorkout;
            expect(currentWorkout?.exercises[0].sets).toHaveLength(1);

            // 4. Remove the 1st filled set down to 0 sets
            showConfirmSpy.mockResolvedValueOnce(true);
            await act(async () => {
                fireEvent.click(removeBtn);
            });

            expect(showConfirmSpy).toHaveBeenCalledTimes(2);
            currentWorkout = useAppStore.getState().localWorkout;
            expect(currentWorkout?.exercises[0].sets).toHaveLength(0);

            // 5. Attempting to remove on 0 sets should be disabled and do nothing
            expect((removeBtn as HTMLButtonElement).disabled).toBe(true);
            await act(async () => {
                fireEvent.click(removeBtn);
            });
            expect(currentWorkout?.exercises[0].sets).toHaveLength(0);
        });

        it('Adversarial: verifies isometry detection and empty dropset handling', async () => {
            const showConfirmSpy = vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValue(true);
            const onRemoveSetSpy = vi.fn();

            // Case A: Isometry with filled time
            const exItemIso = {
                id: 'item_iso',
                exId: 'ex_bench',
                sets: [
                    {
                        id: 's_iso',
                        kg: '',
                        reps: '',
                        isometrics: [{ id: 'iso_1', kg: '', time: '45s' }]
                    }
                ],
                sessionNote: ''
            };
            const libDef = { id: 'ex_bench', name: 'Panca Piana', trackingType: 'weight_reps' };

            const { unmount } = render(
                <SessionExerciseCard
                    exItem={exItemIso}
                    exIndex={0}
                    libDef={libDef}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={() => {}}
                    onToggleSetup={() => {}}
                    onRemoveExercise={() => {}}
                    onUpdateSetupNote={() => {}}
                    onUpdateSessionNote={() => {}}
                    onAddSet={() => {}}
                    onRemoveSet={onRemoveSetSpy}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onToggleSpecialMenu={() => {}}
                />
            );

            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });

            expect(showConfirmSpy).toHaveBeenCalledTimes(1);
            expect(onRemoveSetSpy).toHaveBeenCalledWith(0, 0);

            unmount();
            showConfirmSpy.mockClear();
            onRemoveSetSpy.mockClear();

            // Case B: Unfilled dropset and isometry (all fields empty/zero)
            const exItemEmptySpecials = {
                id: 'item_empty_specials',
                exId: 'ex_bench',
                sets: [
                    {
                        id: 's_empty',
                        kg: '0',
                        reps: '',
                        dropsets: [{ id: 'ds_empty', kg: '', reps: '0' }],
                        isometrics: [{ id: 'iso_empty', kg: '', time: '' }]
                    }
                ],
                sessionNote: ''
            };

            render(
                <SessionExerciseCard
                    exItem={exItemEmptySpecials}
                    exIndex={0}
                    libDef={libDef}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={() => {}}
                    onToggleSetup={() => {}}
                    onRemoveExercise={() => {}}
                    onUpdateSetupNote={() => {}}
                    onUpdateSessionNote={() => {}}
                    onAddSet={() => {}}
                    onRemoveSet={onRemoveSetSpy}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onToggleSpecialMenu={() => {}}
                />
            );

            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });

            // No confirmation prompt since all values are 0 or empty
            expect(showConfirmSpy).not.toHaveBeenCalled();
            expect(onRemoveSetSpy).toHaveBeenCalledWith(0, 0);
        });

        it('Adversarial: verifies numeric zeroes and Italian comma decimal formatting', async () => {
            const showConfirmSpy = vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValue(true);
            const onRemoveSetSpy = vi.fn();
            const libDef = { id: 'ex_bench', name: 'Panca Piana', trackingType: 'weight_reps' };

            // Scenario 1: Zero with decimal comma '0,0' and '0.00' -> Unfilled (no confirm)
            const exZeroes = {
                id: 'item_zeroes',
                exId: 'ex_bench',
                sets: [{ id: 's_z', kg: '0,0', reps: '0.00' }],
                sessionNote: ''
            };

            const { unmount } = render(
                <SessionExerciseCard
                    exItem={exZeroes}
                    exIndex={0}
                    libDef={libDef}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={() => {}}
                    onToggleSetup={() => {}}
                    onRemoveExercise={() => {}}
                    onUpdateSetupNote={() => {}}
                    onUpdateSessionNote={() => {}}
                    onAddSet={() => {}}
                    onRemoveSet={onRemoveSetSpy}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onToggleSpecialMenu={() => {}}
                />
            );

            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });

            expect(showConfirmSpy).not.toHaveBeenCalled();
            expect(onRemoveSetSpy).toHaveBeenCalledWith(0, 0);
            unmount();
            showConfirmSpy.mockClear();
            onRemoveSetSpy.mockClear();

            // Scenario 2: Microplates with decimal comma '2,5' -> Filled (requires confirm)
            const exMicroplates = {
                id: 'item_micro',
                exId: 'ex_bench',
                sets: [{ id: 's_micro', kg: '2,5', reps: '10' }],
                sessionNote: ''
            };

            render(
                <SessionExerciseCard
                    exItem={exMicroplates}
                    exIndex={0}
                    libDef={libDef}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={() => {}}
                    onToggleSetup={() => {}}
                    onRemoveExercise={() => {}}
                    onUpdateSetupNote={() => {}}
                    onUpdateSessionNote={() => {}}
                    onAddSet={() => {}}
                    onRemoveSet={onRemoveSetSpy}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onToggleSpecialMenu={() => {}}
                />
            );

            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });

            expect(showConfirmSpy).toHaveBeenCalledTimes(1);
            expect(onRemoveSetSpy).toHaveBeenCalledWith(0, 0);
        });

        it('Adversarial: verifies onRemoveLastSet prop delegation when provided', async () => {
            const onRemoveLastSetSpy = vi.fn();
            const onRemoveSetSpy = vi.fn();
            const libDef = { id: 'ex_bench', name: 'Panca Piana', trackingType: 'weight_reps' };

            const exItem = {
                id: 'item_delegated',
                exId: 'ex_bench',
                sets: [{ id: 's1', kg: '100', reps: '5' }],
                sessionNote: ''
            };

            render(
                <SessionExerciseCard
                    exItem={exItem}
                    exIndex={0}
                    libDef={libDef}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={() => {}}
                    onToggleSetup={() => {}}
                    onRemoveExercise={() => {}}
                    onUpdateSetupNote={() => {}}
                    onUpdateSessionNote={() => {}}
                    onAddSet={() => {}}
                    onRemoveSet={onRemoveSetSpy}
                    onRemoveLastSet={onRemoveLastSetSpy}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onToggleSpecialMenu={() => {}}
                />
            );

            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });

            expect(onRemoveLastSetSpy).toHaveBeenCalledTimes(1);
            expect(onRemoveSetSpy).not.toHaveBeenCalled();
        });
    });
});
