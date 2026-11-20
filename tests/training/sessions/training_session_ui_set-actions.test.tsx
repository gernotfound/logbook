import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SessionExerciseCard from '../../../src/components/Training/session/SessionExerciseCard';
import { setupTrainingSessionUiFixture } from './trainingSessionUiFixture';

describe('set actions', () => {
    beforeEach(setupTrainingSessionUiFixture);

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
                onUpdateSetTarget={vi.fn()}
                onUpdateTechnicalStandard={vi.fn()}
                />
            );

            const removeBtn = screen.getByText('- Rimuovi serie');
            const addBtn = screen.getByText('+ Aggiungi serie');

            expect(removeBtn).toBeDefined();
            expect(addBtn).toBeDefined();

            const historyBtn = screen.getByRole('button', { name: /storico/i });
            const setupBtn = screen.getByRole('button', { name: /setup/i });
            expect(historyBtn.getAttribute('aria-expanded')).toBe('false');
            expect(historyBtn.getAttribute('aria-controls')).toBe('session-history-0');
            expect(setupBtn.getAttribute('aria-expanded')).toBe('false');
            expect(setupBtn.getAttribute('aria-controls')).toBe('session-setup-0');

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
                onUpdateSetTarget={vi.fn()}
                onUpdateTechnicalStandard={vi.fn()}
                />
            );

            const removeBtn = screen.getByText('- Rimuovi serie');
            await act(async () => {
                fireEvent.click(removeBtn);
            });

            // Must call onRemoveSet with index 2 (last element of 3 sets)
            expect(onRemoveSetSpy).toHaveBeenCalledTimes(1);
            expect(onRemoveSetSpy.mock.calls[0].slice(0, 2)).toEqual([0, 2]);
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
                onUpdateSetTarget={vi.fn()}
                onUpdateTechnicalStandard={vi.fn()}
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
});
