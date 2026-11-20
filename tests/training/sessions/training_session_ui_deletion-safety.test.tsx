import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SessionExerciseCard from '../../../src/components/Training/session/SessionExerciseCard';
import { useDialogStore } from '../../../src/store/useDialogStore';
import { setupTrainingSessionUiFixture } from './trainingSessionUiFixture';

describe('set deletion safety', () => {
    beforeEach(setupTrainingSessionUiFixture);

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
                onUpdateSetTarget={vi.fn()}
                onUpdateTechnicalStandard={vi.fn()}
                />
            );

            const removeBtn = screen.getByText('- Rimuovi serie');
            await act(async () => {
                fireEvent.click(removeBtn);
            });

            expect(showConfirmSpy).not.toHaveBeenCalled();
            expect(onRemoveSetSpy.mock.calls[0].slice(0, 2)).toEqual([0, 1]);
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
                onUpdateSetTarget={vi.fn()}
                onUpdateTechnicalStandard={vi.fn()}
                />
            );

            const removeBtn = screen.getByText('- Rimuovi serie');
            await act(async () => {
                fireEvent.click(removeBtn);
            });

            expect(showConfirmSpy).toHaveBeenCalledTimes(1);
            expect(onRemoveSetSpy.mock.calls[0].slice(0, 2)).toEqual([0, 1]);
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
                onUpdateSetTarget={vi.fn()}
                onUpdateTechnicalStandard={vi.fn()}
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
                sets: [{ id: 's_plank', kg: '', reps: '', time: '60s' }],
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

            // Case B: Dropset filled
            const exItemDropset = {
                id: 'item_ds',
                exId: 'ex_bench',
                sets: [
                    {
                        id: 's_ds',
                        kg: '',
                        reps: '',
                        segments: [{ technique: 'dropset' as const, id: 'ds_1', kg: '50', reps: '6' }]
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

        it('R3.5: protects isometry-only and RIR-zero sets before deleting the last series', async () => {
            const showConfirm = vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValue(false);
            const onRemoveSet = vi.fn();
            const isoExercise = {
                id: 'item_isometry',
                exId: 'ex_bench',
                sessionNote: '',
                sets: [{
                    id: 's_iso', kg: '', reps: '',
                    segments: [{ technique: 'isometry' as const, reps: '', id: 'iso_1', kg: '', time: '20' }]
                }]
            };
            const props = {
                exIndex: 0,
                libDef: { id: 'ex_bench', name: 'Panca Piana', trackingType: 'weight_reps' as const },
                pastWorkouts: [],
                isHistoryOpen: false,
                isSetupOpen: false,
                openSpecialMenuId: null,
                onToggleHistory: vi.fn(),
                onToggleSetup: vi.fn(),
                onRemoveExercise: vi.fn(),
                onUpdateSetupNote: vi.fn(),
                onUpdateSessionNote: vi.fn(),
                onAddSet: vi.fn(),
                onRemoveSet,
                onUpdateSet: vi.fn(),
                onAddSpecialSet: vi.fn(),
                onUpdateSpecialSet: vi.fn(),
                onRemoveSpecialSet: vi.fn(),
                onToggleSpecialMenu: vi.fn(),
                onUpdateSetTarget: vi.fn(),
                onUpdateTechnicalStandard: vi.fn()
            };
            const view = render(<SessionExerciseCard {...props} exItem={isoExercise} />);
            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });
            expect(showConfirm).toHaveBeenCalledTimes(1);
            expect(onRemoveSet).not.toHaveBeenCalled();

            showConfirm.mockResolvedValue(true);
            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });
            expect(onRemoveSet.mock.calls[0].slice(0, 3)).toEqual([0, 0, 's_iso']);

            showConfirm.mockClear();
            onRemoveSet.mockClear();
            view.rerender(<SessionExerciseCard {...props} exItem={{
                ...isoExercise,
                sets: [{ id: 's_rir', kg: '', reps: '', rir: 0 }]
            }} />);
            await act(async () => {
                fireEvent.click(screen.getByText('- Rimuovi serie'));
            });
            expect(showConfirm).toHaveBeenCalledTimes(1);
            expect(onRemoveSet.mock.calls[0].slice(0, 3)).toEqual([0, 0, 's_rir']);
        });
    });
});
