import { beforeEach, describe, expect, it } from 'vitest';
import { clearCatalogCache } from '../../../src/lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods, mergeCatalogOverrides } from '../../../src/lib/catalog/deltaResolver';
import type { CatalogExercise, CatalogFood, CatalogOverrides, Exercise, Food } from '../../../src/types';

describe('Catalog adversarial: large-scale delta resolution', () => {
    beforeEach(async () => { await clearCatalogCache(); });

    describe('3. Massive Scale & Performance Stress Testing', () => {
        it('resolves 1,000 global exercises with 500 overrides and 200 hidden IDs deterministically', () => {
            const globalExercises: CatalogExercise[] = Array.from({ length: 1000 }, (_, i) => ({
                id: `ex_${i}`,
                name: `Exercise ${i}`,
                muscles: ['chest', 'triceps'],
                secondaryMuscles: ['shoulders'],
                trackingType: 'weight_reps',
                setsCount: 3,
                isDefault: true
            }));

            const customExercises: Exercise[] = Array.from({ length: 200 }, (_, i) => ({
                id: `custom_${i}`,
                name: `Custom Exercise ${i}`,
                setsCount: 4,
                sets: []
            }));

            const exerciseOverrides: Record<string, any> = {};
            for (let i = 0; i < 500; i++) {
                exerciseOverrides[`ex_${i}`] = {
                    name: `Overridden Exercise ${i}`,
                    equipmentWeight: i * 0.5,
                    notes: `Heavy set ${i}`
                };
            }

            const hiddenExerciseIds = Array.from({ length: 200 }, (_, i) => `ex_${i + 700}`);

            const overrides: CatalogOverrides = {
                exercises: exerciseOverrides,
                hiddenExerciseIds
            };

            const resolved = resolveEffectiveExercises(globalExercises, customExercises, overrides);
            expect(resolved.length).toBe(200 + (1000 - 200)); // 200 custom + 800 unhidden

            const item0 = resolved.find(e => e.id === 'ex_0');
            expect(item0?.name).toBe('Overridden Exercise 0');
            expect(item0?.equipmentWeight).toBe(0);

            const item750 = resolved.find(e => e.id === 'ex_750');
            expect(item750).toBeUndefined();

            const byId = new Map(resolved.map(exercise => [exercise.id, exercise]));
            expect(byId.size).toBe(1000);
            for (let i = 0; i < 200; i++) {
                expect(byId.get(`custom_${i}`)).toMatchObject({
                    name: `Custom Exercise ${i}`, isDefault: false,
                });
            }
            for (let i = 0; i < 1000; i++) {
                const exercise = byId.get(`ex_${i}`);
                if (i >= 700 && i < 900) {
                    expect(exercise).toBeUndefined();
                } else {
                    expect(exercise).toMatchObject({
                        name: i < 500 ? `Overridden Exercise ${i}` : `Exercise ${i}`,
                        isDefault: true,
                    });
                    if (i < 500) expect(exercise?.equipmentWeight).toBe(i * 0.5);
                }
            }
        });

        it('resolves 2,000 global foods with 1,000 overrides and 500 hidden items deterministically', () => {
            const globalFoods: CatalogFood[] = Array.from({ length: 2000 }, (_, i) => ({
                id: `food_${i}`,
                name: `Food ${i}`,
                kcal: 100 + i,
                pro: 10,
                carbs: 20,
                fat: 2,
                brand: 'Brand',
                category: 'Grains',
                isCustom: false
            }));

            const customFoods: Food[] = Array.from({ length: 300 }, (_, i) => ({
                id: `custom_food_${i}`,
                name: `Custom Food ${i}`,
                kcal: 250,
                pro: 25,
                carbs: 15,
                fat: 5
            }));

            const foodOverrides: Record<string, any> = {};
            for (let i = 0; i < 1000; i++) {
                foodOverrides[`food_${i}`] = {
                    kcal: 999,
                    brand: `Premium Brand ${i}`
                };
            }

            const hiddenFoodIds = Array.from({ length: 500 }, (_, i) => `food_${i + 1500}`);

            const overrides: CatalogOverrides = {
                foods: foodOverrides,
                hiddenFoodIds
            };

            const resolved = resolveEffectiveFoods(globalFoods, customFoods, overrides);
            expect(resolved.length).toBe(300 + (2000 - 500));

            const food0 = resolved.find(f => f.id === 'food_0');
            expect(food0?.kcal).toBe(999);
            expect(food0?.brand).toBe('Premium Brand 0');

            const food1600 = resolved.find(f => f.id === 'food_1600');
            expect(food1600).toBeUndefined();

            const byId = new Map(resolved.map(food => [String(food.id), food]));
            expect(byId.size).toBe(1800);
            for (let i = 0; i < 300; i++) {
                expect(byId.get(`custom_food_${i}`)).toMatchObject({
                    name: `Custom Food ${i}`, kcal: 250, isCustom: true,
                });
            }
            for (let i = 0; i < 2000; i++) {
                const food = byId.get(`food_${i}`);
                if (i >= 1500) {
                    expect(food).toBeUndefined();
                } else {
                    expect(food).toMatchObject({
                        name: `Food ${i}`,
                        kcal: i < 1000 ? 999 : 100 + i,
                        brand: i < 1000 ? `Premium Brand ${i}` : 'Brand',
                        isCustom: false,
                    });
                }
            }
        });

        it('merges two large CatalogOverrides structures without losing IDs', () => {
            const a: CatalogOverrides = {
                exercises: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`ex_${i}`, { notes: `A_${i}` }])),
                foods: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`food_${i}`, { brand: `A_${i}` }])),
                hiddenExerciseIds: Array.from({ length: 500 }, (_, i) => `hidden_ex_a_${i}`),
                hiddenFoodIds: Array.from({ length: 500 }, (_, i) => `hidden_food_a_${i}`)
            };

            const b: CatalogOverrides = {
                exercises: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`ex_${i + 250}`, { notes: `B_${i}` }])),
                foods: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`food_${i + 250}`, { brand: `B_${i}` }])),
                hiddenExerciseIds: Array.from({ length: 500 }, (_, i) => `hidden_ex_b_${i}`),
                hiddenFoodIds: Array.from({ length: 500 }, (_, i) => `hidden_food_b_${i}`)
            };

            const merged = mergeCatalogOverrides(a, b);
            expect(Object.keys(merged.exercises || {}).length).toBe(750);
            expect(Object.keys(merged.foods || {}).length).toBe(750);
            expect(merged.hiddenExerciseIds?.length).toBe(1000);
            expect(merged.hiddenFoodIds?.length).toBe(1000);
            expect(new Set(merged.hiddenExerciseIds).size).toBe(1000);
            expect(new Set(merged.hiddenFoodIds).size).toBe(1000);
            for (let i = 0; i < 750; i++) {
                expect(merged.exercises?.[`ex_${i}`]?.notes)
                    .toBe(i < 250 ? `A_${i}` : `B_${i - 250}`);
                expect(merged.foods?.[`food_${i}`]?.brand)
                    .toBe(i < 250 ? `A_${i}` : `B_${i - 250}`);
            }
        });
    });

    // -------------------------------------------------------------------------
    // 4. Concurrency and Async State Population
    // -------------------------------------------------------------------------
});
