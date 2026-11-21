import { beforeEach, describe, expect, it } from 'vitest';
import { clearCatalogCache } from '../../../src/lib/catalog/catalogService';
import { extractCustomExercisesAndOverrides, extractCustomFoodsAndOverrides } from '../../../src/lib/catalog/deltaResolver';
import type { CatalogExercise, CatalogFood, Exercise, Food } from '../../../src/types';

describe('Catalog delta extraction: legacy adapter scenarios', () => {
    beforeEach(async () => { await clearCatalogCache(); });

    describe('5. Complex Legacy Migration Scenarios', () => {
        it('migrates legacy library containing mixed default, modified default, and custom exercises', () => {
            const globalExercises: CatalogExercise[] = [
                { id: 'g_bench', name: 'Panca Piana', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true },
                { id: 'g_squat', name: 'Squat', muscles: ['quads'], trackingType: 'weight_reps', isDefault: true },
                { id: 'g_deadlift', name: 'Stacco da Terra', muscles: ['back'], trackingType: 'weight_reps', isDefault: true },
                { id: 'g_press', name: 'Military Press', muscles: ['shoulders'], trackingType: 'weight_reps', isDefault: true }
            ];

            const legacyLibrary: Exercise[] = [
                { id: 'g_bench', name: 'Panca Piana', muscles: ['chest'], trackingType: 'weight_reps', setsCount: 3, isDefault: true, sets: [] },
                { id: 'g_squat', name: 'Squat con Fermo 2s', muscles: ['quads'], trackingType: 'weight_reps', notes: 'Fermo al petto/buca', setsCount: 4, isDefault: true, sets: [] },
                { id: 'custom_hip_thrust', name: 'Hip Thrust al Multipower', setsCount: 4, isDefault: false, sets: [] },
                { id: 'custom_lateral_raises', name: 'Alzate Laterali Cavi', setsCount: 3, sets: [] }
            ];

            const { customExercises, overrides } = extractCustomExercisesAndOverrides(legacyLibrary, globalExercises);

            expect(customExercises.length).toBe(2);
            expect(customExercises.map(c => c.id)).toContain('custom_hip_thrust');
            expect(customExercises.map(c => c.id)).toContain('custom_lateral_raises');
            expect(customExercises.every(c => c.isDefault === false)).toBe(true);

            expect(overrides.exercises?.g_squat?.name).toBe('Squat con Fermo 2s');
            expect(overrides.exercises?.g_squat?.notes).toBe('Fermo al petto/buca');
            expect(overrides.exercises?.g_bench).toBeUndefined();

            expect(overrides.hiddenExerciseIds).toContain('g_deadlift');
            expect(overrides.hiddenExerciseIds).toContain('g_press');
            expect(overrides.hiddenExerciseIds).not.toContain('g_bench');
            expect(overrides.hiddenExerciseIds).not.toContain('g_squat');
        });

        it('migrates legacy foods containing deleted default items and custom foods', () => {
            const globalFoods: CatalogFood[] = [
                { id: 1, name: 'Avena', kcal: 370, pro: 13, carbs: 60, fat: 7, isCustom: false },
                { id: 2, name: 'Latte scremato', kcal: 35, pro: 3.3, carbs: 5, fat: 0.1, isCustom: false },
                { id: 3, name: 'Uova intere', kcal: 155, pro: 13, carbs: 1.1, fat: 11, isCustom: false }
            ];

            const legacyFoods: Food[] = [
                { id: 1, name: 'Avena Istantanea Aromatizzata', kcal: 380, pro: 14, carbs: 58, fat: 7, brand: 'BPR Nutrition', isCustom: false },
                { id: 'custom_bar', name: 'Barretta Proteica', kcal: 200, pro: 20, carbs: 15, fat: 6, isCustom: true }
            ];

            const { customFoods, overrides } = extractCustomFoodsAndOverrides(legacyFoods, globalFoods);

            expect(customFoods.length).toBe(1);
            expect(customFoods[0].id).toBe('custom_bar');
            expect(customFoods[0].isCustom).toBe(true);

            expect(overrides.foods?.['1']?.name).toBe('Avena Istantanea Aromatizzata');
            expect(overrides.foods?.['1']?.brand).toBe('BPR Nutrition');
            expect(overrides.foods?.['1']?.kcal).toBe(380);

            expect(overrides.hiddenFoodIds).toContain('2');
            expect(overrides.hiddenFoodIds).toContain('3');
            expect(overrides.hiddenFoodIds).not.toContain('1');
        });
    });
});
