import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithProviders } from './setup';
import { Logic } from '../src/lib/logic';

import HomeView from '../src/components/Home/HomeView';
import TrainingView from '../src/components/Training/TrainingView';
import TrainingSession from '../src/components/Training/TrainingSession';
import TrainingRoutines from '../src/components/Training/TrainingRoutines';
import TrainingHistory from '../src/components/Training/TrainingHistory';
import TrainingExercises from '../src/components/Training/TrainingExercises';
import NutritionView from '../src/components/Nutrition/NutritionView';
import NutritionMeals from '../src/components/Nutrition/NutritionMeals';
import NutritionPlanning from '../src/components/Nutrition/NutritionPlanning';
import NutritionMeasurements from '../src/components/Nutrition/NutritionMeasurements';
import CustomFoodModal from '../src/components/Nutrition/CustomFoodModal';
import SettingsView from '../src/components/SettingsView';
import WorkoutTimer from '../src/components/Training/WorkoutTimer';
import MuscleModel from '../src/components/Training/MuscleModel';

describe('Empirical Challenger Suite: Edge Cases & Stress Verification', () => {

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

    test('Logic.calculateDailyCalories handles zero and invalid macro inputs', () => {
      expect(Logic.calculateDailyCalories(0, 0, 0)).toBe(0);
      expect(Logic.calculateDailyCalories('0', '0', '0')).toBe(0);
      expect(Logic.calculateDailyCalories(null as any, null as any, null as any)).toBe(0);
      expect(Logic.calculateDailyCalories({ carbs: 0, pro: 0, fat: 0 })).toBe(0);
      expect(Logic.calculateDailyCalories({ carbs: 'abc', pro: undefined, fat: null })).toBe(0);
    });

    test('Logic.calculateMacrosFromKg handles zero weight or zero macro ratios', () => {
      const zeroWeight = Logic.calculateMacrosFromKg(0, 3.5, 2.0, 1.0);
      expect(zeroWeight.totalKcal).toBe(0);
      expect(zeroWeight.carbsGrams).toBe(0);

      const zeroRatios = Logic.calculateMacrosFromKg(80, 0, 0, 0);
      expect(zeroRatios.totalKcal).toBe(0);
      expect(zeroRatios.carbsGrams).toBe(0);
      expect(zeroRatios.proGrams).toBe(0);
      expect(zeroRatios.fatGrams).toBe(0);
    });

    test('Logic.calculateBodyFat handles 0 weight and edge inputs safely', () => {
      const profile = { gender: 'M', height: '180', dob: '1995-01-01' };
      expect(Logic.calculateBodyFat(0, profile)).toBeNull();
      expect(Logic.calculateBodyFat('0', profile)).toBeNull();
      expect(Logic.calculateBodyFat(-70, profile)).toBeNull();
    });

    test('Logic.calculateBodyComposition handles zero weight / bodyfat', () => {
      expect(Logic.calculateBodyComposition(0, 15)).toEqual({ fatMass: 0, leanMass: 0 });
      expect(Logic.calculateBodyComposition(80, 0)).toEqual({ fatMass: 0, leanMass: 80 });
      expect(Logic.calculateBodyComposition(80, 100)).toEqual({ fatMass: 80, leanMass: 0 });
      expect(Logic.calculateBodyComposition(80, 105)).toEqual({ fatMass: 0, leanMass: 0 }); // out of bounds
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

    test('Logic.calculateNormocaloricaDiff handles zero normocalorica target without crash', () => {
      const current = { carbsGrams: 100, proGrams: 100, fatGrams: 50, totalKcal: 1250 };
      const zeroNorm = { carbs: 0, pro: 0, fat: 0, kcal: 0 };
      const diff = Logic.calculateNormocaloricaDiff(current, zeroNorm);
      expect(diff.kcalPct).toBe(0);
      expect(diff.formatted).toBe('0.0%');
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
      // Empirical Finding: Invalid date returns string 'NaN' because dobDate.getTime() is NaN
      expect(res).toBe('NaN');
    });

    test('Logic.calculateTDEEAndMacros handles missing profile and state defaults gracefully', () => {
      expect(Logic.calculateTDEEAndMacros(null)).toEqual({
        tdee: 2500, bf: null, carbs: 300, pro: 160, fat: 70, totalKcal: 2500
      });

      const emptyState = { userData: null };
      const res = Logic.calculateTDEEAndMacros(emptyState);
      expect(res.tdee).toBe(2500);
      expect(res.bf).toBeNull();
    });

    test('Logic.validateMeasurementData handles null, empty, or missing profile fields', () => {
      const invalidData = Logic.validateMeasurementData(null);
      expect(invalidData.isValid).toBe(false);

      const emptyObj = Logic.validateMeasurementData({});
      expect(emptyObj.isValid).toBe(false);
      expect(emptyObj.errors.date).toBeDefined();
      expect(emptyObj.errors.weight).toBeDefined();
    });

    test('Components render gracefully when userData has minimal/empty structures', () => {
      const emptyUserData = {
        profile: {},
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {
          weight: 80,
          carbsPerKg: 3.5,
          proPerKg: 2.0,
          fatPerKg: 1.0,
          normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
        }
      };

      expect(() => renderWithProviders(<HomeView onNavigate={() => {}} />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<SettingsView />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<NutritionPlanning />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<NutritionMeasurements />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<TrainingSession />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<TrainingRoutines />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<TrainingHistory />, { userData: emptyUserData })).not.toThrow();
      expect(() => renderWithProviders(<TrainingExercises />, { userData: emptyUserData })).not.toThrow();
    });

    test('NutritionPlanning without normocalorica object in nutritionPlanning causes TypeError (Vulnerability check)', () => {
      const incompleteUserData = {
        nutritionPlanning: {
          weight: 80, carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0
          // normocalorica missing!
        } as any
      };
      expect(() => renderWithProviders(<NutritionPlanning />, { userData: incompleteUserData })).toThrow(TypeError);
    });
  });

  describe('3. Midnight Date Boundary Cases', () => {
    test('Logic.getLocalDateString correctly formats midnight boundaries', () => {
      const midnight1 = new Date('2026-07-26T00:00:00.000Z');
      const dateStr1 = Logic.getLocalDateString(midnight1);
      expect(dateStr1).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const endOfDay = new Date('2026-07-26T23:59:59.999Z');
      const dateStr2 = Logic.getLocalDateString(endOfDay);
      expect(dateStr2).toMatch(/^\d{4}-\d{2}-\d{2}$/);

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

    test('Logic.getWorkoutDatesSet parses ISO date strings with T or YYYY-MM-DD', () => {
      const history = [
        { date: '2026-07-26T23:59:59.000Z' },
        { date: '2026-07-27' },
        { dateStr: '2026-07-28' },
        { date: new Date('2026-07-29') }
      ];
      const datesSet = Logic.getWorkoutDatesSet(history);
      expect(datesSet.has('2026-07-26')).toBe(true);
      expect(datesSet.has('2026-07-27')).toBe(true);
      expect(datesSet.has('2026-07-28')).toBe(true);
      expect(datesSet.has('2026-07-29')).toBe(true);
    });
  });

  describe('4. WorkoutTimer & Ticking Behavior', () => {
    test('WorkoutTimer handles missing, 0, or future globalStartTime gracefully', () => {
      const { container: c1 } = renderWithProviders(<WorkoutTimer globalStartTime={undefined} />);
      expect(c1.textContent).toContain('00:00');

      const { container: c2 } = renderWithProviders(<WorkoutTimer globalStartTime={0} />);
      expect(c2.textContent).toContain('00:00');

      const futureTime = Date.now() + 10000;
      const { container: c3 } = renderWithProviders(<WorkoutTimer globalStartTime={futureTime} />);
      expect(c3).toBeDefined();
    });

    test('WorkoutTimer formats elapsed time exceeding 1 hour as HH:MM:SS', async () => {
      vi.useFakeTimers();
      const startTime = Date.now() - (3600 * 1000 + 120 * 1000 + 15 * 1000); // 1h 2m 15s
      const { container } = renderWithProviders(<WorkoutTimer globalStartTime={startTime} />);
      
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(container.textContent).toContain('01:02:16');
      vi.useRealTimers();
    });

    test('WorkoutTimer rest controls (Play, Pause, Reset, Stop) operate cleanly without state crashes', () => {
      const { container } = renderWithProviders(<WorkoutTimer globalStartTime={Date.now()} />);
      
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
    test('NutritionMeals handles special regex characters in search query', () => {
      const { container } = renderWithProviders(<NutritionMeals />);
      const searchInput = screen.getByPlaceholderText(/Cerca es\. Pollo/i) as HTMLInputElement;

      act(() => {
        fireEvent.change(searchInput, { target: { value: '[.*+?^${}()|[\\]\\\\]' } });
      });

      expect(container).toBeDefined();
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

      const { container } = renderWithProviders(<TrainingSession />, { localWorkout: emptySetWorkout });
      expect(container.textContent).toContain('Scheda Test Empty');
    });

    test('MuscleModel handles unknown, null, or undefined muscle IDs safely', () => {
      expect(() => renderWithProviders(<MuscleModel targetMuscle="" />)).not.toThrow();
      expect(() => renderWithProviders(<MuscleModel targetMuscle="unknown_muscle_id_xyz" />)).not.toThrow();
      expect(() => renderWithProviders(<MuscleModel targetMuscle={null as any} />)).not.toThrow();
    });
  });

});
