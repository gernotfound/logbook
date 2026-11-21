import React from 'react';
import { describe, test, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from '../setup';
import { prepareUnlockedTestArchive } from '../secureVaultFixture';
import { Logic } from '../../src/lib/logic';
import { FoodSchema } from '../../src/lib/schema';
import { createLoggedMealItem } from '../../src/lib/nutrition/createLoggedMealItem';
import { calculateLoggedMealTotals } from '../../src/lib/nutrition/calculateLoggedMealTotals';
import type { Food } from '../../src/types';
import NutritionMeals from '../../src/components/Nutrition/NutritionMeals';

describe('Nutrition numeric and hostile search inputs', () => {

    test('FoodSchema keeps validated nutrient labels without silently recalculating them', () => {
      const oats = FoodSchema.parse({
        name: 'Avena integrale', carbs: 66, pro: 14, fat: 7, kcal: 383, isCustom: true,
      });
      expect(oats).toMatchObject({ kcal: 383, carbs: 66, pro: 14, fat: 7 });
      const peanutButter = FoodSchema.parse({
        name: 'Burro di arachidi', carbs: 20, pro: 25, fat: 50, kcal: 630, isCustom: true,
      });
      expect(peanutButter).toMatchObject({ kcal: 630, fat: 50 });
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

    test('macro targets reject partial numeric values and interpret decimal commas consistently', () => {
      const comma = Logic.calculateMacrosFromKg('80,5', '3,5', '2', '1');
      expect(comma).toMatchObject({
        carbsGrams: 281.8,
        proGrams: 161,
        fatGrams: 80.5,
        totalKcal: 2496,
      });

      const missingRatio = Logic.calculateMacrosFromKg('80', null, '', undefined);
      expect(missingRatio.totalKcal).toBe(0);
      expect(missingRatio.carbsGrams).toBe(0);

      const standard = Logic.calculateMacrosFromKg(80, 3.5, 2, 1);
      const zeroed = Logic.calculateMacrosFromKg(0, 3.5, 2, 1);
      expect(standard.totalKcal).toBe(2480);

      for (const invalid of ['80kg', '80abc', '80,5kg', '1e309', '']) {
        expect(Logic.calculateMacrosFromKg(invalid, 3.5, 2, 1)).toEqual(zeroed);
      }
      for (const invalid of ['3,5g', '3.5x', '1e309', 'abc']) {
        expect(Logic.calculateMacrosFromKg(80, invalid, 2, 1)).toEqual(zeroed);
        expect(Logic.calculateMacrosFromKg(80, 3.5, invalid, 1)).toEqual(zeroed);
        expect(Logic.calculateMacrosFromKg(80, 3.5, 2, invalid)).toEqual(zeroed);
      }
    });

    test('Logic.calculateBodyFat rejects invalid weight even with complete valid Navy measurements', () => {
      const profile = { gender: 'M', height: '180', neck: '38', waist: '85' };
      expect(Logic.calculateBodyFat(75, profile)).not.toBeNull();
      expect(Logic.calculateBodyFat(0, profile)).toBeNull();
      expect(Logic.calculateBodyFat('0', profile)).toBeNull();
      expect(Logic.calculateBodyFat(-70, profile)).toBeNull();
    });

    test('Logic.calculateBodyFat returns null for missing or partial user profile', () => {
      expect(Logic.calculateBodyFat(75, null as any)).toBeNull();
      expect(Logic.calculateBodyFat(75, {})).toBeNull();
      expect(Logic.calculateBodyFat(75, { gender: 'M' })).toBeNull();
      expect(Logic.calculateBodyFat(75, { height: '175' })).toBeNull();
      expect(Logic.calculateBodyFat(75, { dob: '1995-01-01' })).toBeNull();
      expect(Logic.calculateBodyFat(75, { height: '0', dob: '1995-01-01' })).toBeNull();
    });

    test('US Navy body-fat calculation does not depend on date of birth', () => {
      const profile = { height: '175', waist: '85', neck: '38', gender: 'M' };
      const reference = Logic.calculateBodyFat(75, profile);
      expect(reference).not.toBeNull();
      expect(Logic.calculateBodyFat(75, { ...profile, dob: 'invalid-date' })).toBe(reference);
      expect(Logic.calculateBodyFat(75, { ...profile, dob: '1995-01-01' })).toBe(reference);
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

    test('derived TDEE never propagates non-finite or negative manual calorie targets', () => {
      for (const kcal of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN, -100, 0]) {
        const summary = Logic.calculateTDEEAndMacros({
          nutritionPlanning: { weight: 80, normocalorica: { kcal } },
        });
        expect(summary.tdee).toBe(2500);
        expect(Number.isFinite(summary.tdee)).toBe(true);
      }
      expect(Logic.calculateTDEEAndMacros({
        nutritionPlanning: { weight: 80, normocalorica: { kcal: 2450 } },
      }).tdee).toBe(2450);
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

    test('derived summaries do not use malformed or nonpositive planning weights', () => {
      const reference = Logic.calculateTDEEAndMacros({ nutritionPlanning: { weight: 80 } });
      for (const raw of [-70, 0, '0x64', Number.POSITIVE_INFINITY] as unknown[]) {
        const summary = Logic.calculateTDEEAndMacros({
          nutritionPlanning: { weight: raw as number },
        });
        expect(summary).toEqual(reference);
      }
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
      const logged = createLoggedMealItem(valid.cleanData as Food, 'Pranzo', 'meal-1', 0);
      expect(calculateLoggedMealTotals([{ ...logged, quantity: 2 }]).kcal).toBe(145);
    });

    test('NutritionMeals handles literal regex metacharacters and still finds a known food', async () => {
      await prepareUnlockedTestArchive();
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
});
