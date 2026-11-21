import { beforeEach, describe, expect, it } from 'vitest';
import { clearCatalogCache } from '../../../src/lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods, createExerciseOverride, mergeCatalogOverrides } from '../../../src/lib/catalog/deltaResolver';
import { calculateWorkoutVolume, createExerciseLibrarySearcher } from '../../../src/lib/calc/workout';
import type { CatalogExercise, CatalogFood, CatalogOverrides, Exercise, Food } from '../../../src/types';

describe('Catalog adversarial: malformed inputs and stable ID collisions', () => {
    beforeEach(async () => { await clearCatalogCache(); });

    describe('1. Malformed, Null, and Prototype-Polluted Inputs', () => {
        it('handles non-array and malformed types in resolveEffectiveExercises without crashing', () => {
            const maliciousInputs: any[] = [
                null,
                undefined,
                12345,
                'invalid string',
                {},
                true,
                false,
                NaN,
                Infinity,
                [null, undefined, {}, { id: '' }, { notAnId: 'test' }]
            ];

            for (const input of maliciousInputs) {
                expect(() => resolveEffectiveExercises(input, input, input)).not.toThrow();
                const res = resolveEffectiveExercises(input, input, input);
                expect(Array.isArray(res)).toBe(true);
            }
        });

        it('handles non-array and malformed types in resolveEffectiveFoods without crashing', () => {
            const maliciousInputs: any[] = [
                null,
                undefined,
                12345,
                'invalid string',
                {},
                true,
                false,
                NaN,
                Infinity,
                [null, undefined, {}, { id: '' }, { notAnId: 'test' }]
            ];

            for (const input of maliciousInputs) {
                expect(() => resolveEffectiveFoods(input, input, input)).not.toThrow();
                const res = resolveEffectiveFoods(input, input, input);
                expect(Array.isArray(res)).toBe(true);
            }
        });

        it('prevents Object.prototype property shadowing in resolveEffectiveExercises and resolveEffectiveFoods', () => {
            const globalsWithProtoNames: CatalogExercise[] = [
                { id: 'toString', name: 'Exercise ToString', trackingType: 'weight_reps', isDefault: true },
                { id: 'valueOf', name: 'Exercise ValueOf', trackingType: 'weight_reps', isDefault: true },
                { id: 'constructor', name: 'Exercise Constructor', trackingType: 'weight_reps', isDefault: true },
            ];

            const emptyOverrides: CatalogOverrides = {
                exercises: {}
            };

            const resolvedEx = resolveEffectiveExercises(globalsWithProtoNames, [], emptyOverrides);
            const toStringEx = resolvedEx.find(e => e.id === 'toString');
            const constructorEx = resolvedEx.find(e => e.id === 'constructor');
            
            expect(toStringEx?.name).toBe('Exercise ToString');
            expect(constructorEx?.name).toBe('Exercise Constructor');

            const foodsWithProtoNames: CatalogFood[] = [
                { id: 'toString', name: 'Food ToString', kcal: 100, pro: 10, carbs: 10, fat: 2 },
                { id: 'constructor', name: 'Food Constructor', kcal: 200, pro: 20, carbs: 20, fat: 4 },
            ];
            const emptyFoodOverrides: CatalogOverrides = {
                foods: {}
            };
            const resolvedFoods = resolveEffectiveFoods(foodsWithProtoNames, [], emptyFoodOverrides);
            const toStringFood = resolvedFoods.find(f => String(f.id) === 'toString');
            const constructorFood = resolvedFoods.find(f => String(f.id) === 'constructor');

            expect(toStringFood?.name).toBe('Food ToString');
            expect(constructorFood?.name).toBe('Food Constructor');
        });

        it('mergeCatalogOverrides handles malformed non-array and non-object inputs safely without throwing', () => {
            const corruptOverridesA: any = {
                exercises: null,
                foods: null,
                hiddenExerciseIds: 'not-an-array',
                hiddenFoodIds: 12345
            };

            const corruptOverridesB: any = {
                exercises: 'not-an-object',
                foods: false,
                hiddenExerciseIds: null,
                hiddenFoodIds: undefined
            };

            expect(() => mergeCatalogOverrides(corruptOverridesA, corruptOverridesB)).not.toThrow();
            const merged = mergeCatalogOverrides(corruptOverridesA, corruptOverridesB);
            expect(Array.isArray(merged.hiddenExerciseIds)).toBe(true);
            expect(Array.isArray(merged.hiddenFoodIds)).toBe(true);
            expect(merged.hiddenExerciseIds).toEqual([]);
            expect(merged.hiddenFoodIds).toEqual([]);
        });

        it('safely handles prototype pollution in mergeCatalogOverrides', () => {
            const pollutedPayload = JSON.parse('{"__proto__": {"admin": true}, "exercises": {"ex1": {"name": "Hacked"}}}');
            const cleanOverrides: CatalogOverrides = {
                exercises: { ex2: { name: 'Normal' } }
            };

            const merged = mergeCatalogOverrides(pollutedPayload, cleanOverrides);
            expect((merged as any).admin).toBeUndefined();
            expect(({} as any).admin).toBeUndefined(); // Global Object prototype not polluted
            expect(merged.exercises?.ex1?.name).toBe('Hacked');
            expect(merged.exercises?.ex2?.name).toBe('Normal');
        });
    });

    // -------------------------------------------------------------------------
    // 2. ID Collisions and Custom vs Default Boundary Testing
    // -------------------------------------------------------------------------

    describe('2. ID Collisions and Boundary Handling', () => {
        it('handles custom items with colliding ID to global items correctly', () => {
            const globalExercises: CatalogExercise[] = [
                { id: 'bench-press', name: 'Global Bench Press', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true }
            ];

            const userCustom: Exercise[] = [
                { id: 'bench-press', name: 'Custom Overwriting Bench Press', setsCount: 5, sets: [] }
            ];

            const resolved = resolveEffectiveExercises(globalExercises, userCustom);
            expect(resolved).toHaveLength(1);
            expect(resolved[0]).toMatchObject({ id: 'bench-press', name: 'Custom Overwriting Bench Press', isDefault: false });
            expect(createExerciseLibrarySearcher(resolved)('bench').map(ex => ex.id)).toEqual(['bench-press']);
            expect(calculateWorkoutVolume({ exercises: [{ exId: 'bench-press', sets: [{ kg: '10', reps: '2' }] }] }, resolved)).toBe(20);
            // Duplicate names remain distinct when their stable IDs differ.
            expect(resolveEffectiveExercises([...globalExercises, { ...globalExercises[0], id: 'second-bench' }], userCustom).map(ex => ex.id))
                .toEqual(['bench-press', 'second-bench']);
        });

        it('handles custom food with numeric ID 0 and colliding string ID "0"', () => {
            const globalFoods: CatalogFood[] = [
                { id: 0, name: 'Food Zero', kcal: 0, pro: 0, carbs: 0, fat: 0, isCustom: false },
                { id: '0', name: 'Food String Zero', kcal: 10, pro: 1, carbs: 1, fat: 1, isCustom: false }
            ];

            const customFoods: Food[] = [
                { id: 0, name: 'Custom Zero Food', kcal: 50, pro: 5, carbs: 5, fat: 2 }
            ];

            const overrides: CatalogOverrides = {
                // Intentionally malformed legacy numeric ID to test normalization and collisions.
                hiddenFoodIds: [0] as unknown as string[]
            };

            const resolved = resolveEffectiveFoods(globalFoods, customFoods, overrides);
            // Custom item should be present with isCustom: true
            const customItem = resolved.find(f => f.name === 'Custom Zero Food');
            expect(customItem).toBeDefined();
            expect(customItem?.isCustom).toBe(true);

            // Global 0 is hidden
            const globalZero = resolved.find(f => f.name === 'Food Zero');
            expect(globalZero).toBeUndefined();
        });

        it('handles items with undefined, null, or missing optional fields during override and resolution', () => {
            const base: CatalogExercise = {
                id: 'curl',
                name: 'Bicep Curl',
                muscles: ['biceps'],
                secondaryMuscles: undefined,
                notes: undefined,
                equipmentWeight: undefined,
                trackingType: 'weight_reps',
                isDefault: true
            };

            const updates: Partial<Exercise> = {
                notes: 'Focus on peak contraction',
                equipmentWeight: 2.5
            };

            const override = createExerciseOverride(base, updates);
            expect(override.notes).toBe('Focus on peak contraction');
            expect(override.equipmentWeight).toBe(2.5);
            expect(override.name).toBeUndefined();

            const resolved = resolveEffectiveExercises([base], [], {
                exercises: { curl: override }
            });

            expect(resolved[0].notes).toBe('Focus on peak contraction');
            expect(resolved[0].equipmentWeight).toBe(2.5);
            expect(resolved[0].secondaryMuscles).toEqual([]);
            expect(resolved[0].isBodyweight).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // 3. Massive Scale, Cyclic, and Performance Stress Testing
    // -------------------------------------------------------------------------
});
