import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { mockLibrary } from './exerciseSearchTestFixture';
import { RoutineEditor } from '../../../src/components/Training/routines/RoutineEditor';

    describe('3. RoutineEditor Integration with ExerciseSearchDropdown', () => {
        beforeEach(async () => {
            await prepareUnlockedTestArchive('user:test-user-id');
        });

        it('3.1: RoutineEditor contains ExerciseSearchDropdown instead of legacy select', () => {
            const onAddExercise = vi.fn();
            const { container } = renderWithProviders(
                <RoutineEditor
                    routineName="Nuova Scheda"
                    setRoutineName={vi.fn()}
                    editingRoutineId={null}
                    routineExercises={[]}
                    library={mockLibrary}
                    editMuscles={[]}
                    editSecMuscles={[]}
                    onAddExercise={onAddExercise}
                    onMoveExercise={vi.fn()}
                    onRemoveExercise={vi.fn()}
                    onUpdateSetsCount={vi.fn()}
                    onUpdateReps={vi.fn()}
                    onUpdateSetPlan={vi.fn()}
                    onUpdateSetPlanField={vi.fn()}
                    onUpdateExerciseMetadata={vi.fn()}
                    onSave={vi.fn()}
                    onCancel={vi.fn()}
                />
            );

            // Legacy select should no longer exist in RoutineEditor
            expect(container.querySelector('select')).toBeNull();

            // Search input is present with correct placeholder
            const searchInput = (container.querySelector('.exercise-search-container input') ||
                container.querySelector('input[role="combobox"]')) as HTMLInputElement;
            expect(searchInput).not.toBeNull();
            const visibleLabel = screen.getByText('Aggiungi esercizio');
            expect(visibleLabel.tagName).toBe('LABEL');
            expect(visibleLabel.getAttribute('for')).toBe(searchInput.id);
            expect(screen.getByRole('combobox', { name: 'Aggiungi esercizio' })).toBe(searchInput);

            // Open dropdown by focusing
            fireEvent.focus(searchInput);
            const dropdown = container.querySelector('.exercise-search-dropdown, [role="listbox"]');
            expect(dropdown).not.toBeNull();

            // Select an exercise from dropdown
            const items = container.querySelectorAll('.exercise-dropdown-item');
            expect(items.length).toBeGreaterThan(0);
            fireEvent.click(items[0]);

            expect(onAddExercise).toHaveBeenCalledTimes(1);
        });

        it('3.2: Typing typo query in RoutineEditor dropdown and selecting adds correct exercise', () => {
            const onAddExercise = vi.fn();
            const { container } = renderWithProviders(
                <RoutineEditor
                    routineName="Scheda Gambe"
                    setRoutineName={vi.fn()}
                    editingRoutineId={null}
                    routineExercises={[]}
                    library={mockLibrary}
                    editMuscles={[]}
                    editSecMuscles={[]}
                    onAddExercise={onAddExercise}
                    onMoveExercise={vi.fn()}
                    onRemoveExercise={vi.fn()}
                    onUpdateSetsCount={vi.fn()}
                    onUpdateReps={vi.fn()}
                    onUpdateSetPlan={vi.fn()}
                    onUpdateSetPlanField={vi.fn()}
                    onUpdateExerciseMetadata={vi.fn()}
                    onSave={vi.fn()}
                    onCancel={vi.fn()}
                />
            );

            const searchInput = (container.querySelector('.exercise-search-container input') ||
                container.querySelector('input[role="combobox"]')) as HTMLInputElement;
            expect(searchInput).not.toBeNull();
            fireEvent.change(searchInput, { target: { value: 'squatt' } });

            const items = container.querySelectorAll('.exercise-dropdown-item');
            expect(items.length).toBe(1);
            expect(items[0].textContent).toContain('Squat con Bilanciere');

            fireEvent.click(items[0]);
            expect(onAddExercise).toHaveBeenCalledWith('ex_squat');
        });
    })
