import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CycleCard } from '../../../src/components/Training/planning/CycleCard';
import { RoutineCard } from '../../../src/components/Training/routines/RoutineCard';
import type { TrainingCycle, WorkoutRoutine } from '../../../src/types';
import { createTrainingPlanningFixtures } from './trainingPlanningFixtures';

describe('Training Planning & Volume Calculations', () => {
    const { mockLibrary, mockRoutines } = createTrainingPlanningFixtures();

    describe('CycleCard ContextMenu Actions & Invariants', () => {
        const testCycle: TrainingCycle = {
            id: 'c_test_ctx',
            name: 'Ciclo Test ContextMenu',
            durationWeeks: 4,
            sessionsPerWeek: 3,
            routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
        };

        it('renders ContextMenu with Modifica, Duplica, Elimina and handles clicks', () => {
            const onSetActive = vi.fn();
            const onDeactivate = vi.fn();
            const onEdit = vi.fn();
            const onDuplicate = vi.fn();
            const onDelete = vi.fn();

            render(
                <CycleCard
                    cycle={testCycle}
                    isActive={false}
                    routines={mockRoutines}
                    onSetActive={onSetActive}
                    onDeactivate={onDeactivate}
                    onEdit={onEdit}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                />
            );

            expect(screen.getByText('Ciclo Test ContextMenu')).toBeDefined();

            // Open ContextMenu
            const optionsBtn = screen.getByTitle('Opzioni');
            expect(optionsBtn).toBeDefined();
            fireEvent.click(optionsBtn);

            const editItem = screen.getByRole('menuitem', { name: /Modifica/i });
            const dupItem = screen.getByRole('menuitem', { name: /Duplica/i });
            const delItem = screen.getByRole('menuitem', { name: /Elimina/i });

            expect(editItem).toBeDefined();
            expect(dupItem).toBeDefined();
            expect(delItem).toBeDefined();
            expect(delItem.className).toContain('item-danger');

            // Click edit
            fireEvent.click(editItem);
            expect(onEdit).toHaveBeenCalledWith(testCycle);

            // Re-open and click duplicate
            fireEvent.click(optionsBtn);
            fireEvent.click(screen.getByRole('menuitem', { name: /Duplica/i }));
            expect(onDuplicate).toHaveBeenCalledWith(testCycle);

            // Re-open and click delete
            fireEvent.click(optionsBtn);
            fireEvent.click(screen.getByRole('menuitem', { name: /Elimina/i }));
            expect(onDelete).toHaveBeenCalledWith(testCycle);
        });
    });

    describe('RoutineCard ContextMenu and Expansion Isolation', () => {
        const mockRoutine: WorkoutRoutine = {
            id: 'r_test',
            name: 'Scheda Test Upper',
            exercises: [
                { exId: 'ex_bench', setsCount: 4 }
            ]
        };

        it('renders ContextMenu with Modifica and Elimina actions', () => {
            const onToggle = vi.fn();
            const onEdit = vi.fn();
            const onDelete = vi.fn();

            render(
                <RoutineCard
                    routine={mockRoutine}
                    isExpanded={false}
                    library={mockLibrary}
                    onToggleExpand={onToggle}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onDuplicate={vi.fn()}
                />
            );

            expect(screen.getByText('Scheda Test Upper')).toBeDefined();
            expect(screen.getByText(/^1 esercizi(?: · .*)?$/)).toBeDefined();

            const optionsBtn = screen.getByTitle('Opzioni');
            expect(optionsBtn).toBeDefined();

            // Open ContextMenu
            fireEvent.click(optionsBtn);
            // onToggleExpand must NOT have been called due to stopPropagation
            expect(onToggle).not.toHaveBeenCalled();

            const editItem = screen.getByRole('menuitem', { name: /Modifica/i });
            const deleteItem = screen.getByRole('menuitem', { name: /Elimina/i });
            expect(editItem).toBeDefined();
            expect(deleteItem).toBeDefined();
            expect(deleteItem.className).toContain('item-danger');

            // Click edit item
            fireEvent.click(editItem);
            expect(onEdit).toHaveBeenCalledWith(mockRoutine);
            expect(onToggle).not.toHaveBeenCalled();
        });

        it('triggers onDelete without toggling expansion when clicking Elimina scheda', () => {
            const onToggle = vi.fn();
            const onEdit = vi.fn();
            const onDelete = vi.fn();

            render(
                <RoutineCard
                    routine={mockRoutine}
                    isExpanded={false}
                    library={mockLibrary}
                    onToggleExpand={onToggle}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onDuplicate={vi.fn()}
                />
            );

            const optionsBtn = screen.getByTitle('Opzioni');
            fireEvent.click(optionsBtn);
            expect(onToggle).not.toHaveBeenCalled();

            const deleteItem = screen.getByRole('menuitem', { name: /Elimina/i });
            fireEvent.click(deleteItem);
            expect(onDelete).toHaveBeenCalledWith('r_test', expect.anything());
            expect(onToggle).not.toHaveBeenCalled();
        });

        it('toggles expansion when clicking card header outside ContextMenu', () => {
            const onToggle = vi.fn();
            const onEdit = vi.fn();
            const onDelete = vi.fn();

            render(
                <RoutineCard
                    routine={mockRoutine}
                    isExpanded={false}
                    library={mockLibrary}
                    onToggleExpand={onToggle}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onDuplicate={vi.fn()}
                />
            );

            fireEvent.click(screen.getByText('Scheda Test Upper'));
            expect(onToggle).toHaveBeenCalledWith('r_test');
        });
    });});
