import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import SessionExerciseCard from '../../../src/components/Training/session/SessionExerciseCard';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import { useDialogStore } from '../../../src/store/useDialogStore';
import { useAppStore } from '../../../src/store/useAppStore';
import { captureSession, invalidateSession } from '../../../src/lib/sync/session';
import { initializeLocal } from '../../../src/lib/sync/localRepository';
import { renderWithAuthenticatedTestOwner, emptyUserData } from '../../setup';
import type { WorkoutSession } from '../../../src/types';
import { setupTrainingSessionUiFixture, mockLibrary } from './trainingSessionUiFixture';

describe('active workout lifecycle', () => {
    beforeEach(setupTrainingSessionUiFixture);

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
                        id: 'session-instance-bench',
                        exId: 'ex_bench',
                        sets: [
                            { id: 's1', kg: '80', reps: '10' },
                            { id: 's2', kg: '80', reps: '10' }
                        ],
                        sessionNote: ''
                    }
                ]
            };

            const owner = captureSession().owner;
            const initialData = {
                ...emptyUserData,
                library: mockLibrary,
                routines: [{ id: 'routine_1', name: 'Scheda Petto', exercises: [{ exId: 'ex_bench', setsCount: 3 }] }],
                activeWorkout,
            };
            await initializeLocal(owner, initialData);
            renderWithAuthenticatedTestOwner(<TrainingSession />, {
                localWorkout: activeWorkout,
                userData: initialData,
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
            await waitFor(() => {
                expect(useAppStore.getState().localWorkout?.exercises[0].sets).toHaveLength(1);
            });
            currentWorkout = useAppStore.getState().localWorkout;

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
            expect(useAppStore.getState().localWorkout?.exercises[0].sets).toHaveLength(0);
            expect(showConfirmSpy).toHaveBeenCalledTimes(2);
        });

        it('preserves newly edited set data while a row deletion confirmation is pending', async () => {
            const activeWorkout: WorkoutSession = {
                id: 'pending-row-delete',
                routineId: 'routine_1',
                routineName: 'Scheda Petto',
                date: '2026-08-20',
                globalStartTime: Date.now(),
                exercises: [{
                    id: 'session-bench',
                    exId: 'ex_bench',
                    sets: [{ id: 'set-one', kg: '80', reps: '10' }],
                    sessionNote: ''
                }]
            };
            const owner = captureSession().owner;
            const initialData = {
                ...emptyUserData,
                library: mockLibrary,
                routines: [{ id: 'routine_1', name: 'Scheda Petto', exercises: [{ exId: 'ex_bench', setsCount: 3 }] }],
                activeWorkout
            };
            await initializeLocal(owner, initialData);
            let confirmDeletion!: (accepted: boolean) => void;
            const pendingConfirmation = new Promise<boolean>(resolve => { confirmDeletion = resolve; });
            const showConfirm = vi.spyOn(useDialogStore.getState(), 'showConfirm')
                .mockReturnValue(pendingConfirmation);
            renderWithAuthenticatedTestOwner(<TrainingSession />, {
                localWorkout: activeWorkout,
                userData: initialData
            });

            await act(async () => {
                fireEvent.click(screen.getByLabelText('Rimuovi serie 1'));
            });
            expect(showConfirm).toHaveBeenCalledTimes(1);

            await act(async () => {
                const input = screen.getByPlaceholderText('Kg');
                fireEvent.change(input, { target: { value: '85' } });
                fireEvent.blur(input);
            });
            await waitFor(() => {
                expect(useAppStore.getState().localWorkout?.exercises[0].sets[0].kg).toBe('85');
            });

            await act(async () => { confirmDeletion(true); });
            expect(useAppStore.getState().localWorkout?.exercises[0].sets).toHaveLength(1);
            expect(useAppStore.getState().localWorkout?.exercises[0].sets[0]).toMatchObject({
                id: 'set-one',
                kg: '85',
                reps: '10'
            });
        });


        it('deletes a confirmed set if only another set changes while the dialog is open', async () => {
            const activeWorkout: WorkoutSession = {
                id: 'unrelated-edit-confirmation', routineId: 'routine_1',
                routineName: 'Scheda Petto', date: '2026-08-20', globalStartTime: Date.now(),
                exercises: [{ id: 'session-bench', exId: 'ex_bench', sessionNote: '',
                    sets: [
                        { id: 'set-one', kg: '80', reps: '10' },
                        { id: 'set-two', kg: '70', reps: '12' }
                    ]
                }]
            };
            const owner = captureSession().owner;
            const initialData = {
                ...emptyUserData, library: mockLibrary,
                routines: [{ id: 'routine_1', name: 'Scheda Petto',
                    exercises: [{ exId: 'ex_bench', setsCount: 3 }] }],
                activeWorkout
            };
            await initializeLocal(owner, initialData);
            let accept!: (ok: boolean) => void;
            const confirm = vi.spyOn(useDialogStore.getState(), 'showConfirm')
                .mockReturnValue(new Promise<boolean>(resolve => { accept = resolve; }));
            renderWithAuthenticatedTestOwner(<TrainingSession />, {
                localWorkout: activeWorkout, userData: initialData
            });
            await act(async () => { fireEvent.click(screen.getByLabelText('Rimuovi serie 1')); });
            expect(confirm).toHaveBeenCalledOnce();
            await act(async () => {
                const weight = screen.getAllByPlaceholderText('Kg')[1];
                fireEvent.change(weight, { target: { value: '75' } });
                fireEvent.blur(weight);
            });
            await waitFor(() =>
                expect(useAppStore.getState().localWorkout?.exercises[0].sets[1].kg).toBe('75')
            );
            await act(async () => { accept(true); });
            expect(useAppStore.getState().localWorkout?.exercises[0].sets).toEqual([
                expect.objectContaining({ id: 'set-two', kg: '75', reps: '12' })
            ]);
        });

        it('rejects an obsolete Auth epoch before deleting a confirmed set', async () => {
            const activeWorkout: WorkoutSession = {
                id: 'stale-confirmation', routineId: 'routine_1',
                routineName: 'Scheda Petto', date: '2026-08-20', globalStartTime: Date.now(),
                exercises: [{ id: 'session-bench', exId: 'ex_bench', sessionNote: '',
                    sets: [{ id: 'set-one', kg: '80', reps: '10' }]
                }]
            };
            const owner = captureSession().owner;
            const initialData = {
                ...emptyUserData, library: mockLibrary,
                routines: [{ id: 'routine_1', name: 'Scheda Petto',
                    exercises: [{ exId: 'ex_bench', setsCount: 3 }] }],
                activeWorkout
            };
            await initializeLocal(owner, initialData);
            let accept!: (ok: boolean) => void;
            const confirm = vi.spyOn(useDialogStore.getState(), 'showConfirm')
                .mockReturnValue(new Promise<boolean>(resolve => { accept = resolve; }));
            renderWithAuthenticatedTestOwner(<TrainingSession />, {
                localWorkout: activeWorkout, userData: initialData
            });
            await act(async () => { fireEvent.click(screen.getByLabelText('Rimuovi serie 1')); });
            expect(confirm).toHaveBeenCalledOnce();
            act(() => { invalidateSession(); invalidateSession(); });
            await act(async () => { accept(true); });
            expect(useAppStore.getState().localWorkout?.exercises[0].sets).toEqual([
                expect.objectContaining({ id: 'set-one', kg: '80', reps: '10' })
            ]);
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
                        segments: [{ technique: 'isometry' as const, reps: '', id: 'iso_1', kg: '', time: '45s' }]
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
                onUpdateSetTarget={vi.fn()}
                onUpdateTechnicalStandard={vi.fn()}
                />
            );

            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });

            expect(showConfirmSpy).toHaveBeenCalledTimes(1);
            expect(onRemoveSetSpy.mock.calls[0].slice(0, 2)).toEqual([0, 0]);

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
                        segments: [
                            { technique: 'dropset' as const, id: 'ds_empty', kg: '', reps: '0' },
                            { technique: 'isometry' as const, reps: '', id: 'iso_empty', kg: '', time: '' }
                        ],
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
                onUpdateSetTarget={vi.fn()}
                onUpdateTechnicalStandard={vi.fn()}
                />
            );

            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });

            // No confirmation prompt since all values are 0 or empty
            expect(showConfirmSpy).not.toHaveBeenCalled();
            expect(onRemoveSetSpy.mock.calls[0].slice(0, 2)).toEqual([0, 0]);
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
                onUpdateSetTarget={vi.fn()}
                onUpdateTechnicalStandard={vi.fn()}
                />
            );

            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });

            expect(showConfirmSpy).not.toHaveBeenCalled();
            expect(onRemoveSetSpy.mock.calls[0].slice(0, 2)).toEqual([0, 0]);
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
                onUpdateSetTarget={vi.fn()}
                onUpdateTechnicalStandard={vi.fn()}
                />
            );

            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });

            expect(showConfirmSpy).toHaveBeenCalledTimes(1);
            expect(onRemoveSetSpy.mock.calls[0].slice(0, 2)).toEqual([0, 0]);
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
                onUpdateSetTarget={vi.fn()}
                onUpdateTechnicalStandard={vi.fn()}
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
