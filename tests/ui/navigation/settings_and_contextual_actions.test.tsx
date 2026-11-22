import { describe, test, expect, beforeEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from '../../setup';
import TrainingHistory from '../../../src/components/Training/TrainingHistory';
import TrainingExercises from '../../../src/components/Training/TrainingExercises';
import { FoodItemRow } from '../../../src/components/Nutrition/archive/FoodItemRow';
import SettingsView from '../../../src/components/SettingsView';
import type { WorkoutSession, Exercise, Food } from '../../../src/types';

describe('Settings and contextual UI actions', () => {
  beforeEach(() => { localStorage.clear(); });

  describe('7. ContextMenu Integration (TrainingHistory, TrainingExercises, FoodItemRow)', () => {
    test('TrainingHistory ContextMenu provides "Vedi report", "Modifica allenamento" and "Elimina allenamento"', async () => {
      const mockHistory: WorkoutSession[] = [
        {
          id: 'w_test_ctx',
          routineId: 'r1',
          routineName: 'Legs Blast',
          date: '2026-08-10',
          globalStartTime: 1723300000000,
          globalEndTime: 1723303600000,
          globalDurationStr: '01:00:00',
          exercises: []
        }
      ];

      let edited: WorkoutSession | null = null;
      renderWithProviders(
        <TrainingHistory onEditWorkout={(w) => { edited = w; }} />,
        {
          userData: { ...emptyUserData, history: mockHistory }
        }
      );

      // Verify ContextMenu trigger button exists
      const triggerBtn = screen.getByRole('button', { name: /opzioni/i });
      expect(triggerBtn).not.toBeNull();

      // Open menu
      act(() => {
        fireEvent.click(triggerBtn);
      });

      // Check menu items
      const reportItem = screen.getByRole('menuitem', { name: /vedi report/i });
      const editItem = screen.getByRole('menuitem', { name: /modifica allenamento/i });
      const deleteItem = screen.getByRole('menuitem', { name: /elimina allenamento/i });

      expect(reportItem).not.toBeNull();
      expect(editItem).not.toBeNull();
      expect(deleteItem).not.toBeNull();

      // Click "Vedi report" opens report modal
      act(() => {
        fireEvent.click(reportItem);
      });
      expect(screen.getByText(/Chiudi Report/i)).not.toBeNull();

      // Close modal
      act(() => {
        fireEvent.click(screen.getByText(/Chiudi Report/i));
      });

      // Re-open menu and click edit
      act(() => {
        fireEvent.click(triggerBtn);
      });
      act(() => {
        fireEvent.click(screen.getByRole('menuitem', { name: /modifica allenamento/i }));
      });
      expect(edited).toEqual(mockHistory[0]);
    });

    test('TrainingExercises detail actions preserve default vs custom exercise rules', () => {
      const mockLibrary: Exercise[] = [
        {
          id: 'ex_default',
          name: 'Panca Piana Catalogo',
          setsCount: 3,
          sets: [],
          isDefault: true,
          muscles: ['chest_lower']
        },
        {
          id: 'ex_custom',
          name: 'Panca Inclinata Custom',
          setsCount: 3,
          sets: [],
          isDefault: false,
          muscles: ['chest_upper']
        }
      ];

      renderWithProviders(<TrainingExercises />, {
        userData: { ...emptyUserData, library: mockLibrary, routines: [] }
      });

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Panca Piana Catalogo' }));
      });

      expect(screen.getByRole('button', { name: 'Modifica' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Duplica' })).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Elimina' })).toBeNull();

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Torna all’elenco' }));
      });
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Panca Inclinata Custom' }));
      });

      expect(screen.getByRole('button', { name: 'Modifica' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Duplica' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Elimina' })).not.toBeNull();

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Modifica' }));
      });

      expect(screen.getByRole('heading', { name: /Modifica esercizio/i })).not.toBeNull();
    });

    test('FoodItemRow ContextMenu renders "Modifica alimento" and "Elimina alimento", preserving quick add', () => {
      const mockFood: Food = {
        id: 'cf_apple',
        name: 'Mela Fuji',
        brand: 'Bio',
        kcal: 52,
        pro: 0.3,
        carbs: 14,
        fat: 0.2,
        baseQty: 100,
        unit: 'g'
      };

      let editedFood: Food | null = null;
      let deletedFood: Food | null = null;
      let duplicatedFood: Food | null = null;
      let quickAdded: { food: Food; mealType: string } | null = null;

      renderWithProviders(
        <FoodItemRow
          food={mockFood}
          isLast={true}
          mealTypes={['Colazione', 'Pranzo']}
          onEdit={(f) => { editedFood = f; }}
          onDelete={(f) => { deletedFood = f; }}
          onDuplicate={(f) => { duplicatedFood = f; }}
          onQuickAddToMeal={(f, mt) => { quickAdded = { food: f, mealType: mt }; }}
        />
      );

      // Verify quick add buttons work
      const colazioneBtn = screen.getByText('Colazione');
      act(() => {
        fireEvent.click(colazioneBtn);
      });
      expect(quickAdded).toEqual({ food: mockFood, mealType: 'Colazione' });

      // Open ContextMenu
      const triggerBtn = screen.getByRole('button', { name: /opzioni/i });
      act(() => {
        fireEvent.click(triggerBtn);
      });

      const editItem = screen.getByRole('menuitem', { name: /modifica/i });
      const deleteItem = screen.getByRole('menuitem', { name: /elimina/i });
      expect(editItem).not.toBeNull();
      expect(deleteItem).not.toBeNull();

      // Click Modifica alimento
      act(() => {
        fireEvent.click(editItem);
      });
      expect(editedFood).toEqual(mockFood);

      // Re-open ContextMenu and click Elimina alimento
      act(() => {
        fireEvent.click(triggerBtn);
      });
      act(() => {
        fireEvent.click(screen.getByRole('menuitem', { name: /elimina/i }));
      });
      expect(deletedFood).toEqual(mockFood);

      // Duplicate is a distinct callback, not an implicit side effect of edit.
      fireEvent.click(triggerBtn);
      fireEvent.click(screen.getByRole('menuitem', { name: /duplica/i }));
      expect(duplicatedFood).toEqual(mockFood);
    });
  });
});
