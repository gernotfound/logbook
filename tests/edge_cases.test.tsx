import React from 'react';
import { describe, test, expect, beforeEach } from 'vitest';
import { screen, act, fireEvent, waitFor } from '@testing-library/react';
import { renderWithAuthenticatedTestOwner, renderWithProviders, emptyUserData } from './setup';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { Logic } from '../src/lib/logic';

import HomeView from '../src/components/Home/HomeView';
import TrainingSession from '../src/components/Training/TrainingSession';
import TrainingRoutines from '../src/components/Training/TrainingRoutines';
import TrainingHistory from '../src/components/Training/TrainingHistory';
import TrainingExercises from '../src/components/Training/TrainingExercises';
import NutritionMeals from '../src/components/Nutrition/NutritionMeals';
import NutritionPlanning from '../src/components/Nutrition/NutritionPlanning';
import SettingsView from '../src/components/SettingsView';
import WorkoutTimer from '../src/components/Training/WorkoutTimer';
import { stoppedWorkoutTimer, writeWorkoutTimerSnapshot } from '../src/lib/utils/timer';
import { storageOwner } from '../src/lib/sync/session';
import { useAuth } from '../src/hooks/useAuth';
import MuscleModel from '../src/components/Training/MuscleModel';

const ReadyOwner = () => {
  const { currentUser, loading } = useAuth();
  return <output data-testid="authenticated-owner">{!loading && currentUser ? currentUser.uid : 'pending'}</output>;
};

describe('Empirical Challenger Suite: Edge Cases & Stress Verification', () => {
  beforeEach(async () => { await prepareUnlockedTestArchive(); });

  describe('1. Zero-Quantity Inputs & Calculations', () => {
    test('Logic.scaleFoodNutrients handles zero, negative, and invalid quantities', () => {
      const food = { baseQty: 100, kcal: 250, carbs: 30, pro: 15, fat: 5, unit: 'g' };
      
      const zeroQty = Logic.scaleFoodNutrients(food, 0, 'g');
      expect(zeroQty.kcal).toBe(0);
      expect(zeroQty.carbs).toBe(0);
      expect(zeroQty.pro).toBe(0);
      expect(zeroQty.fat).toBe(0);

      const negQty = Logic.scaleFoodNutrients(food, -100, 'g');
      expect(negQty.kcal).toBe(0);

      const nanQty = Logic.scaleFoodNutrients(food, NaN, 'g');
      expect(nanQty.kcal).toBe(0);

      const nullFood = Logic.scaleFoodNutrients(null as any, 100, 'g');
      expect(nullFood.kcal).toBe(0);
    });


    test('Logic.calculateMacrosFromKg handles zero weight or zero macro ratios', () => {
      const zeroWeight = Logic.calculateMacrosFromKg(0, 3.5, 2.0, 1.0);
      expect(zeroWeight.totalKcal).toBe(0);
      expect(zeroWeight.carbsGrams).toBe(0);
      expect(zeroWeight.fatGrams).toBe(0);

      const positive = Logic.calculateMacrosFromKg(80, 3.5, 2.0, 1.0);
      expect(positive.fatGrams).toBe(80);

      const zeroRatios = Logic.calculateMacrosFromKg(80, 0, 0, 0);
      expect(zeroRatios.totalKcal).toBe(0);
      expect(zeroRatios.carbsGrams).toBe(0);
      expect(zeroRatios.proGrams).toBe(0);
      expect(zeroRatios.fatGrams).toBe(0);

      expect(Logic.calculateMacrosFromKg(80, Number.POSITIVE_INFINITY, 2, 1).totalKcal).toBe(0);
      expect(Logic.calculateMacrosFromKg(Number.POSITIVE_INFINITY, 3.5, 2, 1).totalKcal).toBe(0);
      expect(Logic.calculateMacrosFromKg(1e308, 1e308, 1, 1).totalKcal).toBe(0);
    });

    test('Logic.calculateBodyFat handles 0 weight and edge inputs safely', () => {
      const profile = { gender: 'M', height: '180', dob: '1995-01-01' };
      expect(Logic.calculateBodyFat(0, profile)).toBeNull();
      expect(Logic.calculateBodyFat('0', profile)).toBeNull();
      expect(Logic.calculateBodyFat(-70, profile)).toBeNull();
    });


    test('Logic.calculateMacroRatio handles zero fat or zero carbs without divide-by-zero crashes', () => {
      const zeroFat = Logic.calculateMacroRatio(100, 0);
      expect(zeroFat.ratioKcal).toBe(Infinity);
      expect(zeroFat.ratioString).toBe('N/A');

      const zeroBoth = Logic.calculateMacroRatio(0, 0);
      expect(zeroBoth.ratioString).toBe('N/A');
    });

    test('Logic.calculateMealTotals handles empty array and meals with zero nutrients', () => {
      expect(Logic.calculateMealTotals([])).toEqual({
        kcal: 0, carbs: 0, pro: 0, fat: 0, satFat: 0, unSatFat: 0,
        sugars: 0, fiber: 0, salt: 0, sodium: 0, vitA: 0, vitC: 0, calcium: 0, iron: 0
      });

      const zeroMeal = [{ foods: [{ kcal: 0, carbs: 0, pro: 0, fat: 0 }] }];
      expect(Logic.calculateMealTotals(zeroMeal).kcal).toBe(0);
    });

  });

  describe('2. Missing User Profile Data & Null States', () => {
    test('Logic.calculateBodyFat returns null for missing or partial user profile', () => {
      expect(Logic.calculateBodyFat(75, null as any)).toBeNull();
      expect(Logic.calculateBodyFat(75, {})).toBeNull();
      expect(Logic.calculateBodyFat(75, { gender: 'M' })).toBeNull();
      expect(Logic.calculateBodyFat(75, { height: '175' })).toBeNull();
      expect(Logic.calculateBodyFat(75, { dob: '1995-01-01' })).toBeNull();
      expect(Logic.calculateBodyFat(75, { height: '0', dob: '1995-01-01' })).toBeNull();
    });

    test('Logic.calculateBodyFat behavior on invalid DOB string (Vulnerability check)', () => {
      const res = Logic.calculateBodyFat(75, { height: '175', dob: 'invalid-date', gender: 'M' });
      // Empirical Finding: Invalid date returns null because dobDate.getTime() is NaN
      expect(res).toBeNull();
    });

    test('Logic.calculateTDEEAndMacros handles missing profile and state defaults gracefully', () => {
      expect(Logic.calculateTDEEAndMacros(null)).toEqual({
        tdee: 2500, bf: null, carbs: 300, pro: 160, fat: 70, totalKcal: 2500
      });

      const emptyState = {};
      const res = Logic.calculateTDEEAndMacros(emptyState);
      expect(res.tdee).toBe(2500);
      expect(res.bf).toBeNull();
    });

    test('Logic.calculateTDEEAndMacros uses current nested ratios and defaults for absent targets', () => {
      const calculated = Logic.calculateTDEEAndMacros({
        nutritionPlanning: {
          weight: 80,
          avgMacros: { carbsPerKg: 4, proPerKg: 2, fatPerKg: 0.8 },
        },
      });
      expect(calculated.carbs).toBe(320);
      expect(calculated.pro).toBe(160);
      expect(calculated.fat).toBe(64);
      const withoutTargets = Logic.calculateTDEEAndMacros({
        nutritionPlanning: { weight: 80 },
      });
      expect(withoutTargets.carbs).toBe(280);
      expect(withoutTargets.pro).toBe(160);
      expect(withoutTargets.fat).toBe(80);
      const withUnsupportedAliases = Logic.calculateTDEEAndMacros({
        nutritionPlanning: { weight: 80, carbsPerKg: 1, proPerKg: 1, fatPerKg: 1 } as any,
      });
      expect(withUnsupportedAliases).toEqual(withoutTargets);
    });


    test('custom-food numeric validation rejects partial, non-finite and empty required values', () => {
      const food = { name: 'Test', baseQty: 100, unit: 'g', kcal: '120', carbs: '15', pro: '5', fat: '4' };
      expect(Logic.validateCustomFood(food).isValid).toBe(true);
      expect(Logic.validateCustomFood({ ...food, kcal: '1e309' }).isValid).toBe(false);
      expect(Logic.validateCustomFood({ ...food, carbs: '15abc' }).isValid).toBe(false);
      expect(Logic.validateCustomFood({ ...food, fat: '-0.01' }).isValid).toBe(false);
      expect(Logic.validateCustomFood({ ...food, baseQty: 'Infinity' }).isValid).toBe(false);
      expect(Logic.validateCustomFood({ ...food, baseQty: '' }).isValid).toBe(false);
      expect(Logic.validateCustomFood({ ...food, pro: '1,5' }).cleanData?.pro).toBe(1.5);
      expect(Logic.validateCustomFood({ ...food, fat: '.5' }).cleanData?.fat).toBe(0.5);
    });

    test('strict numeric parsing remains consistent for TDEE and custom-food input', () => {
      const food = { name: 'Test', baseQty: 100, unit: 'g', kcal: '2500,5', carbs: '15', pro: '5', fat: '4' };
      const before = structuredClone(food);
      expect(Logic.validateCustomFood(food).cleanData?.kcal).toBe(2501);
      expect(Logic.validateCustomFood({ ...food, kcal: '2500 kcal' }).isValid).toBe(false);
      expect(Logic.validateCustomFood({ ...food, kcal: '1e309' }).isValid).toBe(false);
      const days = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-09-0${i + 1}`, weight: '80,5', kcal: '2500,5',
      }));
      expect(Logic.calculateTDEE(days)).toMatchObject({ error: false, avgKcal: 2501 });
      expect(Logic.calculateTDEE([...days.slice(0, 6), { ...days[6], kcal: '2500 kcal' }]).error).toBe(true);
      expect(food).toEqual(before);
    });

    test('filled optional nutrients must be finite and nonnegative rather than silently discarded', () => {
      const food = { name: 'Test', baseQty: 100, unit: 'g', kcal: 120, carbs: 15, pro: 5, fat: 4 };
      for (const field of ['satFat', 'unSatFat', 'sugars', 'fiber', 'salt', 'sodium', 'vitA', 'vitC', 'calcium', 'iron'] as const) {
        for (const value of ['1g', '-0.01', '1e309', '1,2,3']) {
          const raw = { ...food, [field]: value };
          const before = structuredClone(raw);
          const result = Logic.validateCustomFood(raw);
          expect(result.isValid).toBe(false);
          expect(result.errors).toHaveProperty(field);
          expect(result.cleanData).toBeNull();
          expect(raw).toEqual(before);
        }
      }
      expect(Logic.validateCustomFood({ ...food, satFat: '', fiber: null }).isValid).toBe(true);
      expect(Logic.validateCustomFood({ ...food, satFat: '1,25', fiber: '0' }).cleanData)
        .toMatchObject({ satFat: 1.25, fiber: 0 });
      expect(Logic.validateCustomFood({ ...food, servingWeight: '50g' }).isValid).toBe(false);
    });

    test('piece-based custom foods require their actual piece weight', () => {
      const food = { name: 'Porzione', baseQty: 100, unit: 'pezzo', kcal: 120, carbs: 15, pro: 5, fat: 4 };
      expect(Logic.validateCustomFood(food).errors).toHaveProperty('servingWeight');
      expect(Logic.validateCustomFood({ ...food, servingWeight: 0 }).isValid).toBe(false);
      expect(Logic.validateCustomFood({ ...food, servingWeight: -10 }).isValid).toBe(false);
      expect(Logic.validateCustomFood({ ...food, servingWeight: '60g' }).isValid).toBe(false);
      expect(Logic.validateCustomFood({ ...food, servingWeight: '1e309' }).isValid).toBe(false);
      const valid = Logic.validateCustomFood({ ...food, servingWeight: '60,5' });
      expect(valid.isValid).toBe(true);
      expect(valid.cleanData?.servingWeight).toBe(60.5);
      expect(Logic.scaleFoodNutrients(valid.cleanData, 2, 'pezzo').kcal).toBe(145);
    });

    test('Components render gracefully when userData has minimal/empty structures', () => {


      expect(() => renderWithProviders(<HomeView onNavigate={() => {}} />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<SettingsView />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<NutritionPlanning />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithAuthenticatedTestOwner(<TrainingSession />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<TrainingRoutines />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<TrainingHistory />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<TrainingExercises />, { userData: emptyUserData })).not.toThrow();
    });

    test('NutritionPlanning without normocalorica object in nutritionPlanning renders without TypeError (Vulnerability check)', () => {
      const incompleteUserData = {
        nutritionPlanning: {
          weight: 80, avgMacros: { carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 }
          // normocalorica missing!
        } as any
      };
      expect(() => renderWithProviders(<NutritionPlanning />, { userData: incompleteUserData })).not.toThrow();
    });
  });

  describe('3. Midnight Date Boundary Cases', () => {
    test('Logic.getLocalDateString correctly formats midnight boundaries', () => {
      const midnight1 = new Date(2026, 6, 26, 0, 0, 0);
      const dateStr1 = Logic.getLocalDateString(midnight1);
      expect(dateStr1).toBe('2026-07-26');

      const endOfDay = new Date(2026, 6, 26, 23, 59, 59, 999);
      const dateStr2 = Logic.getLocalDateString(endOfDay);
      expect(dateStr2).toBe('2026-07-26');

      const dec31 = new Date(2026, 11, 31, 23, 59, 59);
      expect(Logic.getLocalDateString(dec31)).toBe('2026-12-31');

      const jan1 = new Date(2027, 0, 1, 0, 0, 0);
      expect(Logic.getLocalDateString(jan1)).toBe('2027-01-01');

      const leapFeb = new Date(2028, 1, 29);
      expect(Logic.getLocalDateString(leapFeb)).toBe('2028-02-29');
    });

    test('Logic.getCalendarMonthGrid generates correct days for month transitions', () => {
      const gridDec = Logic.getCalendarMonthGrid(2026, 11); // December 2026
      expect(gridDec.length).toBeGreaterThanOrEqual(35);
      expect(gridDec.some(cell => cell.dateStr === '2026-12-31')).toBe(true);

      const gridJan = Logic.getCalendarMonthGrid(2027, 0); // January 2027
      expect(gridJan.some(cell => cell.dateStr === '2027-01-01')).toBe(true);
    });

  });

  describe('4. WorkoutTimer & Ticking Behavior', () => {
    test('WorkoutTimer handles absent, stopped and future device-timer snapshots', () => {
      const owner = storageOwner();
      const { container: c1, unmount: unmount1 } = renderWithProviders(<WorkoutTimer />);
      expect(c1.textContent).toContain('00:00');
      unmount1();

      writeWorkoutTimerSnapshot(stoppedWorkoutTimer(), owner);
      const { container: c2, unmount: unmount2 } = renderWithProviders(<WorkoutTimer />);
      expect(c2.textContent).toContain('00:00');
      unmount2();

      // A clock value in the future must not render a negative duration.
      writeWorkoutTimerSnapshot({
        version: 1, state: 'running',
        startTime: Date.now() + 10000, accumulated: 0,
      }, owner);
      const { container: c3 } = renderWithProviders(<WorkoutTimer />);
      expect(c3.textContent).toContain('00:00');
    });

    test('WorkoutTimer rest controls (Play, Pause, Reset, Stop) operate cleanly without state crashes', async () => {
      // The previous case deliberately leaves a running future snapshot. Start
      // from a known *durably committed* stopped timer, not leaked test state.
      writeWorkoutTimerSnapshot(stoppedWorkoutTimer(), storageOwner());
      const { container } = renderWithProviders(<><ReadyOwner /><WorkoutTimer /></>);
      await waitFor(() => expect(screen.getByTestId('authenticated-owner').textContent).toBe('test-user-id'));

      const playBtn = container.querySelector('.timer-btn.play') as HTMLButtonElement;
      expect(playBtn).not.toBeNull();

      act(() => {
        fireEvent.click(playBtn);
      });

      const pauseBtn = container.querySelector('.timer-btn.pause') as HTMLButtonElement;
      expect(pauseBtn).not.toBeNull();

      act(() => {
        fireEvent.click(pauseBtn);
      });

      const resetBtn = container.querySelector('.timer-btn.reset') as HTMLButtonElement;
      expect(resetBtn).not.toBeNull();
      act(() => {
        fireEvent.click(resetBtn);
      });

      const stopBtn = container.querySelector('.timer-btn.stop') as HTMLButtonElement;
      expect(stopBtn).not.toBeNull();
      act(() => {
        fireEvent.click(stopBtn);
      });

      expect(container.textContent).toContain('00:00');
    });
  });

  describe('5. Component Boundary States & Stress Inputs', () => {
    test('NutritionMeals handles literal regex metacharacters and still finds a known food', () => {
      renderWithProviders(<NutritionMeals />, { userData: {
        ...emptyUserData,
        customFoods: [{ id: 'food-pollo', name: 'Pollo Test', kcal: 105, pro: 23, carbs: 0, fat: 1 }],
      } });
      const searchInput = screen.getByPlaceholderText(/Cerca alimento/i) as HTMLInputElement;
      const metacharacters = '[.*+?^$()|[\\]\\\\]';

      fireEvent.change(searchInput, { target: { value: metacharacters } });
      expect(searchInput.value).toBe(metacharacters);
      expect(screen.getByRole('status').textContent).toContain('Nessun alimento trovato');

      fireEvent.change(searchInput, { target: { value: 'Pollo' } });
      expect(searchInput.value).toBe('Pollo');
      expect(screen.getByText('Pollo Test')).toBeDefined();
      expect(screen.queryByRole('status')).toBeNull();
    });

    test('TrainingSession handles active workout with empty sets and non-numeric inputs', () => {
      const emptySetWorkout = {
        id: 'w_empty',
        routineId: 'r1',
        routineName: 'Scheda Test Empty',
        date: '2026-07-26',
        globalStartTime: Date.now(),
        exercises: [
          {
            exId: 'ex1',
            sets: [],
            sessionNote: ''
          },
          {
            exId: 'ex2',
            sets: [{ id: 's1', kg: '', reps: '' }, { id: 's2', kg: '-10', reps: '0' }],
            sessionNote: null
          }
        ]
      };

      const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, { 
        localWorkout: emptySetWorkout,
        userData: { ...emptyUserData, activeWorkout: emptySetWorkout } as any
      });
      expect(container.textContent).toContain('Scheda Test Empty');
    });

    test('MuscleModel handles unknown, null, or undefined muscle IDs safely', () => {
      expect(() => renderWithProviders(<MuscleModel selectedMuscles={[""]} />)).not.toThrow();
      expect(() => renderWithProviders(<MuscleModel selectedMuscles={["unknown_muscle_id_xyz"]} />)).not.toThrow();
      expect(() => renderWithProviders(<MuscleModel selectedMuscles={[null as any]} />)).not.toThrow();
    });
  });

});
