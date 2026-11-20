import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu } from '../../../src/components/UI/ContextMenu';
import { RoutineCard } from '../../../src/components/Training/routines/RoutineCard';
import { CycleCard } from '../../../src/components/Training/planning/CycleCard';
import { FoodItemRow } from '../../../src/components/Nutrition/archive/FoodItemRow';
import TrainingExercises from '../../../src/components/Training/TrainingExercises';
import { useAppStore } from '../../../src/store/useAppStore';
import { captureSession } from '../../../src/lib/sync/session';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import type { Routine, ExerciseLibraryItem, TrainingCycle, WorkoutRoutine } from '../../../src/types';

describe('Empirical Adversarial Stress Suite: ContextMenu & Integrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('2. Event Bubbling Isolation Across Integrated Components', () => {
    describe('RoutineCard Integration', () => {
      const mockRoutine: Routine = {
        id: 'routine-1',
        name: 'Spinta & Tricipiti',
        exercises: [
          { exId: 'ex-1', setsCount: 4, minReps: 8, maxReps: 10 } as any,
        ],
      };

      const mockLibrary: ExerciseLibraryItem[] = [
        { id: 'ex-1', name: 'Panca piana bilanciere', muscles: ['chest'], secondaryMuscles: ['triceps'] } as any,
      ];

      it('isolates clicks on ContextMenu trigger so RoutineCard accordion is NOT toggled', () => {
        const onToggleExpand = vi.fn();
        const onEdit = vi.fn();
        const onDelete = vi.fn();

        render(
          <RoutineCard
            routine={mockRoutine}
            isExpanded={false}
            library={mockLibrary}
            onToggleExpand={onToggleExpand}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={vi.fn()}
          />
        );

        const trigger = screen.getByRole('button', { name: 'Opzioni' });
        // Click trigger to open menu
        fireEvent.click(trigger);

        // Verification: Menu is open, but RoutineCard accordion was NOT toggled
        expect(screen.getByRole('menu')).not.toBeNull();
        expect(onToggleExpand).not.toHaveBeenCalled();
      });

      it('isolates clicks on ContextMenu items so RoutineCard accordion is NOT toggled on Edit / Delete', () => {
        const onToggleExpand = vi.fn();
        const onEdit = vi.fn();
        const onDelete = vi.fn();

        render(
          <RoutineCard
            routine={mockRoutine}
            isExpanded={false}
            library={mockLibrary}
            onToggleExpand={onToggleExpand}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={vi.fn()}
          />
        );

        // 1. Test "Modifica scheda"
        const trigger = screen.getByRole('button', { name: 'Opzioni' });
        fireEvent.click(trigger);
        expect(onToggleExpand).not.toHaveBeenCalled();

        const editBtn = screen.getByRole('menuitem', { name: /Modifica/i });
        fireEvent.click(editBtn);

        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(onEdit).toHaveBeenCalledWith(mockRoutine);
        expect(onToggleExpand).not.toHaveBeenCalled();
        expect(screen.queryByRole('menu')).toBeNull(); // Menu closed

        // 2. Test "Elimina scheda"
        fireEvent.click(trigger);
        expect(onToggleExpand).not.toHaveBeenCalled();

        const deleteBtn = screen.getByRole('menuitem', { name: /Elimina/i });
        fireEvent.click(deleteBtn);

        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledWith(mockRoutine.id, expect.anything());
        expect(onToggleExpand).not.toHaveBeenCalled();
      });

      it('allows RoutineCard accordion toggle when clicking on card header area outside ContextMenu', () => {
        const onToggleExpand = vi.fn();
        render(
          <RoutineCard
            routine={mockRoutine}
            isExpanded={false}
            library={mockLibrary}
            onToggleExpand={onToggleExpand}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onDuplicate={vi.fn()}
          />
        );

        const routineNameHeader = screen.getByText('Spinta & Tricipiti');
        fireEvent.click(routineNameHeader);

        expect(onToggleExpand).toHaveBeenCalledTimes(1);
        expect(onToggleExpand).toHaveBeenCalledWith('routine-1');
      });
    });

    describe('TrainingExercises Integration', () => {
      beforeEach(async () => {
        await prepareUnlockedTestArchive();
        const initialUserData: any = {
          library: [
            { id: 'lib-1', name: 'Croci ai cavi', muscles: ['chest'], trackingType: 'weight_reps', isDefault: false, setsCount: 3, sets: [] },
            { id: 'lib-2', name: 'Panca piana', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 3, sets: [] },
          ],
          routines: [],
        };
        useAppStore.setState({
          userData: initialUserData,
          dataOwner: captureSession().owner,
          localPersistenceBlocked: false,
          saveError: null,
        });
      });

      it('moves exercise actions to the dedicated detail surface and keeps catalog items non-deletable', () => {
        render(<TrainingExercises />);

        // The UI must be exercised with a working owner vault, not while its
        // draft-persistence boundary has already entered fail-closed mode.
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        expect(screen.queryByRole('button', { name: 'Opzioni' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Croci ai cavi' }));
        expect(screen.getByRole('button', { name: 'Modifica' })).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Duplica' })).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Elimina' })).not.toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Torna all’elenco' }));
        fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Panca piana' }));

        expect(screen.getByRole('button', { name: 'Modifica' })).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Duplica' })).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Elimina' })).toBeNull();
      });
    });

    describe('CycleCard Integration', () => {
      const mockCycle: TrainingCycle = {
        id: 'cycle-1',
        name: 'Massa Ipertrofia Autunno',
        durationWeeks: 6,
        sessionsPerWeek: 4,
        routines: [{ routineId: 'r1', frequencyPerWeek: 1 }, { routineId: 'r2', frequencyPerWeek: 1 }],
      };

      const mockRoutines: WorkoutRoutine[] = [
        { id: 'r1', name: 'Scheda A', exercises: [] },
        { id: 'r2', name: 'Scheda B', exercises: [] },
      ];

      it('isolates clicks on ContextMenu in CycleCard for Edit, Duplicate, and Delete actions', () => {
        const onSetActive = vi.fn();
        const onDeactivate = vi.fn();
        const onEdit = vi.fn();
        const onDuplicate = vi.fn();
        const onDelete = vi.fn();

        render(
          <CycleCard
            cycle={mockCycle}
            isActive={false}
            routines={mockRoutines}
            onSetActive={onSetActive}
            onDeactivate={onDeactivate}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        );

        const trigger = screen.getByRole('button', { name: 'Opzioni' });

        // 1. Edit cycle
        fireEvent.click(trigger);
        const editItem = screen.getByRole('menuitem', { name: /Modifica/i });
        fireEvent.click(editItem);
        expect(onEdit).toHaveBeenCalledWith(mockCycle);
        expect(onSetActive).not.toHaveBeenCalled();

        // 2. Duplicate cycle
        fireEvent.click(trigger);
        const duplicateItem = screen.getByRole('menuitem', { name: /Duplica/i });
        fireEvent.click(duplicateItem);
        expect(onDuplicate).toHaveBeenCalledWith(mockCycle);

        // 3. Delete cycle
        fireEvent.click(trigger);
        const deleteItem = screen.getByRole('menuitem', { name: /Elimina/i });
        expect(deleteItem.classList.contains('context-menu-item-danger')).toBe(true);
        fireEvent.click(deleteItem);
        expect(onDelete).toHaveBeenCalledWith(mockCycle);
      });
    });

    describe('FoodItemRow Integration', () => {
      const mockFood = {
        id: 'food-1',
        name: 'Petto di pollo',
        kcal: 110,
        pro: 23,
        carbs: 0,
        fat: 1.2,
      };

      it('isolates ContextMenu in FoodItemRow for Edit and Delete without bubbling to quick add', () => {
        const onEdit = vi.fn();
        const onDelete = vi.fn();
        const onQuickAddToMeal = vi.fn();

        render(
          <FoodItemRow
            food={mockFood}
            isLast={false}
            mealTypes={['Colazione', 'Pranzo', 'Cena']}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={vi.fn()}
            onQuickAddToMeal={onQuickAddToMeal}
          />
        );

        const trigger = screen.getByRole('button', { name: 'Opzioni' });

        // Edit
        fireEvent.click(trigger);
        const editItem = screen.getByRole('menuitem', { name: /Modifica/i });
        fireEvent.click(editItem);
        expect(onEdit).toHaveBeenCalledWith(mockFood);
        expect(onQuickAddToMeal).not.toHaveBeenCalled();

        // Delete
        fireEvent.click(trigger);
        const deleteItem = screen.getByRole('menuitem', { name: /Elimina/i });
        fireEvent.click(deleteItem);
        expect(onDelete).toHaveBeenCalledWith(mockFood);
        expect(onQuickAddToMeal).not.toHaveBeenCalled();
      });
    });
  });


});
