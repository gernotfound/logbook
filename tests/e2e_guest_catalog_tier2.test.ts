import { describe, it, expect, beforeEach, vi } from 'vitest';
import { set as idbSet } from 'idb-keyval';

vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import {
    getCachedCatalog,
    getSeedCatalog,
    clearCatalogCache,
    CATALOG_CACHE_KEY
} from '../src/lib/catalog/catalogService';
import {
    resolveEffectiveExercises,
    resolveEffectiveFoods,
    hideCatalogExercise,
    unhideCatalogExercise
} from '../src/lib/catalog/deltaResolver';
import { UserDataSchema } from '../src/lib/schema';
import { useAppStore } from '../src/store/useAppStore';
import type { CatalogExercise, CatalogFood, CatalogOverrides } from '../src/types';
import { idbStore } from './setup';

describe('E2E Suite: Guest Mode & Global Catalog Resolution', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        localStorage.clear();
        for (const key in idbStore) {
            delete idbStore[key];
        }
        await clearCatalogCache();
        DB.resetCache();
        useAppStore.getState().resetStore();
    });

    // =========================================================================
    // TIER 2: BOUNDARY & CORNER CASES
    // =========================================================================
    describe('Tier 2: Boundary & Corner Cases (Storage Resilience, Edge Overrides & Defensive Sanitization)', () => {

        it('T2.1: Corrupted IndexedDB catalog data falls back gracefully to seed catalog without throwing', async () => {
            // Write malformed/corrupted non-object string directly to IndexedDB
            await idbSet(CATALOG_CACHE_KEY, 'CORRUPTED_MALFORMED_NON_OBJECT_BINARY_DATA');

            // getCachedCatalog should detect corruption, log warning, and return bundled seed
            const catalog = await getCachedCatalog();
            expect(catalog).toBeDefined();
            expect(catalog.manifest.version).toBe('1.0.0');
            // Fallback returns valid seed catalog arrays
            expect(Array.isArray(catalog.exercises)).toBe(true);
            expect(Array.isArray(catalog.foods)).toBe(true);
            expect(catalog.exercises.length).toBe(0);
            expect(catalog.foods.length).toBe(0);
        });

        it('T2.2: Missing or undefined catalogOverrides object handled safely with full catalog fallback', () => {
            const seed = getSeedCatalog();

            // Undefined overrides
            const exUndef = resolveEffectiveExercises(seed.exercises, [], undefined);
            const foodUndef = resolveEffectiveFoods(seed.foods, [], undefined);
            expect(exUndef).toHaveLength(seed.exercises.length);
            expect(foodUndef).toHaveLength(seed.foods.length);

            // Empty object overrides
            const exEmpty = resolveEffectiveExercises(seed.exercises, [], {});
            const foodEmpty = resolveEffectiveFoods(seed.foods, [], {});
            expect(exEmpty).toHaveLength(seed.exercises.length);
            expect(foodEmpty).toHaveLength(seed.foods.length);

            // Partial empty sub-structures
            const partialOverrides: CatalogOverrides = {
                exercises: {},
                foods: {},
                hiddenExerciseIds: [],
                hiddenFoodIds: []
            };
            const exPartial = resolveEffectiveExercises(seed.exercises, [], partialOverrides);
            expect(exPartial).toHaveLength(seed.exercises.length);
        });

        it('T2.3: Zero custom items returns 100% standard items with deterministic default flags', () => {
            const seed = getSeedCatalog();

            const exercises = resolveEffectiveExercises(seed.exercises, []);
            expect(exercises.every(e => e.isDefault === true)).toBe(true);

            const foods = resolveEffectiveFoods(seed.foods, []);
            expect(foods.every(f => f.isCustom === false)).toBe(true);
        });

        it('T2.4: Partial and idempotent override operations: unhide non-hidden and hide non-existent items', () => {
            // Local fixture with the exercises referenced by this test
            const globalExFixture: CatalogExercise[] = [
                { id: 'panca-piana-bilanciere', name: 'Panca Piana Bilanciere', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 3 }
            ];

            let overrides: CatalogOverrides = {};

            // Unhide item that was never hidden -> safe no-op
            overrides = unhideCatalogExercise('panca-piana-bilanciere', overrides);
            expect(overrides.hiddenExerciseIds).toEqual([]);

            // Hide non-existent catalog ID -> recorded in hidden set without breaking resolution
            overrides = hideCatalogExercise('non-existent-exercise-id-999', overrides);
            expect(overrides.hiddenExerciseIds).toContain('non-existent-exercise-id-999');

            const resolved = resolveEffectiveExercises(globalExFixture, [], overrides);
            expect(resolved).toHaveLength(globalExFixture.length); // None of the fixture items hidden

            // Idempotent hiding: hiding the same exercise twice does not duplicate ID
            overrides = hideCatalogExercise('panca-piana-bilanciere', overrides);
            overrides = hideCatalogExercise('panca-piana-bilanciere', overrides);
            expect(overrides.hiddenExerciseIds?.filter(id => id === 'panca-piana-bilanciere')).toHaveLength(1);

            // Unhide restores item
            overrides = unhideCatalogExercise('panca-piana-bilanciere', overrides);
            expect(overrides.hiddenExerciseIds).not.toContain('panca-piana-bilanciere');

            const resolvedAfterUnhide = resolveEffectiveExercises(globalExFixture, [], overrides);
            expect(resolvedAfterUnhide.find(e => e.id === 'panca-piana-bilanciere')).toBeDefined();
        });

        it('T2.5: Override with empty strings, undefined fields, and partial macro updates preserves base fields', () => {
            // Local fixture for petto-di-pollo-crudo (seed is empty — commit e61a133)
            const globalFoodsFixture: CatalogFood[] = [
                { id: 'petto-di-pollo-crudo', name: 'Petto di pollo crudo', kcal: 106, pro: 22.5, carbs: 0, fat: 1.9, brand: undefined, isCustom: false }
            ];
            const baseFood = globalFoodsFixture[0];

            // Apply override only updating carbs from 0 to 1, leaving pro/fat/kcal undefined
            const overrides: CatalogOverrides = {
                foods: {
                    'petto-di-pollo-crudo': {
                        carbs: 1
                    }
                }
            };

            const resolvedFoods = resolveEffectiveFoods(globalFoodsFixture, [], overrides);
            const overriddenFood = resolvedFoods.find(f => f.id === 'petto-di-pollo-crudo')!;

            expect(overriddenFood.carbs).toBe(1); // updated
            expect(overriddenFood.kcal).toBe(baseFood.kcal); // base preserved
            expect(overriddenFood.pro).toBe(baseFood.pro); // base preserved
            expect(overriddenFood.fat).toBe(baseFood.fat); // base preserved
            expect(overriddenFood.brand).toBe(baseFood.brand); // base preserved
        });

        it('T2.6: Schema resilience: UserDataSchema parses and sanitizes catalogOverrides safely', () => {
            const rawData = {
                profile: {},
                library: [],
                routines: [],
                customFoods: [],
                catalogOverrides: {
                    exercises: {
                        'panca-piana-bilanciere': { name: 'Panca Piana Pro', notes: 'Grip largo' }
                    },
                    foods: {
                        'petto-di-pollo-crudo': { kcal: 110, pro: 25 }
                    },
                    hiddenExerciseIds: ['panca-declinata-bilanciere'],
                    hiddenFoodIds: ['petto-di-tacchino-crudo']
                }
            };

            const parsed = UserDataSchema.parse(rawData);
            expect(parsed.catalogOverrides?.exercises?.['panca-piana-bilanciere']?.name).toBe('Panca Piana Pro');
            expect(parsed.catalogOverrides?.hiddenExerciseIds).toContain('panca-declinata-bilanciere');
            expect(parsed.catalogOverrides?.hiddenFoodIds).toContain('petto-di-tacchino-crudo');
        });
    });
});
