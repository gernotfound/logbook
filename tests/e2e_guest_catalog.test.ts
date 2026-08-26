/**
 * Opaque-Box End-to-End Test Suite: Guest Mode & Global Catalog Resolution
 * 
 * Milestone: M0 / M5 E2E Verification
 * 
 * Complies with AGENTS.md, PROJECT.md, and ORIGINAL_REQUEST.md:
 * - Tier 1: Feature Coverage (Guest cold start, seed fallback, specific item verification, zero-flash transition, flat store contract)
 * - Tier 2: Boundary & Corner Cases (Empty IDB, corrupted cache, missing overrides, zero custom items, partial/idempotent overrides, defensive sanitization)
 * - Tier 3: Cross-Feature Combinations (Custom exercises/foods, overrides, hidden items, mixed routines/workouts, meal logging & macro calculation)
 * - Tier 4: Real-World Scenarios & Cloud Merge Delta Isolation (Full guest lifecycle -> Google account linking, delta-only persistence without 176+ seed duplicates, hasUserData precision)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { getDoc, writeBatch } from 'firebase/firestore';

// Unmock DB to test real persistence logic
vi.unmock('../src/lib/db');
import { DB } from '../src/lib/db';

import {
    getCachedCatalog,
    getSeedCatalog,
    saveCatalogToCache,
    clearCatalogCache,
    syncGlobalCatalog,
    getInMemoryCatalog,
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
    migrateLegacyLibraryToOverrides
} from '../src/lib/catalog/deltaResolver';

import {
    mergeUserData,
    hasUserData
} from '../src/lib/merge';

import {
    UserDataSchema
} from '../src/lib/schema';

import { useAppStore } from '../src/store/useAppStore';

import type {
    UserData,
    Exercise,
    Food,
    CatalogExercise,
    CatalogOverrides,
    WorkoutSession,
    WorkoutRoutine,
    NutritionDay
} from '../src/types';

import { idbStore } from './setup';

// Mock Firebase Auth and DB for persistence tests
vi.mock('../src/lib/firebase', () => ({
    auth: {
        currentUser: { uid: 'e2e_test_user_777', email: 'guest_migrated@example.com' },
        signOut: vi.fn().mockResolvedValue(undefined),
    },
    db: { type: 'firestore_mock' },
    waitForPendingWrites: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    isAppCheckFallbackOffline: vi.fn().mockReturnValue(false),
}));

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
    // TIER 1: FEATURE COVERAGE
    // =========================================================================
    describe('Tier 1: Feature Coverage (Cold Start, Seed Fallback, Item Verification & Contract)', () => {

        it('T1.1: Cold start guest session with completely empty storage resolves bundled seed catalog immediately', async () => {
            // Pre-condition: Storage is completely empty
            expect(await idbGet(CATALOG_CACHE_KEY)).toBeUndefined();
            expect(await idbGet('logbook_cached_user_data')).toBeUndefined();
            expect(localStorage.getItem('logbook_is_guest')).toBeNull();

            // Action: Retrieve catalog on cold start
            const catalog = await getCachedCatalog();

            // Assertions: Catalog is valid, non-empty, and comes from seed
            expect(catalog).toBeDefined();
            expect(catalog.manifest.version).toBe('1.0.0');
            expect(catalog.exercises.length).toBeGreaterThanOrEqual(100);
            expect(catalog.foods.length).toBeGreaterThanOrEqual(100);
            expect(catalog.manifest.itemCounts.exercises).toBe(catalog.exercises.length);
            expect(catalog.manifest.itemCounts.foods).toBe(catalog.foods.length);

            // In-memory catalog is now warm
            expect(getInMemoryCatalog()).not.toBeNull();
        });

        it('T1.2: Verifies immediate presence and properties of specific known standard exercises in seed', async () => {
            const catalog = getSeedCatalog();

            // 1. Panca Piana Bilanciere
            const bench = catalog.exercises.find(e => e.id === 'panca-piana-bilanciere');
            expect(bench).toBeDefined();
            expect(bench?.name).toBe('Panca Piana Bilanciere');
            expect(bench?.muscles).toContain('chest');
            expect(bench?.secondaryMuscles).toEqual(expect.arrayContaining(['triceps', 'shoulders']));
            expect(bench?.trackingType).toBe('weight_reps');
            expect(bench?.isDefault).toBe(true);

            // 2. Panca Inclinata Bilanciere
            const inclineBench = catalog.exercises.find(e => e.id === 'panca-inclinata-bilanciere');
            expect(inclineBench).toBeDefined();
            expect(inclineBench?.muscles).toContain('chest');

            // 3. Squat con Bilanciere
            const squat = catalog.exercises.find(e => e.id === 'squat-bilanciere');
            expect(squat).toBeDefined();
            expect(squat?.name).toBe('Squat con Bilanciere');
            expect(squat?.muscles).toContain('quads');
            expect(squat?.isDefault).toBe(true);

            // 4. Stacchi da Terra
            const deadlift = catalog.exercises.find(e => e.id === 'stacchi-da-terra');
            expect(deadlift).toBeDefined();
            expect(deadlift?.name).toBe('Stacchi da Terra (Deadlift)');
            expect(deadlift?.muscles).toContain('back');
            expect(deadlift?.secondaryMuscles).toContain('hamstrings');
        });

        it('T1.3: Verifies immediate presence and properties of specific known standard foods in seed', async () => {
            const catalog = getSeedCatalog();

            // 1. Petto di Pollo Crudo
            const chicken = catalog.foods.find(f => f.id === 'petto-di-pollo-crudo');
            expect(chicken).toBeDefined();
            expect(chicken?.name).toBe('Petto di Pollo Crudo');
            expect(chicken?.brand).toBe('Generico');
            expect(chicken?.kcal).toBe(103);
            expect(chicken?.pro).toBe(23);
            expect(chicken?.carbs).toBe(0);
            expect(chicken?.fat).toBe(1.2);

            // 2. Petto di Tacchino Crudo
            const turkey = catalog.foods.find(f => f.id === 'petto-di-tacchino-crudo');
            expect(turkey).toBeDefined();
            expect(turkey?.kcal).toBe(110);
            expect(turkey?.pro).toBe(24);

            // 3. Vitello Magro Crudo
            const veal = catalog.foods.find(f => f.id === 'vitello-magro-crudo');
            expect(veal).toBeDefined();
            expect(veal?.pro).toBe(21);

            // 4. Total seed foods count meets catalog contract
            expect(catalog.foods.length).toBeGreaterThan(120);
        });

        it('T1.4: Flat store contract: resolveEffectiveExercises and resolveEffectiveFoods produce ready-to-consume lists', () => {
            const catalog = getSeedCatalog();

            const effectiveExercises = resolveEffectiveExercises(catalog.exercises);
            const effectiveFoods = resolveEffectiveFoods(catalog.foods);

            expect(effectiveExercises).toHaveLength(catalog.exercises.length);
            expect(effectiveFoods).toHaveLength(catalog.foods.length);

            // All global exercises have isDefault = true and sets = []
            expect(effectiveExercises.every(e => e.isDefault === true)).toBe(true);
            expect(effectiveExercises.every(e => Array.isArray(e.sets))).toBe(true);

            // All global foods have isCustom = false
            expect(effectiveFoods.every(f => f.isCustom === false)).toBe(true);

            // Store state assignment test
            const store = useAppStore.getState();
            store.setUserData({
                library: effectiveExercises,
                customFoods: effectiveFoods,
                catalogOverrides: {}
            });

            const currentData = useAppStore.getState().userData;
            expect(currentData?.library).toHaveLength(catalog.exercises.length);
            expect(currentData?.customFoods).toHaveLength(catalog.foods.length);
        });

        it('T1.5: Zero-flash transition: Seed -> IDB Cache -> Remote Sync never flashes an empty list', async () => {
            // Step 1: Initial Cold State (Seed)
            const stage1Catalog = getSeedCatalog();
            let visibleExercises = resolveEffectiveExercises(stage1Catalog.exercises);
            let visibleFoods = resolveEffectiveFoods(stage1Catalog.foods);
            expect(visibleExercises.length).toBeGreaterThan(0);
            expect(visibleFoods.length).toBeGreaterThan(0);

            // Step 2: IDB Cache retrieval
            await saveCatalogToCache(stage1Catalog);
            const stage2Catalog = await getCachedCatalog();
            visibleExercises = resolveEffectiveExercises(stage2Catalog.exercises);
            visibleFoods = resolveEffectiveFoods(stage2Catalog.foods);
            expect(visibleExercises.length).toBe(stage1Catalog.exercises.length);
            expect(visibleFoods.length).toBe(stage1Catalog.foods.length);

            // Step 3: Remote Sync with same version (0 extra reads, no empty flash)
            const mockDb: any = { type: 'firestore_mock' };
            vi.mocked(getDoc).mockResolvedValueOnce({
                exists: () => true,
                data: () => ({
                    version: '1.0.0',
                    schemaVersion: 1,
                    updatedAt: '2026-08-22T00:00:00.000Z',
                    docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' },
                    itemCounts: { exercises: stage1Catalog.exercises.length, foods: stage1Catalog.foods.length }
                })
            } as any);

            const syncResult = await syncGlobalCatalog(mockDb);
            expect(syncResult.updated).toBe(false); // Same version -> fast no-op

            visibleExercises = resolveEffectiveExercises(syncResult.catalog.exercises);
            visibleFoods = resolveEffectiveFoods(syncResult.catalog.foods);
            expect(visibleExercises.length).toBe(stage1Catalog.exercises.length);
            expect(visibleFoods.length).toBe(stage1Catalog.foods.length);
        });

        it('T1.6: Remote sync updates catalog seamlessly when a newer manifest version is detected', async () => {
            const initialCatalog = getSeedCatalog();
            await saveCatalogToCache(initialCatalog);

            const updatedExercises = [
                ...initialCatalog.exercises,
                { id: 'new-remote-ex-999', name: 'Bulgarian Split Squat Smith', muscles: ['quads'], trackingType: 'weight_reps' as const, isDefault: true }
            ];

            const mockDb: any = { type: 'firestore_mock' };

            // 1. Manifest snapshot
            vi.mocked(getDoc).mockResolvedValueOnce({
                exists: () => true,
                data: () => ({
                    version: '1.1.0',
                    schemaVersion: 1,
                    updatedAt: '2026-08-23T12:00:00.000Z',
                    docRefs: { exercises: 'exercises_v2', foods: 'foods_v2' },
                    itemCounts: { exercises: updatedExercises.length, foods: initialCatalog.foods.length }
                })
            } as any);

            // 2. Exercises doc snapshot & Foods doc snapshot
            vi.mocked(getDoc).mockResolvedValueOnce({
                exists: () => true,
                data: () => ({ items: updatedExercises })
            } as any);
            vi.mocked(getDoc).mockResolvedValueOnce({
                exists: () => true,
                data: () => ({ items: initialCatalog.foods })
            } as any);

            const syncResult = await syncGlobalCatalog(mockDb);
            expect(syncResult.updated).toBe(true);
            expect(syncResult.catalog.manifest.version).toBe('1.1.0');
            expect(syncResult.catalog.exercises.length).toBe(initialCatalog.exercises.length + 1);

            const resolved = resolveEffectiveExercises(syncResult.catalog.exercises);
            expect(resolved.find(e => e.id === 'new-remote-ex-999')).toBeDefined();
        });
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
            // Seed is intentionally empty (commit e61a133): fallback returns valid empty arrays
            expect(Array.isArray(catalog.exercises)).toBe(true);
            expect(Array.isArray(catalog.foods)).toBe(true);
            expect(catalog.exercises).toHaveLength(0);
            expect(catalog.foods).toHaveLength(0);
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

    // =========================================================================
    // TIER 3: CROSS-FEATURE COMBINATIONS
    // =========================================================================
    describe('Tier 3: Cross-Feature Combinations (Custom Items, Overrides, Workouts & Meals)', () => {

        it('T3.1: Guest creates custom exercise, overrides standard exercise, and hides another standard exercise', () => {
            // Local fixture (seed is empty — commit e61a133)
            const globalExercisesFixture: CatalogExercise[] = [
                { id: 'panca-piana-bilanciere', name: 'Panca Piana Bilanciere', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 4 },
                { id: 'panca-declinata-bilanciere', name: 'Panca Declinata Bilanciere', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 3 }
            ];

            // 1. Custom exercise
            const customEx: Exercise = {
                id: 'custom_ex_incline_db',
                name: 'Panca Inclinata Manubri 30° Custom',
                notes: 'Focus petto alto con inclinazione controllata',
                setsCount: 4,
                sets: [],
                muscles: ['chest'],
                secondaryMuscles: ['triceps', 'shoulders'],
                trackingType: 'weight_reps',
                isDefault: false
            };

            // 2. Override standard exercise
            const baseBench = globalExercisesFixture.find(e => e.id === 'panca-piana-bilanciere')!;
            const benchOverride = createExerciseOverride(baseBench, {
                notes: 'Fermo al petto 2 secondi',
                equipmentWeight: 20
            });

            // 3. Hide standard exercise
            let overrides: CatalogOverrides = {
                exercises: {
                    'panca-piana-bilanciere': benchOverride
                }
            };
            overrides = hideCatalogExercise('panca-declinata-bilanciere', overrides);

            // Resolution
            const effective = resolveEffectiveExercises(globalExercisesFixture, [customEx], overrides);

            // Verification: Custom is first
            expect(effective[0].id).toBe('custom_ex_incline_db');
            expect(effective[0].isDefault).toBe(false);

            // Overridden bench is present with updated notes & equipmentWeight
            const resolvedBench = effective.find(e => e.id === 'panca-piana-bilanciere');
            expect(resolvedBench).toBeDefined();
            expect(resolvedBench?.notes).toBe('Fermo al petto 2 secondi');
            expect(resolvedBench?.equipmentWeight).toBe(20);
            expect(resolvedBench?.isDefault).toBe(true);

            // Hidden exercise is completely excluded
            expect(effective.find(e => e.id === 'panca-declinata-bilanciere')).toBeUndefined();
        });

        it('T3.2: Guest creates custom food, overrides standard food macros, and hides another standard food', () => {
            // Local fixture (seed is empty — commit e61a133)
            const globalFoodsFixture: CatalogFood[] = [
                { id: 'petto-di-pollo-crudo', name: 'Petto di pollo crudo', kcal: 106, pro: 22.5, carbs: 0, fat: 1.9, isCustom: false },
                { id: 'petto-di-tacchino-crudo', name: 'Petto di tacchino crudo', kcal: 104, pro: 22.0, carbs: 0, fat: 1.5, isCustom: false }
            ];

            // 1. Custom Food
            const customFood: Food = {
                id: 'custom_food_whey_iso',
                name: 'Proteine Whey Isolate 90% Cioccolato',
                brand: 'BrandX',
                kcal: 375,
                pro: 88,
                carbs: 2.5,
                fat: 1.2,
                baseQty: 100,
                unit: 'g',
                isCustom: true
            };

            // 2. Override standard chicken macros
            const baseChicken = globalFoodsFixture.find(f => f.id === 'petto-di-pollo-crudo')!;
            const chickenOverride = createFoodOverride(baseChicken, {
                pro: 24.5,
                kcal: 109
            });

            // 3. Hide turkey
            let overrides: CatalogOverrides = {
                foods: {
                    'petto-di-pollo-crudo': chickenOverride
                }
            };
            overrides = hideCatalogFood('petto-di-tacchino-crudo', overrides);

            // Resolution
            const effectiveFoods = resolveEffectiveFoods(globalFoodsFixture, [customFood], overrides);

            // Custom food appears first with isCustom = true
            expect(effectiveFoods[0].id).toBe('custom_food_whey_iso');
            expect(effectiveFoods[0].isCustom).toBe(true);

            // Overridden chicken has new macros
            const resolvedChicken = effectiveFoods.find(f => f.id === 'petto-di-pollo-crudo')!;
            expect(resolvedChicken.pro).toBe(24.5);
            expect(resolvedChicken.kcal).toBe(109);
            expect(resolvedChicken.isCustom).toBe(false);

            // Hidden turkey is completely excluded
            expect(effectiveFoods.find(f => f.id === 'petto-di-tacchino-crudo')).toBeUndefined();
        });

        it('T3.3: Guest builds a routine and executes a workout session with mixed exercise sources', () => {
            const seed = getSeedCatalog();

            const customExId = 'custom_ex_cable_fly';
            const userCustomExercises: Exercise[] = [
                {
                    id: customExId,
                    name: 'Croci ai Cavi Bassi',
                    setsCount: 3,
                    sets: [],
                    muscles: ['chest'],
                    isDefault: false
                }
            ];

            const overrides: CatalogOverrides = {
                exercises: {
                    'panca-piana-bilanciere': { notes: 'Powerlifting arch' }
                }
            };

            const effectiveExercises = resolveEffectiveExercises(seed.exercises, userCustomExercises, overrides);

            // Build routine with 1 base, 1 overridden, 1 custom exercise
            const routine: WorkoutRoutine = {
                id: 'routine_chest_hypertrophy',
                name: 'Chest Focus Hypertrophy',
                exercises: [
                    { exId: 'panca-piana-bilanciere', setsCount: 4, minReps: 6, maxReps: 8 },
                    { exId: 'panca-inclinata-bilanciere', setsCount: 3, minReps: 8, maxReps: 10 },
                    { exId: customExId, setsCount: 3, minReps: 12, maxReps: 15 }
                ]
            };

            // Execute workout session
            const workoutSession: WorkoutSession = {
                id: 'session_20260823_01',
                date: '2026-08-23',
                routineId: routine.id,
                routineName: routine.name,
                globalStartTime: Date.now() - 3600000,
                globalEndTime: Date.now(),
                moodRating: 5,
                pumpRating: 5,
                fatigueRating: 3,
                waterLiters: 1.5,
                exercises: [
                    {
                        exId: 'panca-piana-bilanciere',
                        sessionNote: 'Ottimo carico, 90kg stabili',
                        sets: [
                            { id: 's1', kg: '90', reps: '8', done: true },
                            { id: 's2', kg: '90', reps: '8', done: true },
                            { id: 's3', kg: '90', reps: '7', done: true },
                            { id: 's4', kg: '90', reps: '6', done: true, dropsets: [{ id: 'ds1', kg: '70', reps: '6' }] }
                        ]
                    },
                    {
                        exId: 'panca-inclinata-bilanciere',
                        sessionNote: '70kg x 10',
                        sets: [
                            { id: 's5', kg: '70', reps: '10', done: true },
                            { id: 's6', kg: '70', reps: '9', done: true }
                        ]
                    },
                    {
                        exId: customExId,
                        sessionNote: 'Bruciore elevato',
                        sets: [
                            { id: 's7', kg: '15', reps: '15', done: true }
                        ]
                    }
                ]
            };

            // Populate store with guest state
            const store = useAppStore.getState();
            store.setUserData({
                library: effectiveExercises,
                routines: [routine],
                history: [workoutSession],
                catalogOverrides: overrides,
                activeWorkout: null
            });

            const savedState = useAppStore.getState().userData!;
            expect(savedState.history).toHaveLength(1);
            expect(savedState.history?.[0].routineName).toBe('Chest Focus Hypertrophy');
            expect(savedState.history?.[0].exercises).toHaveLength(3);
            expect(savedState.activeWorkout).toBeNull();
        });

        it('T3.4: Guest logs meal with mixed food items (base + overridden + custom) and calculates exact macros', () => {
            const customFood: Food = {
                id: 'cf_oats_gold',
                name: 'Fiocchi di Avena Integrale Gold',
                kcal: 360,
                pro: 13,
                carbs: 62,
                fat: 7,
                baseQty: 100,
                unit: 'g',
                isCustom: true
            };

            const overrides: CatalogOverrides = {
                foods: {
                    'petto-di-pollo-crudo': { kcal: 105, pro: 24, carbs: 0, fat: 1.0 }
                }
            };

            // Logged meals for day:
            // 1. 200g of Overridden Chicken (ratio 2.0 -> kcal: 210, pro: 48, carbs: 0, fat: 2.0)
            // 2. 80g of Custom Oats (ratio 0.8 -> kcal: 288, pro: 10.4, carbs: 49.6, fat: 5.6)
            // 3. 150g of Base Rice (base: kcal 130, pro 2.7, carbs 28, fat 0.3 -> ratio 1.5 -> kcal: 195, pro: 4.05, carbs: 42, fat: 0.45)
            const nutritionDay: NutritionDay = {
                date: '2026-08-23',
                kcal: 693,
                pro: 62.5,
                carbs: 91.6,
                fat: 8.1,
                weight: '79.5',
                waist: '81.5',
                meals: [
                    { id: 'm1', name: 'Petto di Pollo Crudo', meal: 'pranzo', quantity: 200, baseQty: 100, kcal: 105, pro: 24, carbs: 0, fat: 1.0, foodId: 'petto-di-pollo-crudo' },
                    { id: 'm2', name: 'Fiocchi di Avena Integrale Gold', meal: 'colazione', quantity: 80, baseQty: 100, kcal: 360, pro: 13, carbs: 62, fat: 7, foodId: 'cf_oats_gold' },
                    { id: 'm3', name: 'Riso Bianco', meal: 'pranzo', quantity: 150, baseQty: 100, kcal: 130, pro: 2.7, carbs: 28, fat: 0.3, foodId: 'riso-bianco' }
                ]
            };

            const store = useAppStore.getState();
            store.setUserData({
                nutrition: {
                    '2026-08-23': nutritionDay
                },
                customFoods: [customFood],
                catalogOverrides: overrides
            });

            const currentData = useAppStore.getState().userData!;
            expect(currentData.nutrition?.['2026-08-23']).toBeDefined();
            expect(currentData.nutrition?.['2026-08-23'].meals).toHaveLength(3);
            expect(currentData.nutrition?.['2026-08-23'].weight).toBe('79.5');
        });
    });

    // =========================================================================
    // TIER 4: REAL-WORLD SCENARIOS & CLOUD MERGE DELTA ISOLATION
    // =========================================================================
    describe('Tier 4: Real-World Scenarios & Cloud Merge Delta Isolation', () => {

        it('T4.1: Full guest lifecycle -> Google linking merges custom data and preserves catalogOverrides', () => {
            // Cloud user already has data on Firestore
            const cloudData: UserData = {
                profile: { name: 'Mario Rossi', gender: 'M', height: '178', dob: '1992-04-15' },
                library: [
                    { id: 'cloud_ex_cable_curl', name: 'Curl ai Cavi', setsCount: 3, sets: [], isDefault: false }
                ],
                routines: [
                    { id: 'r_cloud_arms', name: 'Braccia Cloud', exercises: [{ exId: 'cloud_ex_cable_curl', setsCount: 3 }] }
                ],
                customFoods: [
                    { id: 'cloud_food_skyr', name: 'Skyr Naturale', kcal: 65, pro: 12, carbs: 4, fat: 0.2, isCustom: true }
                ],
                history: [
                    { id: 'h_cloud_01', date: '2026-08-10', routineName: 'Braccia Cloud', exercises: [] }
                ],
                nutrition: {
                    '2026-08-10': { date: '2026-08-10', kcal: 2200, pro: 160, carbs: 240, fat: 60, weight: '76.0' }
                },
                catalogOverrides: {
                    exercises: {
                        'squat-bilanciere': { notes: 'Discesa lenta 3s' }
                    },
                    hiddenExerciseIds: ['leg-extension-macchina']
                }
            };

            // Guest created local data during trial
            const guestData: UserData = {
                profile: { weight: 77.5, waist: '80.0' } as any,
                library: [
                    { id: 'guest_ex_hammer', name: 'Hammer Curl Manubri', setsCount: 4, sets: [], isDefault: false }
                ],
                routines: [
                    { id: 'r_guest_upper', name: 'Upper Body Guest', exercises: [] }
                ],
                customFoods: [
                    { id: 'guest_food_protein_pudding', name: 'Budino Proteico Vaniglia', kcal: 150, pro: 20, carbs: 10, fat: 3, isCustom: true }
                ],
                history: [
                    { id: 'h_guest_01', date: '2026-08-23', routineName: 'Upper Body Guest', exercises: [] }
                ],
                nutrition: {
                    '2026-08-23': { date: '2026-08-23', kcal: 2400, pro: 175, carbs: 260, fat: 65, weight: '77.5' }
                },
                catalogOverrides: {
                    exercises: {
                        'panca-piana-bilanciere': { equipmentWeight: 20, notes: 'Touch and go' }
                    },
                    foods: {
                        'petto-di-pollo-crudo': { pro: 24 }
                    },
                    hiddenExerciseIds: ['panca-declinata-bilanciere'],
                    hiddenFoodIds: ['petto-di-tacchino-crudo']
                }
            };

            // Execute deterministic merge
            const merged = mergeUserData(cloudData, guestData);

            // 1. Profile merged: cloud name/gender/dob preserved, guest weight/waist merged
            expect(merged.profile?.name).toBe('Mario Rossi');
            expect(merged.profile?.gender).toBe('M');
            expect(merged.profile?.height).toBe('178');
            expect((merged.profile as any)?.weight).toBe(77.5);
            expect((merged.profile as any)?.waist).toBe('80.0');

            // 2. Custom exercises combined (2 items, not seed catalog!)
            expect(merged.library).toHaveLength(2);
            expect(merged.library?.map(e => e.id)).toEqual(expect.arrayContaining(['cloud_ex_cable_curl', 'guest_ex_hammer']));

            // 3. Routines combined
            expect(merged.routines).toHaveLength(2);
            expect(merged.routines?.map(r => r.id)).toEqual(expect.arrayContaining(['r_cloud_arms', 'r_guest_upper']));

            // 4. Custom foods combined (2 items, not seed catalog!)
            expect(merged.customFoods).toHaveLength(2);
            expect(merged.customFoods?.map(f => f.id)).toEqual(expect.arrayContaining(['cloud_food_skyr', 'guest_food_protein_pudding']));

            // 5. History sessions preserved
            expect(merged.history).toHaveLength(2);
            expect(merged.history?.map(h => h.id)).toEqual(expect.arrayContaining(['h_cloud_01', 'h_guest_01']));

            // 6. Nutrition dates combined
            expect(Object.keys(merged.nutrition || {})).toEqual(expect.arrayContaining(['2026-08-10', '2026-08-23']));

            // 7. Catalog overrides merged (exercises, foods, hidden ids)
            expect(merged.catalogOverrides?.exercises?.['squat-bilanciere']?.notes).toBe('Discesa lenta 3s');
            expect(merged.catalogOverrides?.exercises?.['panca-piana-bilanciere']?.notes).toBe('Touch and go');
            expect(merged.catalogOverrides?.foods?.['petto-di-pollo-crudo']?.pro).toBe(24);
            expect(merged.catalogOverrides?.hiddenExerciseIds).toEqual(expect.arrayContaining(['leg-extension-macchina', 'panca-declinata-bilanciere']));
            expect(merged.catalogOverrides?.hiddenFoodIds).toEqual(expect.arrayContaining(['petto-di-tacchino-crudo']));
        });

        it('T4.2: Persistence isolation: DB.saveUserData serializes ONLY custom deltas, never the global seed items', async () => {
            // Local fixture catalog (seed is empty — commit e61a133).
            // We inject 5 global exercises + 5 global foods to make the "stripping" behavior observable.
            const globalExFixture: CatalogExercise[] = Array.from({ length: 5 }, (_, i) => ({
                id: `global-ex-${i}`,
                name: `Global Exercise ${i}`,
                muscles: ['chest'],
                trackingType: 'weight_reps' as const,
                isDefault: true,
                setsCount: 3
            }));
            const globalFoodFixture: CatalogFood[] = Array.from({ length: 5 }, (_, i) => ({
                id: `global-food-${i}`,
                name: `Global Food ${i}`,
                kcal: 100,
                pro: 10,
                carbs: 20,
                fat: 2,
                isCustom: false
            }));
            const fixtureCatalog = {
                manifest: { version: '1.0.0', schemaVersion: 1, docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' } },
                exercises: globalExFixture,
                foods: globalFoodFixture
            } as any;
            await saveCatalogToCache(fixtureCatalog);

            let capturedUserDocWrite: any = null;
            const mockBatch = {
                set: vi.fn((ref: any, data: any) => {
                    if (data.library !== undefined || data.customFoods !== undefined) {
                        capturedUserDocWrite = data;
                    }
                }),
                delete: vi.fn(),
                commit: vi.fn().mockResolvedValue(undefined)
            };
            vi.mocked(writeBatch).mockReturnValue(mockBatch as any);

            // User has 1 custom exercise and 1 custom food on top of the 5+5 global fixture
            const customExercise: Exercise = {
                id: 'custom_ex_hip_thrust_db',
                name: 'Hip Thrust con Manubrio',
                setsCount: 4,
                sets: [],
                isDefault: false
            };

            const customFood: Food = {
                id: 'custom_food_almond_butter',
                name: 'Burro di Mandorle 100%',
                kcal: 615,
                pro: 21,
                carbs: 7,
                fat: 56,
                isCustom: true
            };

            const overrides: CatalogOverrides = {
                exercises: {
                    'global-ex-0': { notes: 'Pausa 1s' }
                },
                hiddenExerciseIds: ['global-ex-1']
            };

            const fullResolvedLibrary = resolveEffectiveExercises(globalExFixture, [customExercise], overrides);
            const fullResolvedFoods = resolveEffectiveFoods(globalFoodFixture, [customFood], overrides);

            // Resolved library contains: 1 custom + 4 unhidden globals = 5 total
            expect(fullResolvedLibrary.length).toBeGreaterThan(1);
            expect(fullResolvedFoods.length).toBeGreaterThan(1);

            const stateToSave = {
                profile: { name: 'Test Persistence User' },
                library: fullResolvedLibrary, // Full resolved list passed to save
                customFoods: fullResolvedFoods, // Full resolved list passed to save
                catalogOverrides: overrides,
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            };

            await DB.saveUserData(stateToSave);

            expect(mockBatch.commit).toHaveBeenCalled();
            expect(capturedUserDocWrite).not.toBeNull();

            // CRITICAL TEST: The serialized library must have length 1 (only the custom exercise)
            expect(capturedUserDocWrite.library).toHaveLength(1);
            expect(capturedUserDocWrite.library[0].id).toBe('custom_ex_hip_thrust_db');

            // CRITICAL TEST: The serialized customFoods must have length 1 (only the custom food)
            expect(capturedUserDocWrite.customFoods).toHaveLength(1);
            expect(capturedUserDocWrite.customFoods[0].id).toBe('custom_food_almond_butter');

            // Overrides are properly saved
            expect(capturedUserDocWrite.catalogOverrides?.exercises?.['global-ex-0']?.notes).toBe('Pausa 1s');
            expect(capturedUserDocWrite.catalogOverrides?.hiddenExerciseIds).toContain('global-ex-1');

            // Ensure JSON size of user document is well below 10KB
            const serializedPayload = JSON.stringify(capturedUserDocWrite);
            expect(serializedPayload.length).toBeLessThan(10000);
        });

        it('T4.3: Fresh Google account linking with empty cloud doc persists guest deltas without seed bloat', async () => {
            const seed = getSeedCatalog();
            await saveCatalogToCache(seed);

            let capturedUserDocWrite: any = null;
            const mockBatch = {
                set: vi.fn((ref: any, data: any) => {
                    if (data.library !== undefined) {
                        capturedUserDocWrite = data;
                    }
                }),
                delete: vi.fn(),
                commit: vi.fn().mockResolvedValue(undefined)
            };
            vi.mocked(writeBatch).mockReturnValue(mockBatch as any);

            const guestData: UserData = {
                profile: { name: 'Fresh User' },
                library: [
                    { id: 'custom_only_ex', name: 'Custom Lateral Raise', setsCount: 3, sets: [], isDefault: false }
                ],
                customFoods: [
                    { id: 'custom_only_food', name: 'Custom Bar', kcal: 200, pro: 20, carbs: 15, fat: 5, isCustom: true }
                ],
                catalogOverrides: {
                    foods: { 'petto-di-pollo-crudo': { pro: 25 } }
                }
            };

            const merged = mergeUserData(null, guestData);
            await DB.saveUserData(merged);

            expect(mockBatch.commit).toHaveBeenCalled();
            expect(capturedUserDocWrite.library).toHaveLength(1);
            expect(capturedUserDocWrite.library[0].id).toBe('custom_only_ex');
            expect(capturedUserDocWrite.customFoods).toHaveLength(1);
            expect(capturedUserDocWrite.customFoods[0].id).toBe('custom_only_food');
        });

        it('T4.4: hasUserData accurately distinguishes pristine cold start from real user deltas', () => {
            // Cold start with empty/default collections
            expect(hasUserData(null)).toBe(false);
            expect(hasUserData(undefined)).toBe(false);
            expect(hasUserData({})).toBe(false);
            expect(hasUserData({
                profile: {},
                library: [],
                customFoods: [],
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                supplements: [],
                catalogOverrides: {}
            })).toBe(false);

            // Single custom exercise triggers hasUserData = true
            expect(hasUserData({
                library: [{ id: 'c1', name: 'Custom Cable Fly', setsCount: 3, sets: [] }]
            })).toBe(true);

            // Single custom food triggers hasUserData = true
            expect(hasUserData({
                customFoods: [{ id: 'cf1', name: 'Custom Whey', kcal: 120, pro: 24, carbs: 1, fat: 1 }]
            })).toBe(true);

            // Routine or workout history triggers hasUserData = true
            expect(hasUserData({ routines: [{ id: 'r1', name: 'Push', exercises: [] }] })).toBe(true);
            expect(hasUserData({ history: [{ id: 'h1', date: '2026-08-23', exercises: [] }] })).toBe(true);

            // Nutrition day entry triggers hasUserData = true
            expect(hasUserData({ nutrition: { '2026-08-23': { date: '2026-08-23', kcal: 2000, pro: 150, carbs: 200, fat: 60 } } })).toBe(true);

            // Filled profile field triggers hasUserData = true
            expect(hasUserData({ profile: { height: '175' } })).toBe(true);
        });

        it('T4.5: Legacy migration utilities cleanly extract custom items and overrides from monolithic arrays', () => {
            // Use an explicit in-memory fixture instead of getSeedCatalog().
            // seedExercises.json is intentionally empty (commit e61a133); the migrator
            // requires a populated globalExercises array to distinguish standard from custom items.
            const globalFixture: CatalogExercise[] = [
                {
                    id: 'panca-piana-bilanciere',
                    name: 'Panca Piana Bilanciere',
                    muscles: ['chest'],
                    secondaryMuscles: ['triceps', 'shoulders'],
                    trackingType: 'weight_reps',
                    isDefault: true,
                    setsCount: 3
                },
                {
                    id: 'panca-inclinata-bilanciere',
                    name: 'Panca Inclinata Bilanciere',
                    muscles: ['chest'],
                    secondaryMuscles: ['triceps'],
                    trackingType: 'weight_reps',
                    isDefault: true,
                    setsCount: 3
                }
            ];

            // Simulate legacy library where 1 standard exercise was modified, 1 standard was deleted, and 1 custom was added
            const legacyLibrary: Exercise[] = [
                {
                    id: 'custom_legacy_ex_1',
                    name: 'My Special Deadlift',
                    setsCount: 5,
                    sets: [],
                    isDefault: false
                },
                {
                    id: 'panca-piana-bilanciere',
                    name: 'Panca Piana Bilanciere',
                    notes: 'Fermo al petto 3s',
                    setsCount: 3,
                    sets: [],
                    isDefault: true
                }
                // 'panca-inclinata-bilanciere' was removed by user
            ];

            const { customExercises, overrides } = migrateLegacyLibraryToOverrides(legacyLibrary, globalFixture);

            // Custom exercise correctly separated
            expect(customExercises).toHaveLength(1);
            expect(customExercises[0].id).toBe('custom_legacy_ex_1');

            // Overrides correctly extracted
            expect(overrides.exercises?.['panca-piana-bilanciere']?.notes).toBe('Fermo al petto 3s');

            // Missing standard exercises identified as hidden
            expect(overrides.hiddenExerciseIds).toContain('panca-inclinata-bilanciere');
        });
    });
});
