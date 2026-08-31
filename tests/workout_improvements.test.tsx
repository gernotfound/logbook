import React from 'react';
import { describe, test, expect, beforeEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from './setup';
import { Logic } from '../src/lib/logic';
import TrainingSession from '../src/components/Training/TrainingSession';
import TrainingRoutines from '../src/components/Training/TrainingRoutines';
import TrainingHistory from '../src/components/Training/TrainingHistory';
import TrainingExercises from '../src/components/Training/TrainingExercises';
import { FoodItemRow } from '../src/components/Nutrition/archive/FoodItemRow';
import TrainingView from '../src/components/Training/TrainingView';
import WorkoutTimer from '../src/components/Training/WorkoutTimer';
import { resetGlobalWorkoutTimer } from '../src/lib/utils/timer';
import SettingsView from '../src/components/SettingsView';
import MuscleModel from '../src/components/Training/MuscleModel';
import { useHomeView } from '../src/hooks/useHomeView';
import type { WorkoutSession } from '../src/types';

describe('Workout Improvements & History Edit Suite', () => {

  beforeEach(() => {
    localStorage.clear();
  });

  describe('1. Optional Session Rating Validation', () => {
    test('validateWorkoutRatings allows completely empty ratings', () => {
      const res = Logic.validateWorkoutRatings('', '', '');
      expect(res.isValid).toBe(true);
      expect(res.mood).toBeNull();
      expect(res.pump).toBeNull();
      expect(res.fatigue).toBeNull();
      expect(res.errors.mood).toBeNull();
      expect(res.errors.pump).toBeNull();
      expect(res.errors.fatigue).toBeNull();
    });

    test('validateWorkoutRatings allows null or undefined ratings', () => {
      const res = Logic.validateWorkoutRatings(null, undefined, null);
      expect(res.isValid).toBe(true);
      expect(res.mood).toBeNull();
      expect(res.pump).toBeNull();
      expect(res.fatigue).toBeNull();
    });

    test('validateWorkoutRatings allows partial ratings', () => {
      const res = Logic.validateWorkoutRatings(8, '', null);
      expect(res.isValid).toBe(true);
      expect(res.mood).toBe(8);
      expect(res.pump).toBeNull();
      expect(res.fatigue).toBeNull();
    });

    test('validateWorkoutRatings rejects out of range numbers', () => {
      const res = Logic.validateWorkoutRatings(15, 0, -2);
      expect(res.isValid).toBe(false);
      expect(res.errors.mood).not.toBeNull();
      expect(res.errors.pump).not.toBeNull();
      expect(res.errors.fatigue).not.toBeNull();
    });

    test('validateWorkoutRatings parses valid strings from 1 to 10', () => {
      const res = Logic.validateWorkoutRatings('1', '10', '5');
      expect(res.isValid).toBe(true);
      expect(res.mood).toBe(1);
      expect(res.pump).toBe(10);
      expect(res.fatigue).toBe(5);
    });
  });

  describe('2. Top Timer Reset on Session Actions', () => {
    test('resetGlobalWorkoutTimer clears localStorage and dispatches event', () => {
      localStorage.setItem('logbook_timer_state', 'running');
      localStorage.setItem('logbook_timer_start', '123456789');
      localStorage.setItem('logbook_timer_accumulated', '5000');

      const { container } = renderWithProviders(<WorkoutTimer />);

      act(() => {
        resetGlobalWorkoutTimer();
      });

      expect(localStorage.getItem('logbook_timer_state')).toBeNull();
      expect(container.textContent).toContain('00:00');
    });
  });

  describe('3. MuscleModel & Compact Reps in TrainingRoutines', () => {
    test('MuscleModel is always visible in routine creation even with zero exercises', () => {
      const { container } = renderWithProviders(<TrainingRoutines />, {
        userData: { ...emptyUserData, routines: [] } as any
      });

      // Click "Crea Nuova Scheda"
      const createBtn = screen.getByText(/Crea Nuova Scheda/i);
      act(() => {
        fireEvent.click(createBtn);
      });

      // SVG MuscleModel must be rendered in DOM
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
    });
  });

  describe('4. Historical Workout Editing Flow', () => {
    test('TrainingHistory renders edit button and triggers onEditWorkout callback', () => {
      let editedWorkout: WorkoutSession | null = null;

      const mockHistory: WorkoutSession[] = [
        {
          id: 'w_hist_1',
          routineId: 'r1',
          routineName: 'Push Day A',
          date: '2026-08-01',
          globalStartTime: 1722500000000,
          globalEndTime: 1722503600000,
          globalDurationStr: '01:00:00',
          moodRating: 8,
          pumpRating: 9,
          fatigueRating: 4,
          waterLiters: 1.5,
          exercises: [
            {
              exId: 'ex1',
              sets: [{ id: 's1', kg: '80', reps: '10' }],
              sessionNote: 'Good focus'
            }
          ]
        }
      ];

      const { container } = renderWithProviders(
        <TrainingHistory onEditWorkout={(w) => { editedWorkout = w; }} />,
        {
          userData: { ...emptyUserData, history: mockHistory } as any
        }
      );

      expect(container.textContent).toContain('Push Day A');
      const triggerBtn = screen.getByRole('button', { name: /opzioni/i });
      expect(triggerBtn).not.toBeNull();

      act(() => {
        fireEvent.click(triggerBtn);
      });

      const editBtn = screen.getByRole('menuitem', { name: /modifica allenamento/i });
      expect(editBtn).not.toBeNull();

      act(() => {
        fireEvent.click(editBtn);
      });

      expect(editedWorkout).not.toBeNull();
      expect(editedWorkout?.id).toBe('w_hist_1');
    });

    test('TrainingSession in isEditingHistory mode renders banner, manual duration and "Salva Modifica"', () => {
      const editingSession: WorkoutSession = {
        id: 'w_editing',
        originalHistoryId: 'w_hist_1',
        isEditingHistory: true,
        routineId: 'r1',
        routineName: 'Push Day Modificata',
        date: '2026-08-01',
        globalDurationStr: '00:45:00',
        manualDurationStr: '00:45:00',
        moodRating: 7,
        pumpRating: 8,
        fatigueRating: 5,
        waterLiters: 2.0,
        exercises: [
          {
            exId: 'ex1',
            sets: [{ id: 's1', kg: '85', reps: '8' }],
            sessionNote: 'Modificato'
          }
        ]
      };

      const { container } = renderWithProviders(<TrainingSession />, {
        localWorkout: editingSession,
        userData: { ...emptyUserData, library: [{ id: 'ex1', name: 'Panca Piana' }] } as any
      });

      // Verify banner
      expect(container.textContent).toContain('Modifica allenamento dello storico');

      // Verify manual duration input exists
      const durationInput = container.querySelector('#workout-manual-duration') as HTMLInputElement;
      expect(durationInput).not.toBeNull();
      expect(durationInput.value).toBe('00:45:00');

      // Verify "Salva modifiche" button is present instead of "Termina sessione"
      expect(screen.getByText(/Salva modifiche/i)).not.toBeNull();
      expect(screen.queryByText(/Termina sessione/i)).toBeNull();
    });

    test('TrainingView full integration: edit from history switches sub-tab to session in edit mode', async () => {
      const mockHistory: WorkoutSession[] = [
        {
          id: 'w_hist_test',
          routineId: 'r1',
          routineName: 'Gambe Hardcore',
          date: '2026-08-02',
          globalStartTime: 1722500000000,
          globalEndTime: 1722504000000,
          globalDurationStr: '01:06:40',
          exercises: []
        }
      ];

      let currentSubTab = 'history';
      const setSubTab = (tab: string) => { currentSubTab = tab; };

      renderWithProviders(
        <TrainingView subTab={currentSubTab} setSubTab={setSubTab} />,
        {
          localWorkout: null,
          userData: { ...emptyUserData, activeWorkout: null, history: mockHistory } as any
        }
      );

      const triggerBtn = screen.getByRole('button', { name: /opzioni/i });
      await act(async () => {
        fireEvent.click(triggerBtn);
      });

      const editBtn = screen.getByRole('menuitem', { name: /modifica allenamento/i });
      await act(async () => {
        fireEvent.click(editBtn);
      });

      expect(currentSubTab).toBe('session');
    });
  });

  describe('5. SettingsView CSV Export Button Location', () => {
    test('Esporta Dati CSV button is directly present in SettingsView', () => {
      renderWithProviders(<SettingsView />);

      const exportTabBtn = screen.getByText('Esporta');
      fireEvent.click(exportTabBtn);

      const csvBtn = screen.getByText(/Esporta dati \(CSV\)/i);
      expect(csvBtn).not.toBeNull();
    });
  });

  describe('6. MuscleModel Custom Colors & useHomeView Volume/Dropset/Fatigue', () => {
    test('MuscleModel applies custom colors from both atomic SVG path IDs and logical muscle IDs', () => {
      const customColors: Record<string, string> = {
        'chest-upper-left': '#ef4444',
        'back': '#f97316'
      };

      const { container } = renderWithProviders(
        <MuscleModel muscleColors={customColors} interactive={false} />
      );

      const chestPath = container.querySelector('#chest-upper-left');
      expect(chestPath).not.toBeNull();
      expect(chestPath?.getAttribute('style')).toContain('fill: rgb(239, 68, 68)');

      // 'back' is a logical group mapping to lats, traps, etc.
      const latsPath = container.querySelector('#lats-mid-left');
      expect(latsPath).not.toBeNull();
      expect(latsPath?.getAttribute('style')).toContain('fill: rgb(249, 115, 22)');
    });

    test('useHomeView accurately computes muscleColors and volume with dropsets', () => {
      const now = Date.now();
      const mockLibrary = [
        {
          id: 'ex_bench',
          name: 'Panca Piana',
          muscles: ['chest_lower', 'chest_upper'],
          secondaryMuscles: ['triceps', 'delts_front']
        },
        {
          id: 'ex_curl',
          name: 'Curl Bicipiti',
          muscles: ['biceps'],
          secondaryMuscles: ['forearms']
        }
      ];

      // Workout done 24 hours ago (yesterday)
      const yesterdayWorkout = {
        id: 'w_yesterday',
        date: Logic.getLocalDateString(new Date(now - 24 * 3600 * 1000)),
        globalStartTime: now - (24 * 3600 * 1000),
        exercises: [
          {
            exId: 'ex_bench',
            sets: [
              { id: 's1', kg: '80', reps: '10' },
              { id: 's2', kg: '80', reps: '10' },
              { 
                id: 's3', 
                kg: '80', 
                reps: '8', 
                dropsets: [
                  { id: 'ds1', kg: '60', reps: '6' },
                  { id: 'ds2', kg: '40', reps: '6' }
                ] 
              }
            ]
          }
        ]
      };

      // Test component consuming useHomeView
      let hookResult: any = null;
      function TestHomeComponent() {
        const res = useHomeView();
        hookResult = res;
        return <div data-testid="home-loaded">{res.loading ? 'loading' : 'ready'}</div>;
      }

      renderWithProviders(<TestHomeComponent />, {
        userData: {
          ...emptyUserData,
          library: mockLibrary,
          history: [yesterdayWorkout]
        } as any
      });

      expect(hookResult.loading).toBe(false);
      
      // Volume calculation: 3 main sets + 2 dropsets = 5 sets for Petto
      expect(hookResult.volumeChartData.labels).toContain('Petto');
      const pettoIndex = hookResult.volumeChartData.labels.indexOf('Petto');
      expect(hookResult.volumeChartData.datasets[0].data[pettoIndex]).toBe(5);

      // Fatigue / MuscleColors: 24h passed -> baseFatigue = 1 - 24/72 = 0.667 (> 0.35) -> #f97316 (orange)
      expect(hookResult.muscleColors['chest-lower-left']).toBe('#f97316');
      expect(hookResult.muscleColors['chest_lower']).toBe('#f97316');
    });

    test('useHomeView correctly exposes estimated BF from recent nutrition measurements', () => {
      let hookResult: any = null;
      function TestHomeComponent() {
        const res = useHomeView();
        hookResult = res;
        return <div data-testid="home-loaded">{res.loading ? 'loading' : 'ready'}</div>;
      }

      renderWithProviders(<TestHomeComponent />, {
        userData: {
          ...emptyUserData,
          profile: { height: '180', gender: 'M', dob: '1995-05-10' },
          nutrition: {
            '2026-08-05': {
              date: '2026-08-05',
              weight: 80.5,
              waist: 84,
              neck: 39,
              bf: 15.2,
              kcal: 2200, carbs: 250, pro: 160, fat: 60
            }
          }
        } as any
      });

      expect(hookResult.loading).toBe(false);
      expect(hookResult.bf).toBe('15.2');
    });

    test('useHomeView generates proper chartData and periods (7d, 30d, 180d, 365d) with white points', () => {
      let hookResult: any = null;
      function TestHomeComponent() {
        const res = useHomeView();
        hookResult = res;
        return <div data-testid="home-loaded">{res.loading ? 'loading' : 'ready'}</div>;
      }

      renderWithProviders(<TestHomeComponent />, {
        userData: {
          ...emptyUserData,
          nutrition: {
            '2026-08-01': { date: '2026-08-01', weight: 81.0 },
            '2026-08-07': { date: '2026-08-07', weight: 79.8 }
          }
        } as any
      });

      expect(hookResult.loading).toBe(false);
      expect(hookResult.weightPeriod).toBe('7d');
      expect(hookResult.chartData.datasets[0].pointBackgroundColor).toBe('#ffffff');
      expect(hookResult.chartData.labels.length).toBe(7);

      // Change period to 30d
      act(() => {
        hookResult.setWeightPeriod('30d');
      });
      expect(hookResult.weightPeriod).toBe('30d');
      expect(hookResult.chartData.labels.length).toBe(30);

      // Change period to 180d
      act(() => {
        hookResult.setWeightPeriod('180d');
      });
      expect(hookResult.weightPeriod).toBe('180d');
      expect(hookResult.chartData.labels.length).toBe(180);

      // Change period to 365d
      act(() => {
        hookResult.setWeightPeriod('365d');
      });
      expect(hookResult.weightPeriod).toBe('365d');
      expect(hookResult.chartData.labels.length).toBe(365);
    });
  });

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
          userData: { ...emptyUserData, history: mockHistory } as any
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

    test('TrainingExercises ContextMenu behaves correctly for default vs custom exercises without toggling accordion', () => {
      const mockLibrary = [
        {
          id: 'ex_default',
          name: 'Panca Piana Catalogo',
          isDefault: true,
          muscles: ['chest_lower']
        },
        {
          id: 'ex_custom',
          name: 'Panca Inclinata Custom',
          isDefault: false,
          muscles: ['chest_upper']
        }
      ];

      renderWithProviders(<TrainingExercises />, {
        userData: { ...emptyUserData, library: mockLibrary, routines: [] } as any
      });

      const triggers = screen.getAllByRole('button', { name: /opzioni/i });
      expect(triggers.length).toBe(2);

      // Open first (default) exercise's context menu
      act(() => {
        fireEvent.click(triggers[0]);
      });

      // Default exercise should have "Modifica esercizio" but NOT "Elimina esercizio"
      expect(screen.getByRole('menuitem', { name: /modifica/i })).not.toBeNull();
      expect(screen.queryByRole('menuitem', { name: /elimina/i })).toBeNull();

      // Close menu by clicking trigger again
      act(() => {
        fireEvent.click(triggers[0]);
      });

      // Open second (custom) exercise's context menu
      act(() => {
        fireEvent.click(triggers[1]);
      });

      // Custom exercise should have both "Modifica esercizio" and "Elimina esercizio"
      expect(screen.getByRole('menuitem', { name: /modifica/i })).not.toBeNull();
      expect(screen.getByRole('menuitem', { name: /elimina/i })).not.toBeNull();

      // Click "Modifica esercizio"
      act(() => {
        fireEvent.click(screen.getByRole('menuitem', { name: /modifica/i }));
      });

      // Form header shows editing title
      expect(screen.getByText(/Modifica esercizio/i)).not.toBeNull();
    });

    test('FoodItemRow ContextMenu renders "Modifica alimento" and "Elimina alimento", preserving quick add', () => {
      const mockFood = {
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

      let editedFood: any = null;
      let deletedFood: any = null;
      let quickAdded: { food: any; mealType: string } | null = null;

      renderWithProviders(
        <FoodItemRow
          food={mockFood}
          isLast={true}
          mealTypes={['Colazione', 'Pranzo']}
          onEdit={(f) => { editedFood = f; }}
          onDelete={(f) => { deletedFood = f; }}
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
    });
  });
});
