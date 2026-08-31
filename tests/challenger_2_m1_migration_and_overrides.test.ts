import { describe, it, expect } from 'vitest';
import {
    extractCustomExercisesAndOverrides,
    extractCustomFoodsAndOverrides,
    removeExerciseOverride,
    removeFoodOverride,
    resolveEffectiveExercises,
    resolveEffectiveFoods,
    applyExerciseOverride,
    applyFoodOverride,
    hideCatalogExercise,
    unhideCatalogExercise,
    hideCatalogFood,
    unhideCatalogFood,
    mergeCatalogOverrides
} from '../src/lib/catalog/deltaResolver';
import type {
    CatalogExercise,
    CatalogFood,
    CatalogOverrides,
    Exercise,
    Food
} from '../src/types';

describe('EMPIRICAL CHALLENGER 2 (Milestone M1): deltaResolver Migration & Override Stress Suite', () => {

    // Global test catalog fixtures
    const mockGlobalExercises: CatalogExercise[] = [
        { id: 'bench_press', name: 'Panca Piana Bilanciere', muscles: ['chest'], secondaryMuscles: ['triceps', 'shoulders'], trackingType: 'weight_reps', setsCount: 3, isDefault: true, isBodyweight: false, equipmentWeight: 20 },
        { id: 'squat_barbell', name: 'Squat Bilanciere', muscles: ['quads'], secondaryMuscles: ['glutes'], trackingType: 'weight_reps', setsCount: 4, isDefault: true, isBodyweight: false, equipmentWeight: 20 },
        { id: 'deadlift', name: 'Stacco da Terra', muscles: ['back', 'hamstrings'], secondaryMuscles: ['forearms'], trackingType: 'weight_reps', setsCount: 3, isDefault: true, isBodyweight: false },
        { id: 'pullup', name: 'Trazioni alla Sbarra', muscles: ['back'], secondaryMuscles: ['biceps'], trackingType: 'weight_reps', setsCount: 3, isDefault: true, isBodyweight: true },
        { id: 'plank', name: 'Plank Addominale', muscles: ['core'], trackingType: 'time', setsCount: 3, isDefault: true, isBodyweight: true }
    ];

    const mockGlobalFoods: CatalogFood[] = [
        { id: 'food_1', name: 'Petto di Pollo Crudo', brand: 'Generico', category: 'Carne', kcal: 103, pro: 23.1, carbs: 0, fat: 1.2, baseQty: 100, unit: 'g', servingUnit: 'fetta', servingWeight: 150, isCustom: false },
        { id: 'food_2', name: 'Riso Basmati', brand: 'Generico', category: 'Cereali', kcal: 350, pro: 7.5, carbs: 78.5, fat: 0.8, baseQty: 100, unit: 'g', servingUnit: 'porzione', servingWeight: 80, isCustom: false },
        { id: 'food_3', name: 'Olio Extravergine d\'Oliva', brand: 'Generico', category: 'Condimenti', kcal: 884, pro: 0, carbs: 0, fat: 100, baseQty: 100, unit: 'ml', servingUnit: 'cucchiaio', servingWeight: 10, isCustom: false },
        { id: 'food_4', name: 'Fiocchi d\'Avena Integrale', brand: 'Generico', category: 'Cereali', kcal: 370, pro: 13.5, carbs: 60, fat: 7, baseQty: 100, unit: 'g', isCustom: false },
        { id: 'food_5', name: 'Uova Intere', brand: 'Generico', category: 'Uova', kcal: 143, pro: 12.6, carbs: 0.7, fat: 9.5, baseQty: 100, unit: 'g', servingUnit: 'uovo medio', servingWeight: 55, isCustom: false }
    ];

    describe('1. Stress Test: extractCustomExercisesAndOverrides', () => {

        it('Scenario 1.1: Pure default library (all defaults present with unmodified attributes)', () => {
            const legacyLibrary: Exercise[] = mockGlobalExercises.map(ex => ({
                id: ex.id,
                name: ex.name,
                notes: ex.notes,
                setsCount: ex.setsCount ?? 3,
                muscles: ex.muscles ? [...ex.muscles] : [],
                secondaryMuscles: ex.secondaryMuscles ? [...ex.secondaryMuscles] : [],
                trackingType: ex.trackingType,
                isDefault: true,
                isBodyweight: ex.isBodyweight,
                equipmentWeight: ex.equipmentWeight,
                sets: []
            }));

            const result = extractCustomExercisesAndOverrides(legacyLibrary, mockGlobalExercises);

            expect(result.customExercises).toEqual([]);
            expect(result.overrides.exercises).toEqual({});
            expect(result.overrides.hiddenExerciseIds).toEqual([]);
        });

        it('Scenario 1.2: Pure custom library (all custom items with isDefault=false or unknown IDs)', () => {
            const legacyLibrary: Exercise[] = [
                { id: 'custom_ex_1', name: 'Custom Cable Fly', isDefault: false, setsCount: 3, muscles: ['chest'], sets: [] },
                { id: 'custom_ex_2', name: 'Custom Bulgarian Split Squat', isDefault: false, setsCount: 4, muscles: ['quads'], sets: [] },
                { id: 'unknown_id_3', name: 'Unknown Legacy Exercise', isDefault: undefined, setsCount: 3, sets: [] }
            ];

            const result = extractCustomExercisesAndOverrides(legacyLibrary, mockGlobalExercises);

            // Crucial: All custom items extracted, isDefault forced to false
            expect(result.customExercises).toHaveLength(3);
            expect(result.customExercises.every(c => c.isDefault === false)).toBe(true);
            expect(result.customExercises.map(c => c.id)).toEqual(['custom_ex_1', 'custom_ex_2', 'unknown_id_3']);

            // Crucial: No default items should be marked as hidden when presentDefaultIds.size === 0!
            expect(result.overrides.exercises).toEqual({});
            expect(result.overrides.hiddenExerciseIds).toEqual([]);
        });

        it('Scenario 1.3: Mixed custom and default library with missing/deleted defaults', () => {
            const legacyLibrary: Exercise[] = [
                // 2 defaults present (bench_press and squat_barbell) -> deadlift, pullup, plank are missing/deleted
                { id: 'bench_press', name: 'Panca Piana Bilanciere', isDefault: true, setsCount: 3, trackingType: 'weight_reps', sets: [] },
                { id: 'squat_barbell', name: 'Squat Bilanciere', isDefault: true, setsCount: 4, trackingType: 'weight_reps', sets: [] },
                // 2 custom items
                { id: 'my_custom_curl', name: 'Biceps Spider Curl', isDefault: false, setsCount: 3, sets: [] },
                { id: 'my_custom_dips', name: 'Chest Dips Weighted', isDefault: false, setsCount: 4, sets: [] }
            ];

            const result = extractCustomExercisesAndOverrides(legacyLibrary, mockGlobalExercises);

            expect(result.customExercises).toHaveLength(2);
            expect(result.customExercises.map(c => c.id)).toEqual(['my_custom_curl', 'my_custom_dips']);
            expect(result.customExercises.every(c => c.isDefault === false)).toBe(true);

            expect(result.overrides.exercises).toEqual({});
            // The 3 missing defaults must be marked as hidden
            expect(result.overrides.hiddenExerciseIds).toHaveLength(3);
            expect(result.overrides.hiddenExerciseIds).toEqual(expect.arrayContaining(['deadlift', 'pullup', 'plank']));
        });

        it('Scenario 1.4: Modified defaults with granular attribute overrides', () => {
            const legacyLibrary: Exercise[] = [
                {
                    id: 'bench_press',
                    name: 'Panca Piana Bilanciere (Grip Largo)', // changed name
                    notes: 'Fermo al petto 1 secondo', // added notes
                    muscles: ['chest', 'front_delts'], // modified muscles
                    secondaryMuscles: ['triceps'], // modified secondaryMuscles
                    trackingType: 'weight_reps',
                    setsCount: 5,
                    isDefault: true,
                    isBodyweight: false,
                    equipmentWeight: 25, // changed equipmentWeight
                    sets: []
                },
                {
                    id: 'pullup',
                    name: 'Trazioni alla Sbarra',
                    trackingType: 'weight_reps',
                    isDefault: true,
                    isBodyweight: false, // changed isBodyweight from true to false
                    setsCount: 3,
                    sets: []
                },
                {
                    id: 'plank',
                    name: 'Plank Addominale',
                    trackingType: 'time',
                    isDefault: true,
                    isBodyweight: true,
                    setsCount: 3,
                    sets: []
                },
                {
                    id: 'squat_barbell',
                    name: 'Squat Bilanciere',
                    isDefault: true,
                    setsCount: 4,
                    sets: []
                },
                {
                    id: 'deadlift',
                    name: 'Stacco da Terra',
                    isDefault: true,
                    setsCount: 3,
                    sets: []
                }
            ];

            const result = extractCustomExercisesAndOverrides(legacyLibrary, mockGlobalExercises);

            expect(result.customExercises).toHaveLength(0);
            expect(result.overrides.hiddenExerciseIds).toEqual([]);

            // Verify bench_press override
            const benchOverride = result.overrides.exercises?.['bench_press'];
            expect(benchOverride).toBeDefined();
            expect(benchOverride?.name).toBe('Panca Piana Bilanciere (Grip Largo)');
            expect(benchOverride?.notes).toBe('Fermo al petto 1 secondo');
            expect(benchOverride?.muscles).toEqual(['chest', 'front_delts']);
            expect(benchOverride?.secondaryMuscles).toEqual(['triceps']);
            expect(benchOverride?.equipmentWeight).toBe(25);
            // trackingType and isBodyweight are unmodified vs base, so should NOT be in override
            expect(benchOverride?.trackingType).toBeUndefined();
            expect(benchOverride?.isBodyweight).toBeUndefined();

            // Verify pullup override
            const pullupOverride = result.overrides.exercises?.['pullup'];
            expect(pullupOverride).toBeDefined();
            expect(pullupOverride?.isBodyweight).toBe(false);
            expect(pullupOverride?.name).toBeUndefined();

            // Unmodified items (plank, squat, deadlift) should NOT create empty override entries
            expect(result.overrides.exercises?.['plank']).toBeUndefined();
            expect(result.overrides.exercises?.['squat_barbell']).toBeUndefined();
            expect(result.overrides.exercises?.['deadlift']).toBeUndefined();
        });

        it('Scenario 1.5: Adversarial inputs (null, undefined, malformed objects, non-arrays)', () => {
            // Null and undefined inputs
            const res1 = extractCustomExercisesAndOverrides(null as any, null as any);
            expect(res1.customExercises).toEqual([]);
            expect(res1.overrides.exercises).toEqual({});
            expect(res1.overrides.hiddenExerciseIds).toEqual([]);

            const res2 = extractCustomExercisesAndOverrides(undefined, undefined);
            expect(res2.customExercises).toEqual([]);
            expect(res2.overrides.exercises).toEqual({});
            expect(res2.overrides.hiddenExerciseIds).toEqual([]);

            // Malformed array containing nulls, undefined, empty strings, corrupted objects
            const corruptedLegacy: any[] = [
                null,
                undefined,
                {},
                { id: '' },
                { id: null },
                { id: 'bench_press', isDefault: true, name: 'Panca Modificata' },
                { id: 'valid_custom', isDefault: false, name: 'Valid Custom' },
                { randomGarbage: true }
            ];

            const res3 = extractCustomExercisesAndOverrides(corruptedLegacy, mockGlobalExercises);
            expect(res3.customExercises).toHaveLength(1);
            expect(res3.customExercises[0].id).toBe('valid_custom');
            expect(res3.overrides.exercises?.['bench_press']?.name).toBe('Panca Modificata');
            // Missing defaults (4 of 5 missing)
            expect(res3.overrides.hiddenExerciseIds).toHaveLength(4);
        });

        it('Scenario 1.6: Round-trip consistency (migration followed by resolveEffectiveExercises)', () => {
            const legacyLibrary: Exercise[] = [
                { id: 'custom_1', name: 'Custom Pec Deck', isDefault: false, setsCount: 3, sets: [] },
                { id: 'bench_press', name: 'Panca Piana Bilanciere (Mod)', notes: 'My note', isDefault: true, setsCount: 3, sets: [] },
                { id: 'squat_barbell', name: 'Squat Bilanciere', isDefault: true, setsCount: 4, sets: [] }
                // deadlift, pullup, plank missing
            ];

            const { customExercises, overrides } = extractCustomExercisesAndOverrides(legacyLibrary, mockGlobalExercises);
            const resolved = resolveEffectiveExercises(mockGlobalExercises, customExercises, overrides);

            // Resolved list should contain custom first, then the 2 active global exercises
            expect(resolved).toHaveLength(3);
            expect(resolved[0].id).toBe('custom_1');
            expect(resolved[0].name).toBe('Custom Pec Deck');
            expect(resolved[0].isDefault).toBe(false);

            expect(resolved[1].id).toBe('bench_press');
            expect(resolved[1].name).toBe('Panca Piana Bilanciere (Mod)');
            expect(resolved[1].notes).toBe('My note');
            expect(resolved[1].isDefault).toBe(true);

            expect(resolved[2].id).toBe('squat_barbell');
            expect(resolved[2].name).toBe('Squat Bilanciere');
            expect(resolved[2].isDefault).toBe(true);

            // Hidden ones must be absent
            expect(resolved.find(e => e.id === 'deadlift')).toBeUndefined();
            expect(resolved.find(e => e.id === 'pullup')).toBeUndefined();
            expect(resolved.find(e => e.id === 'plank')).toBeUndefined();
        });
    });

    describe('2. Stress Test: extractCustomFoodsAndOverrides', () => {

        it('Scenario 2.1: Pure default foods (all defaults present and unmodified)', () => {
            const legacyFoods: Food[] = mockGlobalFoods.map(f => ({
                ...f,
                isCustom: false
            }));

            const result = extractCustomFoodsAndOverrides(legacyFoods, mockGlobalFoods);

            expect(result.customFoods).toEqual([]);
            expect(result.overrides.foods).toEqual({});
            expect(result.overrides.hiddenFoodIds).toEqual([]);
        });

        it('Scenario 2.2: Pure custom foods (all custom items with isCustom=true or unknown string/numeric IDs)', () => {
            const legacyFoods: Food[] = [
                { id: 'custom_shake', name: 'Whey Protein Shake', kcal: 150, pro: 30, carbs: 3, fat: 1.5, isCustom: true },
                { id: 9999, name: 'Numeric ID Custom Food', kcal: 200, pro: 10, carbs: 20, fat: 5, isCustom: true },
                { id: 'unknown_food_abc', name: 'Imported Custom Food', kcal: 300, pro: 20, carbs: 30, fat: 10 }
            ];

            const result = extractCustomFoodsAndOverrides(legacyFoods, mockGlobalFoods);

            expect(result.customFoods).toHaveLength(3);
            expect(result.customFoods.every(f => f.isCustom === true)).toBe(true);
            expect(result.customFoods.map(f => f.id)).toEqual(['custom_shake', 9999, 'unknown_food_abc']);

            // Crucial: No defaults hidden when presentDefaultIds.size === 0!
            expect(result.overrides.foods).toEqual({});
            expect(result.overrides.hiddenFoodIds).toEqual([]);
        });

        it('Scenario 2.3: Mixed custom and default foods with partial selection and numeric/string ID coercion', () => {
            const legacyFoods: Food[] = [
                // 2 defaults present (food_1 and food_2)
                { id: 'food_1', name: 'Petto di Pollo Crudo', kcal: 110, pro: 24, carbs: 0, fat: 1.2, isCustom: false }, // modified kcal & pro
                { id: 'food_2', name: 'Riso Basmati', kcal: 350, pro: 7.5, carbs: 78.5, fat: 0.8, isCustom: false },
                // 1 custom food
                { id: 'custom_bar', name: 'Protein Bar', kcal: 210, pro: 20, carbs: 15, fat: 7, isCustom: true }
            ];

            const result = extractCustomFoodsAndOverrides(legacyFoods, mockGlobalFoods);

            expect(result.customFoods).toHaveLength(1);
            expect(result.customFoods[0].id).toBe('custom_bar');
            expect(result.customFoods[0].isCustom).toBe(true);

            // food_1 has overrides
            expect(result.overrides.foods?.['food_1']).toBeDefined();
            expect(result.overrides.foods?.['food_1']?.kcal).toBe(110);
            expect(result.overrides.foods?.['food_1']?.pro).toBe(24);
            expect(result.overrides.foods?.['food_1']?.fat).toBeUndefined(); // unmodified

            // food_2 is unmodified, so no override entry
            expect(result.overrides.foods?.['food_2']).toBeUndefined();

            // missing foods (food_3, food_4, food_5) must be hidden
            expect(result.overrides.hiddenFoodIds).toHaveLength(3);
            expect(result.overrides.hiddenFoodIds).toEqual(expect.arrayContaining(['food_3', 'food_4', 'food_5']));
        });

        it('Scenario 2.4: Numeric ID catalog items and String coercion robustness', () => {
            const numericGlobalFoods: CatalogFood[] = [
                { id: 101, name: 'Numeric Apple', kcal: 52, pro: 0.3, carbs: 14, fat: 0.2, isCustom: false },
                { id: 102, name: 'Numeric Banana', kcal: 89, pro: 1.1, carbs: 23, fat: 0.3, isCustom: false },
                { id: 103, name: 'Numeric Orange', kcal: 47, pro: 0.9, carbs: 12, fat: 0.1, isCustom: false }
            ];

            // Legacy array uses string ID '101' for numeric global item 101, and number 102
            const legacyFoods: Food[] = [
                { id: '101' as any, name: 'Numeric Apple Golden', kcal: 55, pro: 0.3, carbs: 14, fat: 0.2, isCustom: false },
                { id: 102, name: 'Numeric Banana', kcal: 89, pro: 1.1, carbs: 23, fat: 0.3, isCustom: false }
                // 103 is missing
            ];

            const result = extractCustomFoodsAndOverrides(legacyFoods, numericGlobalFoods);

            expect(result.customFoods).toHaveLength(0);
            expect(result.overrides.foods?.['101']?.name).toBe('Numeric Apple Golden');
            expect(result.overrides.foods?.['101']?.kcal).toBe(55);
            expect(result.overrides.hiddenFoodIds).toEqual(['103']);
        });

        it('Scenario 2.5: Adversarial inputs (null, undefined, non-arrays, corrupted entries)', () => {
            const res1 = extractCustomFoodsAndOverrides(null as any, null as any);
            expect(res1.customFoods).toEqual([]);
            expect(res1.overrides.foods).toEqual({});
            expect(res1.overrides.hiddenFoodIds).toEqual([]);

            const corrupted: any[] = [
                null,
                undefined,
                {},
                { id: null },
                { id: undefined },
                { id: 'food_1', kcal: 105, isCustom: false },
                { id: 'custom_valid', name: 'Valid', kcal: 100 }
            ];

            const res2 = extractCustomFoodsAndOverrides(corrupted, mockGlobalFoods);
            expect(res2.customFoods).toHaveLength(1);
            expect(res2.customFoods[0].id).toBe('custom_valid');
            expect(res2.overrides.foods?.['food_1']?.kcal).toBe(105);
            expect(res2.overrides.hiddenFoodIds).toHaveLength(4);
        });

        it('Scenario 2.6: Round-trip consistency (migration followed by resolveEffectiveFoods)', () => {
            const legacyFoods: Food[] = [
                { id: 'custom_smoothie', name: 'Berry Smoothie', kcal: 250, pro: 15, carbs: 40, fat: 2, isCustom: true },
                { id: 'food_1', name: 'Petto di Pollo Marinato', kcal: 120, pro: 23.1, carbs: 2, fat: 2, isCustom: false },
                { id: 'food_3', name: 'Olio Extravergine d\'Oliva', kcal: 884, pro: 0, carbs: 0, fat: 100, isCustom: false }
            ];

            const { customFoods, overrides } = extractCustomFoodsAndOverrides(legacyFoods, mockGlobalFoods);
            const resolved = resolveEffectiveFoods(mockGlobalFoods, customFoods, overrides);

            expect(resolved).toHaveLength(3);
            expect(resolved[0].id).toBe('custom_smoothie');
            expect(resolved[0].isCustom).toBe(true);

            expect(resolved[1].id).toBe('food_1');
            expect(resolved[1].name).toBe('Petto di Pollo Marinato');
            expect(resolved[1].kcal).toBe(120);
            expect(resolved[1].carbs).toBe(2);
            expect(resolved[1].isCustom).toBe(false);

            expect(resolved[2].id).toBe('food_3');
            expect(resolved[2].name).toBe('Olio Extravergine d\'Oliva');
            expect(resolved[2].isCustom).toBe(false);

            // Hidden foods must be absent
            expect(resolved.find(f => f.id === 'food_2')).toBeUndefined();
            expect(resolved.find(f => f.id === 'food_4')).toBeUndefined();
            expect(resolved.find(f => f.id === 'food_5')).toBeUndefined();
        });
    });

    describe('3. Stress Test: removeExerciseOverride & removeFoodOverride (Immutability & Idempotency)', () => {

        it('3.1 removeExerciseOverride: Idempotency (repeating removal yields identical object without side effects)', () => {
            const initialOverrides: CatalogOverrides = {
                exercises: {
                    bench: { name: 'Custom Bench', equipmentWeight: 10 },
                    squat: { notes: 'Deep squat' }
                },
                foods: {
                    rice: { kcal: 360 }
                },
                hiddenExerciseIds: ['deadlift'],
                hiddenFoodIds: ['oil']
            };

            const after1 = removeExerciseOverride('bench', initialOverrides);
            const after2 = removeExerciseOverride('bench', after1);
            const after3 = removeExerciseOverride('bench', after2);

            expect(after1.exercises?.bench).toBeUndefined();
            expect(after1.exercises?.squat).toEqual({ notes: 'Deep squat' });
            expect(after2).toEqual(after1);
            expect(after3).toEqual(after1);

            // Preserves other fields
            expect(after1.foods).toEqual({ rice: { kcal: 360 } });
            expect(after1.hiddenExerciseIds).toEqual(['deadlift']);
            expect(after1.hiddenFoodIds).toEqual(['oil']);
        });

        it('3.2 removeExerciseOverride: Immutability (input object and inner dictionaries are never mutated)', () => {
            const initialExercises = {
                bench: { name: 'Custom Bench' },
                squat: { notes: 'Deep squat' }
            };
            const initialOverrides: CatalogOverrides = {
                exercises: initialExercises,
                hiddenExerciseIds: ['deadlift']
            };

            // Deep freeze the input objects to enforce runtime immutability
            Object.freeze(initialExercises.bench);
            Object.freeze(initialExercises.squat);
            Object.freeze(initialExercises);
            Object.freeze(initialOverrides.hiddenExerciseIds);
            Object.freeze(initialOverrides);

            expect(() => {
                const result = removeExerciseOverride('bench', initialOverrides);
                expect(result.exercises?.bench).toBeUndefined();
                expect(result.exercises?.squat).toEqual({ notes: 'Deep squat' });
            }).not.toThrow();

            // Original object must still contain 'bench'
            expect(initialOverrides.exercises?.bench).toBeDefined();
            expect(initialOverrides.exercises?.bench?.name).toBe('Custom Bench');
        });

        it('3.3 removeExerciseOverride: Safe handling of undefined, null, empty overrides and non-existent keys', () => {
            // Undefined overrides
            const res1 = removeExerciseOverride('bench', undefined);
            expect(res1).toEqual({ exercises: {} });

            // Empty overrides
            const res2 = removeExerciseOverride('bench', {});
            expect(res2).toEqual({ exercises: {} });

            // Removing non-existent key
            const overrides: CatalogOverrides = {
                exercises: { squat: { notes: 'Squat note' } }
            };
            const res3 = removeExerciseOverride('non_existent', overrides);
            expect(res3.exercises).toEqual({ squat: { notes: 'Squat note' } });
            expect(res3.exercises).not.toBe(overrides.exercises); // fresh object reference
        });

        it('3.4 removeFoodOverride: Idempotency (repeating removal yields identical object)', () => {
            const initialOverrides: CatalogOverrides = {
                foods: {
                    '101': { kcal: 200, brand: 'Brand A' },
                    '102': { kcal: 300 }
                },
                exercises: {
                    bench: { name: 'Bench' }
                },
                hiddenFoodIds: ['103']
            };

            const after1 = removeFoodOverride('101', initialOverrides);
            const after2 = removeFoodOverride('101', after1);
            const after3 = removeFoodOverride(101, after2); // numeric ID test

            expect(after1.foods?.['101']).toBeUndefined();
            expect(after1.foods?.['102']).toEqual({ kcal: 300 });
            expect(after2).toEqual(after1);
            expect(after3).toEqual(after1);

            // Preserves other fields
            expect(after1.exercises).toEqual({ bench: { name: 'Bench' } });
            expect(after1.hiddenFoodIds).toEqual(['103']);
        });

        it('3.5 removeFoodOverride: Immutability (input object and inner food dictionary are never mutated)', () => {
            const initialFoods = {
                '101': { kcal: 200, brand: 'Brand A' },
                '102': { kcal: 300 }
            };
            const initialOverrides: CatalogOverrides = {
                foods: initialFoods,
                hiddenFoodIds: ['103']
            };

            // Deep freeze input to guarantee zero mutation
            Object.freeze(initialFoods['101']);
            Object.freeze(initialFoods['102']);
            Object.freeze(initialFoods);
            Object.freeze(initialOverrides.hiddenFoodIds);
            Object.freeze(initialOverrides);

            expect(() => {
                const result = removeFoodOverride(101, initialOverrides);
                expect(result.foods?.['101']).toBeUndefined();
                expect(result.foods?.['102']).toEqual({ kcal: 300 });
            }).not.toThrow();

            // Original object must still contain '101'
            expect(initialOverrides.foods?.['101']).toBeDefined();
            expect(initialOverrides.foods?.['101']?.kcal).toBe(200);
        });

        it('3.6 removeFoodOverride: Safe handling of undefined, empty overrides, and non-existent keys', () => {
            const res1 = removeFoodOverride('101', undefined);
            expect(res1).toEqual({ foods: {} });

            const res2 = removeFoodOverride('101', {});
            expect(res2).toEqual({ foods: {} });

            const overrides: CatalogOverrides = {
                foods: { '102': { kcal: 300 } }
            };
            const res3 = removeFoodOverride('non_existent', overrides);
            expect(res3.foods).toEqual({ '102': { kcal: 300 } });
            expect(res3.foods).not.toBe(overrides.foods);
        });
    });

    describe('4. Comprehensive Override Lifecycle Integration', () => {

        it('4.1 Full lifecycle: Default -> Apply Override -> Resolve -> Remove Override -> Resolve to Default', () => {
            const baseExercise = mockGlobalExercises[0]; // bench_press
            let overrides: CatalogOverrides = {};

            // 1. Initial resolution (Default)
            let resolved = resolveEffectiveExercises(mockGlobalExercises, [], overrides);
            let bench = resolved.find(e => e.id === baseExercise.id);
            expect(bench?.name).toBe('Panca Piana Bilanciere');
            expect(bench?.equipmentWeight).toBe(20);

            // 2. Apply override
            overrides = applyExerciseOverride(baseExercise.id, {
                name: 'Panca Piana Inclinata Special',
                equipmentWeight: 15,
                notes: 'Setup custom'
            }, overrides);

            resolved = resolveEffectiveExercises(mockGlobalExercises, [], overrides);
            bench = resolved.find(e => e.id === baseExercise.id);
            expect(bench?.name).toBe('Panca Piana Inclinata Special');
            expect(bench?.equipmentWeight).toBe(15);
            expect(bench?.notes).toBe('Setup custom');

            // 3. Remove override
            overrides = removeExerciseOverride(baseExercise.id, overrides);

            resolved = resolveEffectiveExercises(mockGlobalExercises, [], overrides);
            bench = resolved.find(e => e.id === baseExercise.id);
            expect(bench?.name).toBe('Panca Piana Bilanciere');
            expect(bench?.equipmentWeight).toBe(20);
            expect(bench?.notes).toBeUndefined();
        });

        it('4.2 Full lifecycle: Default Food -> Apply Override -> Resolve -> Remove Override -> Resolve to Default', () => {
            const baseFood = mockGlobalFoods[0]; // food_1 (Petto di Pollo Crudo, kcal: 103)
            let overrides: CatalogOverrides = {};

            // 1. Initial resolution
            let resolved = resolveEffectiveFoods(mockGlobalFoods, [], overrides);
            let food = resolved.find(f => f.id === baseFood.id);
            expect(food?.kcal).toBe(103);
            expect(food?.brand).toBe('Generico');

            // 2. Apply override
            overrides = applyFoodOverride(baseFood.id, {
                kcal: 125,
                brand: 'AIA Grigliata'
            }, overrides);

            resolved = resolveEffectiveFoods(mockGlobalFoods, [], overrides);
            food = resolved.find(f => f.id === baseFood.id);
            expect(food?.kcal).toBe(125);
            expect(food?.brand).toBe('AIA Grigliata');

            // 3. Remove override
            overrides = removeFoodOverride(baseFood.id, overrides);

            resolved = resolveEffectiveFoods(mockGlobalFoods, [], overrides);
            food = resolved.find(f => f.id === baseFood.id);
            expect(food?.kcal).toBe(103);
            expect(food?.brand).toBe('Generico');
        });

        it('4.3 Hide / Unhide symmetric lifecycle for exercises and foods', () => {
            let overrides: CatalogOverrides = {};

            // Hide bench
            overrides = hideCatalogExercise('bench_press', overrides);
            let resolvedEx = resolveEffectiveExercises(mockGlobalExercises, [], overrides);
            expect(resolvedEx.find(e => e.id === 'bench_press')).toBeUndefined();

            // Unhide bench
            overrides = unhideCatalogExercise('bench_press', overrides);
            resolvedEx = resolveEffectiveExercises(mockGlobalExercises, [], overrides);
            expect(resolvedEx.find(e => e.id === 'bench_press')).toBeDefined();

            // Hide food_1
            overrides = hideCatalogFood('food_1', overrides);
            let resolvedF = resolveEffectiveFoods(mockGlobalFoods, [], overrides);
            expect(resolvedF.find(f => f.id === 'food_1')).toBeUndefined();

            // Unhide food_1
            overrides = unhideCatalogFood('food_1', overrides);
            resolvedF = resolveEffectiveFoods(mockGlobalFoods, [], overrides);
            expect(resolvedF.find(f => f.id === 'food_1')).toBeDefined();
        });

        it('4.4 mergeCatalogOverrides symmetry and preservation', () => {
            const o1: CatalogOverrides = {
                exercises: { ex1: { name: 'Ex1 Custom' } },
                foods: { f1: { kcal: 100 } },
                hiddenExerciseIds: ['ex_h_1'],
                hiddenFoodIds: ['f_h_1']
            };

            const o2: CatalogOverrides = {
                exercises: { ex2: { notes: 'Ex2 Notes' } },
                foods: { f2: { brand: 'Brand 2' } },
                hiddenExerciseIds: ['ex_h_2', 'ex_h_1'],
                hiddenFoodIds: ['f_h_2']
            };

            const merged = mergeCatalogOverrides(o1, o2);
            expect(merged.exercises?.ex1?.name).toBe('Ex1 Custom');
            expect(merged.exercises?.ex2?.notes).toBe('Ex2 Notes');
            expect(merged.foods?.f1?.kcal).toBe(100);
            expect(merged.foods?.f2?.brand).toBe('Brand 2');
            expect(merged.hiddenExerciseIds).toHaveLength(2);
            expect(merged.hiddenExerciseIds).toEqual(expect.arrayContaining(['ex_h_1', 'ex_h_2']));
            expect(merged.hiddenFoodIds).toHaveLength(2);
            expect(merged.hiddenFoodIds).toEqual(expect.arrayContaining(['f_h_1', 'f_h_2']));

            // Handles null / undefined inputs
            expect(mergeCatalogOverrides(null, o1)).toEqual(o1);
            expect(mergeCatalogOverrides(o1, undefined)).toEqual(o1);
            expect(mergeCatalogOverrides(null, null)).toEqual({
                exercises: {},
                foods: {},
                hiddenExerciseIds: [],
                hiddenFoodIds: []
            });
        });
    });

    describe('5. High-Volume Performance & Stress Benchmarking', () => {

        it('5.1 Migrates 1,000 legacy items with high volume in < 50ms without memory leaks or mutation', () => {
            const largeLegacy: Exercise[] = [];

            // 500 custom items
            for (let i = 0; i < 500; i++) {
                largeLegacy.push({
                    id: `custom_exercise_${i}`,
                    name: `Custom Exercise ${i}`,
                    setsCount: 3,
                    isDefault: false,
                    sets: []
                });
            }

            // 500 default items with various modifications
            const largeGlobals: CatalogExercise[] = [];
            for (let i = 0; i < 500; i++) {
                const id = `global_ex_${i}`;
                largeGlobals.push({
                    id,
                    name: `Global Exercise ${i}`,
                    muscles: ['chest'],
                    trackingType: 'weight_reps',
                    setsCount: 3,
                    isDefault: true
                });

                if (i % 2 === 0) {
                    // modified default in legacy
                    largeLegacy.push({
                        id,
                        name: `Global Exercise ${i} (Modified)`,
                        muscles: ['chest', 'triceps'],
                        trackingType: 'weight_reps',
                        setsCount: 4,
                        isDefault: true,
                        sets: []
                    });
                }
                // i % 2 !== 0 is missing -> should be hidden
            }

            const startTime = performance.now();
            const result = extractCustomExercisesAndOverrides(largeLegacy, largeGlobals);
            const duration = performance.now() - startTime;

            expect(duration).toBeLessThan(100);
            expect(result.customExercises).toHaveLength(500);
            expect(Object.keys(result.overrides.exercises || {})).toHaveLength(250);
            expect(result.overrides.hiddenExerciseIds).toHaveLength(250);

            // Verify effective resolution at scale
            const resolveStart = performance.now();
            const effective = resolveEffectiveExercises(largeGlobals, result.customExercises, result.overrides);
            const resolveDuration = performance.now() - resolveStart;

            expect(resolveDuration).toBeLessThan(50);
            // Total = 500 custom + 250 visible globals = 750
            expect(effective).toHaveLength(750);
            expect(effective[0].isDefault).toBe(false);
            expect(effective[499].isDefault).toBe(false);
            expect(effective[500].isDefault).toBe(true);
        });

        it('5.2 Migrates 1,000 legacy foods with high volume in < 50ms', () => {
            const largeLegacyFoods: Food[] = [];
            const largeGlobalFoods: CatalogFood[] = [];

            for (let i = 0; i < 500; i++) {
                largeLegacyFoods.push({
                    id: `custom_food_${i}`,
                    name: `Custom Food ${i}`,
                    kcal: 100 + i,
                    pro: 10,
                    carbs: 10,
                    fat: 2,
                    isCustom: true
                });
            }

            for (let i = 0; i < 500; i++) {
                const id = `global_food_${i}`;
                largeGlobalFoods.push({
                    id,
                    name: `Global Food ${i}`,
                    kcal: 200,
                    pro: 15,
                    carbs: 20,
                    fat: 5,
                    isCustom: false
                });

                if (i < 300) {
                    largeLegacyFoods.push({
                        id,
                        name: `Global Food ${i}`,
                        kcal: 220, // override kcal
                        pro: 15,
                        carbs: 20,
                        fat: 5,
                        isCustom: false
                    });
                }
            }

            const startTime = performance.now();
            const result = extractCustomFoodsAndOverrides(largeLegacyFoods, largeGlobalFoods);
            const duration = performance.now() - startTime;

            expect(duration).toBeLessThan(100);
            expect(result.customFoods).toHaveLength(500);
            expect(Object.keys(result.overrides.foods || {})).toHaveLength(300);
            expect(result.overrides.hiddenFoodIds).toHaveLength(200); // 500 - 300 = 200 hidden
        });
    });
});
