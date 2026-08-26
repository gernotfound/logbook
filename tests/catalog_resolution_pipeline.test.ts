import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getSeedCatalog,
    getCachedCatalog,
    getInMemoryCatalog,
    saveCatalogToCache,
    clearCatalogCache,
    isCatalogInMemory,
    CATALOG_CACHE_KEY
} from '../src/lib/catalog/catalogService';
import {
    resolveEffectiveExercises,
    resolveEffectiveFoods,
    createExerciseOverride,
    createFoodOverride,
    hideCatalogExercise,
    unhideCatalogExercise,
    hideCatalogFood,
    unhideCatalogFood,
    applyExerciseOverride,
    removeExerciseOverride,
    applyFoodOverride,
    removeFoodOverride,
    mergeCatalogOverrides,
    migrateLegacyLibraryToOverrides,
    migrateLegacyFoodsToOverrides
} from '../src/lib/catalog/deltaResolver';
import type { CatalogExercise, CatalogFood, CatalogOverrides, Exercise, Food } from '../src/types';

describe('Catalog Resolution Pipeline & Service Unit Tests (M1)', () => {
    beforeEach(async () => {
        await clearCatalogCache();
    });

    describe('1. In-Memory & Seed Catalog Access (R2 / M1 Contract)', () => {
        it('getInMemoryCatalog() returns non-null seed catalog on cold start without prior initialization', () => {
            expect(isCatalogInMemory()).toBe(false);
            const catalog = getInMemoryCatalog();
            // Must return a defined, non-null object with a valid manifest (seed is intentionally empty)
            expect(catalog).toBeDefined();
            expect(catalog).not.toBeNull();
            expect(catalog.manifest.version).toBe('1.0.0');
            // Arrays must be valid (empty is acceptable — commit e61a133)
            expect(Array.isArray(catalog.exercises)).toBe(true);
            expect(Array.isArray(catalog.foods)).toBe(true);
            // Must mark the catalog as loaded into in-memory cache
            expect(isCatalogInMemory()).toBe(true);
        });

        it('getInMemoryCatalog(false) returns null when cache is cleared and auto-fallback is disabled', async () => {
            await clearCatalogCache();
            expect(isCatalogInMemory()).toBe(false);
            const catalog = getInMemoryCatalog(false);
            expect(catalog).toBeNull();
        });

        it('getSeedCatalog() is pure and returns a valid empty seed dataset', () => {
            const seed = getSeedCatalog();
            // Manifest must always be valid regardless of seed content
            expect(seed.manifest.docRefs.exercises).toBe('exercises_v1');
            expect(seed.manifest.docRefs.foods).toBe('foods_v1');
            expect(seed.manifest.schemaVersion).toBe(1);

            // Seed is intentionally empty (commit e61a133): users build their catalog manually.
            // The arrays must be valid arrays (never null/undefined), but are expected to be empty.
            expect(Array.isArray(seed.exercises)).toBe(true);
            expect(Array.isArray(seed.foods)).toBe(true);
            expect(seed.exercises).toHaveLength(0);
            expect(seed.foods).toHaveLength(0);

            // Purity: successive calls must return independent array references (no shared state)
            const seed2 = getSeedCatalog();
            expect(seed.exercises).not.toBe(seed2.exercises);
            expect(seed.foods).not.toBe(seed2.foods);
        });

        it('getCachedCatalog() returns in-memory cache if populated and saves seed to cache if empty', async () => {
            // getCachedCatalog() must always return a defined, non-null catalog (even with empty seed)
            const catalog = await getCachedCatalog();
            expect(catalog).toBeDefined();
            expect(catalog).not.toBeNull();
            // Must return valid arrays (empty seed is a valid state — commit e61a133)
            expect(Array.isArray(catalog.exercises)).toBe(true);
            expect(Array.isArray(catalog.foods)).toBe(true);
            // Must mark the catalog as loaded into in-memory cache
            expect(isCatalogInMemory()).toBe(true);
            // Verify the IDB cache was actually written: a second call must return the same manifest
            const catalog2 = await getCachedCatalog();
            expect(catalog2.manifest.version).toBe(catalog.manifest.version);
        });
    });

    describe('2. Effective Exercises Resolution (deltaResolver)', () => {
        const globalExercises: CatalogExercise[] = [
            { id: 'bench', name: 'Panca Piana', muscles: ['chest'], trackingType: 'weight_reps', setsCount: 3, isDefault: true },
            { id: 'squat', name: 'Squat', muscles: ['quads'], trackingType: 'weight_reps', setsCount: 4, isDefault: true },
            { id: 'deadlift', name: 'Stacco', muscles: ['back', 'hamstrings'], trackingType: 'weight_reps', setsCount: 3, isDefault: true },
        ];

        it('handles null and undefined inputs safely', () => {
            const resolved = resolveEffectiveExercises(undefined as any, undefined as any, undefined);
            expect(resolved).toEqual([]);
        });

        it('resolves catalog with user custom exercises placed first and isDefault flags properly assigned', () => {
            const userCustom: Exercise[] = [
                { id: 'custom_curl', name: 'Curl Cavi Inclinato', setsCount: 4, sets: [{ weight: '20', reps: '10', done: false }] }
            ];

            const resolved = resolveEffectiveExercises(globalExercises, userCustom);
            expect(resolved).toHaveLength(4);
            expect(resolved[0].id).toBe('custom_curl');
            expect(resolved[0].isDefault).toBe(false);

            expect(resolved[1].id).toBe('bench');
            expect(resolved[1].isDefault).toBe(true);
            expect(resolved[1].sets).toEqual([]);
        });

        it('applies overrides to global items and respects hidden exercise IDs', () => {
            const overrides: CatalogOverrides = {
                exercises: {
                    bench: {
                        name: 'Panca Piana con Manubri',
                        equipmentWeight: 4,
                        notes: 'Focus scapole addotte'
                    }
                },
                hiddenExerciseIds: ['deadlift']
            };

            const resolved = resolveEffectiveExercises(globalExercises, [], overrides);

            // Deadlift must be hidden
            expect(resolved.find(e => e.id === 'deadlift')).toBeUndefined();
            expect(resolved).toHaveLength(2);

            // Bench must have overrides applied
            const bench = resolved.find(e => e.id === 'bench');
            expect(bench).toBeDefined();
            expect(bench?.name).toBe('Panca Piana con Manubri');
            expect(bench?.equipmentWeight).toBe(4);
            expect(bench?.notes).toBe('Focus scapole addotte');
            expect(bench?.isDefault).toBe(true);

            // Squat is unmodified
            const squat = resolved.find(e => e.id === 'squat');
            expect(squat?.name).toBe('Squat');
        });
    });

    describe('3. Effective Foods Resolution (deltaResolver)', () => {
        const globalFoods: CatalogFood[] = [
            { id: 'f_rice', name: 'Riso Basmati', kcal: 350, pro: 7, carbs: 78, fat: 0.5, brand: 'Generico', isCustom: false },
            { id: 'f_chicken', name: 'Petto di Pollo', kcal: 103, pro: 23, carbs: 0, fat: 1.2, brand: 'Generico', isCustom: false },
            { id: 'f_oil', name: 'Olio EVO', kcal: 884, pro: 0, carbs: 0, fat: 100, brand: 'Generico', isCustom: false },
        ];

        it('resolves foods with user custom foods placed first and isCustom flags set', () => {
            const userCustom: Food[] = [
                { id: 'custom_pancake', name: 'Pancake Proteico', kcal: 220, pro: 18, carbs: 25, fat: 4 }
            ];

            const resolved = resolveEffectiveFoods(globalFoods, userCustom);
            expect(resolved).toHaveLength(4);
            expect(resolved[0].id).toBe('custom_pancake');
            expect(resolved[0].isCustom).toBe(true);

            expect(resolved[1].id).toBe('f_rice');
            expect(resolved[1].isCustom).toBe(false);
        });

        it('applies overrides to global foods and excludes hidden food IDs (string and numeric)', () => {
            const overrides: CatalogOverrides = {
                foods: {
                    f_rice: {
                        kcal: 360,
                        brand: 'Scotti'
                    }
                },
                hiddenFoodIds: ['f_oil']
            };

            const resolved = resolveEffectiveFoods(globalFoods, [], overrides);
            expect(resolved.find(f => f.id === 'f_oil')).toBeUndefined();
            expect(resolved).toHaveLength(2);

            const rice = resolved.find(f => f.id === 'f_rice');
            expect(rice?.kcal).toBe(360);
            expect(rice?.brand).toBe('Scotti');
            expect(rice?.isCustom).toBe(false);
        });
    });

    describe('4. Override Mutation & Symmetrical Helpers', () => {
        it('hides and unhides exercises and foods cleanly without mutating input', () => {
            let overrides: CatalogOverrides = {};

            overrides = hideCatalogExercise('ex1', overrides);
            expect(overrides.hiddenExerciseIds).toEqual(['ex1']);

            overrides = hideCatalogExercise('ex2', overrides);
            expect(overrides.hiddenExerciseIds).toEqual(['ex1', 'ex2']);

            overrides = unhideCatalogExercise('ex1', overrides);
            expect(overrides.hiddenExerciseIds).toEqual(['ex2']);

            overrides = hideCatalogFood(123, overrides);
            expect(overrides.hiddenFoodIds).toEqual(['123']);

            overrides = unhideCatalogFood('123', overrides);
            expect(overrides.hiddenFoodIds).toEqual([]);
        });

        it('applies and removes exercise overrides', () => {
            let overrides: CatalogOverrides = {};
            overrides = applyExerciseOverride('bench', { notes: 'Updated note' }, overrides);
            expect(overrides.exercises?.bench?.notes).toBe('Updated note');

            overrides = removeExerciseOverride('bench', overrides);
            expect(overrides.exercises?.bench).toBeUndefined();
        });

        it('applies and removes food overrides', () => {
            let overrides: CatalogOverrides = {};
            overrides = applyFoodOverride('f_rice', { brand: 'Gallo' }, overrides);
            expect(overrides.foods?.f_rice?.brand).toBe('Gallo');

            overrides = removeFoodOverride('f_rice', overrides);
            expect(overrides.foods?.f_rice).toBeUndefined();
        });

        it('merges catalog overrides symmetrically without data loss', () => {
            const a: CatalogOverrides = {
                exercises: { ex1: { notes: 'Note A' } },
                foods: { f1: { brand: 'Brand A' } },
                hiddenExerciseIds: ['ex_hidden_1'],
                hiddenFoodIds: ['f_hidden_1']
            };

            const b: CatalogOverrides = {
                exercises: { ex2: { equipmentWeight: 10 } },
                foods: { f2: { kcal: 200 } },
                hiddenExerciseIds: ['ex_hidden_2'],
                hiddenFoodIds: ['f_hidden_2']
            };

            const merged = mergeCatalogOverrides(a, b);
            expect(merged.exercises?.ex1?.notes).toBe('Note A');
            expect(merged.exercises?.ex2?.equipmentWeight).toBe(10);
            expect(merged.foods?.f1?.brand).toBe('Brand A');
            expect(merged.foods?.f2?.kcal).toBe(200);
            expect(merged.hiddenExerciseIds).toEqual(expect.arrayContaining(['ex_hidden_1', 'ex_hidden_2']));
            expect(merged.hiddenFoodIds).toEqual(expect.arrayContaining(['f_hidden_1', 'f_hidden_2']));
        });
    });

    describe('5. Legacy Migration Safeguards (Distinguishing Custom vs Default)', () => {
        const globalExercises: CatalogExercise[] = [
            { id: 'ex_default_1', name: 'Default Bench', trackingType: 'weight_reps', isDefault: true },
            { id: 'ex_default_2', name: 'Default Squat', trackingType: 'weight_reps', isDefault: true },
            { id: 'ex_default_3', name: 'Default Deadlift', trackingType: 'weight_reps', isDefault: true },
        ];

        const globalFoods: CatalogFood[] = [
            { id: 'food_default_1', name: 'Default Rice', kcal: 350, pro: 7, carbs: 78, fat: 0.5, isCustom: false },
            { id: 'food_default_2', name: 'Default Chicken', kcal: 103, pro: 23, carbs: 0, fat: 1.2, isCustom: false },
        ];

        it('migrates monolithic legacy library with deleted items, computing hidden IDs', () => {
            const legacyLibrary: Exercise[] = [
                { id: 'ex_default_1', name: 'Default Bench Modified', setsCount: 3, isDefault: true, sets: [] },
                { id: 'custom_ex', name: 'User Custom Exercise', setsCount: 3, isDefault: false, sets: [] }
                // ex_default_2 and ex_default_3 are missing -> should become hidden
            ];

            const migrated = migrateLegacyLibraryToOverrides(legacyLibrary, globalExercises);
            expect(migrated.customExercises).toHaveLength(1);
            expect(migrated.customExercises[0].id).toBe('custom_ex');
            expect(migrated.customExercises[0].isDefault).toBe(false);

            expect(migrated.overrides.exercises?.ex_default_1?.name).toBe('Default Bench Modified');
            expect(migrated.overrides.hiddenExerciseIds).toEqual(expect.arrayContaining(['ex_default_2', 'ex_default_3']));
        });

        it('does NOT mark all global items hidden if library contains only custom exercises (presentDefaultIds is 0)', () => {
            const customOnlyLibrary: Exercise[] = [
                { id: 'custom_ex_1', name: 'Custom Exercise 1', setsCount: 3, isDefault: false, sets: [] },
                { id: 'custom_ex_2', name: 'Custom Exercise 2', setsCount: 4, isDefault: false, sets: [] }
            ];

            const migrated = migrateLegacyLibraryToOverrides(customOnlyLibrary, globalExercises);
            expect(migrated.customExercises).toHaveLength(2);
            // Crucial: hiddenExerciseIds must be EMPTY, not hiding all 3 global items!
            expect(migrated.overrides.hiddenExerciseIds).toEqual([]);
        });

        it('does NOT mark all global foods hidden if customFoods contains only custom foods', () => {
            const customOnlyFoods: Food[] = [
                { id: 'custom_shake', name: 'Custom Shake', kcal: 250, pro: 30, carbs: 10, fat: 2, isCustom: true }
            ];

            const migrated = migrateLegacyFoodsToOverrides(customOnlyFoods, globalFoods);
            expect(migrated.customFoods).toHaveLength(1);
            expect(migrated.customFoods[0].id).toBe('custom_shake');
            expect(migrated.customFoods[0].isCustom).toBe(true);
            // Crucial: hiddenFoodIds must be EMPTY!
            expect(migrated.overrides.hiddenFoodIds).toEqual([]);
        });
    });
});
