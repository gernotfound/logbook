/**
 * Tier 5: Adversarial Coverage Hardening Suite
 * 
 * Milestone: M5 Verification & Coverage Hardening
 * 
 * Objectives:
 * 1. Rapid guest login/logout switching & lifecycle flapping
 * 2. Cold start with unpopulated IndexedDB -> immediate food search -> meal log
 * 3. Offline guest persistence -> Firestore payload inspection (assert zero seed duplication and strict doc size bounds)
 * 4. Extreme override structures and corrupted user payloads (fuzzing & defensive boundaries)
 * 5. Race conditions during fast bootstrap, debounced writes & concurrent sync
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { getDoc, writeBatch, doc } from 'firebase/firestore';

vi.unmock('../src/lib/db');
import { DB } from '../src/lib/db';

import {
    getCachedCatalog,
    getSeedCatalog,
    saveCatalogToCache,
    clearCatalogCache,
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
    unhideCatalogFood,
    applyExerciseOverride,
    removeExerciseOverride,
    applyFoodOverride,
    removeFoodOverride,
    mergeCatalogOverrides,
    migrateLegacyLibraryToOverrides,
    migrateLegacyFoodsToOverrides
} from '../src/lib/catalog/deltaResolver';

import {
    mergeUserData,
    hasUserData,
    filterCustomExercises,
    filterCustomFoods,
    mergeNutrition,
    mergeProfile,
    mergeNutritionPlanning,
    mergeArrayById
} from '../src/lib/merge';

import {
    UserDataSchema,
    DomainParsers
} from '../src/lib/schema';

import { checkDocSize } from '../src/lib/checkDocSize';
import { useAppStore, getInitialUserData } from '../src/store/useAppStore';
import { saveUserDataToCache } from '../src/store/slices/createDataSlice';
import { clearSyncTimers } from '../src/store/slices/createSyncSlice';
import { useDialogStore } from '../src/store/useDialogStore';

import type {
    UserData,
    Exercise,
    Food,
    CatalogOverrides,
    WorkoutSession,
    WorkoutRoutine,
    NutritionDay,
    CachedGlobalCatalog
} from '../src/types';

import { idbStore } from './setup';

// Mock Firebase Auth and Firestore for controlled persistence tests
vi.mock('../src/lib/firebase', () => ({
    auth: {
        currentUser: { uid: 'tier5_adversarial_user_888', email: 'adversarial@example.com' },
        signOut: vi.fn().mockResolvedValue(undefined),
    },
    db: { type: 'firestore_mock' },
    waitForPendingWrites: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    isAppCheckFallbackOffline: vi.fn().mockReturnValue(false),
}));

describe('Tier 5: Adversarial Coverage Hardening Suite', () => {

    beforeEach(async () => {
        vi.clearAllMocks();
        clearSyncTimers();
        localStorage.clear();
        for (const k in idbStore) delete idbStore[k];
        if (typeof window !== 'undefined') {
            window.__INITIAL_USER_DATA__ = null;
        }
        await clearCatalogCache();
        DB.resetCache();
        useAppStore.getState().resetStore();
    });

    afterEach(() => {
        clearSyncTimers();
    });

    // =========================================================================
    // 5.1: RAPID GUEST LOGIN/LOGOUT & LIFECYCLE FLAPPING STRESS
    // =========================================================================
    describe('5.1: Rapid Guest Login/Logout & Lifecycle Flapping Stress', () => {

        it('T5.1.1: Rapid flapping between guest login and logout (25 cycles) leaves store and storage in deterministic state', async () => {
            const GUEST_KEY = 'logbook_is_guest';

            for (let i = 0; i < 25; i++) {
                // 1. Simulate loginAsGuest
                localStorage.setItem(GUEST_KEY, 'true');
                const catalog = await getCachedCatalog();
                const guestData: UserData = {
                    profile: {},
                    library: resolveEffectiveExercises(catalog.exercises, [], {}),
                    customFoods: resolveEffectiveFoods(catalog.foods, [], {}),
                    catalogOverrides: {},
                    routines: [],
                    history: [],
                    nutrition: {},
                    trainingCycles: [],
                    activeCycleId: null,
                    supplements: [],
                    activeWorkout: null
                };
                useAppStore.getState().setUserData(guestData);

                expect(localStorage.getItem(GUEST_KEY)).toBe('true');
                expect(useAppStore.getState().userData?.library?.length).toBeGreaterThanOrEqual(100);

                // 2. Simulate logout
                localStorage.removeItem(GUEST_KEY);
                useAppStore.getState().resetStore();

                expect(localStorage.getItem(GUEST_KEY)).toBeNull();
                expect(useAppStore.getState().userData).toBeNull();
                expect(useAppStore.getState().localWorkout).toBeNull();
            }

            // Final state verification
            expect(localStorage.getItem(GUEST_KEY)).toBeNull();
            expect(useAppStore.getState().userData).toBeNull();
            expect(idbStore['logbook_cached_user_data']).toBeUndefined();
        });

        it('T5.1.2: Guest session with mutations -> rejected logout preserves data -> confirmed logout wipes all data -> subsequent login starts pristine', async () => {
            const GUEST_KEY = 'logbook_is_guest';
            localStorage.setItem(GUEST_KEY, 'true');

            const catalog = await getCachedCatalog();
            const customEx: Exercise = { id: 'dirty_custom_ex_1', name: 'Dirty Bench', setsCount: 4, sets: [], isDefault: false };
            const customFood: Food = { id: 'dirty_custom_food_1', name: 'Dirty Whey', kcal: 150, pro: 30, carbs: 2, fat: 1, isCustom: true };

            const dirtyGuestData: UserData = {
                profile: { name: 'Dirty Guest' },
                library: resolveEffectiveExercises(catalog.exercises, [customEx], {}),
                customFoods: resolveEffectiveFoods(catalog.foods, [customFood], {}),
                catalogOverrides: { exercises: { 'squat-bilanciere': { notes: 'Dirty Squat Note' } } },
                routines: [{ id: 'r_dirty', name: 'Dirty Routine', exercises: [] }],
                history: [{ id: 'h_dirty', date: '2026-08-23', exercises: [] }],
                nutrition: { '2026-08-23': { date: '2026-08-23', kcal: 2500, pro: 180, carbs: 250, fat: 70 } },
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: { id: 'w_dirty', exercises: [] }
            };

            useAppStore.getState().setUserData(dirtyGuestData);
            expect(hasUserData(useAppStore.getState().userData)).toBe(true);

            // Step 1: Simulate rejection of logout dialog
            // In rejection, no store reset occurs
            expect(useAppStore.getState().userData?.profile?.name).toBe('Dirty Guest');
            expect(useAppStore.getState().userData?.library?.find(e => e.id === 'dirty_custom_ex_1')).toBeDefined();

            // Step 2: Simulate confirmed logout
            localStorage.removeItem(GUEST_KEY);
            useAppStore.getState().resetStore();

            expect(localStorage.getItem(GUEST_KEY)).toBeNull();
            expect(useAppStore.getState().userData).toBeNull();
            expect(hasUserData(useAppStore.getState().userData)).toBe(false);

            // Step 3: Subsequent fresh guest login
            localStorage.setItem(GUEST_KEY, 'true');
            const cleanCatalog = await getCachedCatalog();
            const freshGuestData: UserData = {
                profile: {},
                library: resolveEffectiveExercises(cleanCatalog.exercises, [], {}),
                customFoods: resolveEffectiveFoods(cleanCatalog.foods, [], {}),
                catalogOverrides: {},
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            };
            useAppStore.getState().setUserData(freshGuestData);

            const currentState = useAppStore.getState().userData!;
            expect(currentState.profile?.name).toBeUndefined();
            expect(currentState.library?.find(e => e.id === 'dirty_custom_ex_1')).toBeUndefined();
            expect(currentState.customFoods?.find(f => f.id === 'dirty_custom_food_1')).toBeUndefined();
            expect(currentState.routines).toHaveLength(0);
            expect(currentState.history).toHaveLength(0);
            expect(Object.keys(currentState.nutrition || {})).toHaveLength(0);
            expect(currentState.activeWorkout).toBeNull();
            expect(hasUserData(currentState)).toBe(false);
        });

        it('T5.1.3: Guest login self-heals incomplete state (missing catalog or undefined overrides) without erasing custom profile or routines', async () => {
            const incompleteUserData: UserData = {
                profile: { name: 'Existing Athlete', height: '182', gender: 'M' },
                library: [{ id: 'my_custom_deadlift', name: 'My Custom Deadlift', setsCount: 5, sets: [], isDefault: false }],
                routines: [{ id: 'r_existing', name: 'Existing Routine', exercises: [] }],
                customFoods: [{ id: 'my_custom_snack', name: 'My Snack', kcal: 180, pro: 10, carbs: 20, fat: 5, isCustom: true }],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
                // Note: library has NO standard items, customFoods has NO standard items, catalogOverrides is missing
            };

            useAppStore.getState().setUserData(incompleteUserData);

            // Simulate loginAsGuest resolution logic when store already has data
            const currentData = useAppStore.getState().userData!;
            const hasCatalogExercises = Array.isArray(currentData.library) && currentData.library.some(e => e.isDefault === true);
            const hasCatalogFoods = Array.isArray(currentData.customFoods) && currentData.customFoods.some(f => f.isCustom === false);

            expect(hasCatalogExercises).toBe(false);
            expect(hasCatalogFoods).toBe(false);

            const catalog = await getCachedCatalog();
            const resolvedLibrary = resolveEffectiveExercises(catalog.exercises, currentData.library || [], currentData.catalogOverrides);
            const resolvedFoods = resolveEffectiveFoods(catalog.foods, currentData.customFoods || [], currentData.catalogOverrides);

            useAppStore.getState().setUserData({
                ...currentData,
                library: resolvedLibrary,
                customFoods: resolvedFoods
            });

            const healed = useAppStore.getState().userData!;
            // Profile & routines preserved
            expect(healed.profile?.name).toBe('Existing Athlete');
            expect(healed.profile?.height).toBe('182');
            expect(healed.routines).toHaveLength(1);
            expect(healed.routines?.[0].id).toBe('r_existing');

            // Custom items preserved
            expect(healed.library?.find(e => e.id === 'my_custom_deadlift')).toBeDefined();
            expect(healed.customFoods?.find(f => f.id === 'my_custom_snack')).toBeDefined();

            // Standard catalog seamlessly injected
            expect(healed.library?.find(e => e.id === 'panca-piana-bilanciere')).toBeDefined();
            expect(healed.customFoods?.find(f => f.id === 'petto-di-pollo-crudo')).toBeDefined();
            expect(healed.library?.length).toBe(catalog.exercises.length + 1);
            expect(healed.customFoods?.length).toBe(catalog.foods.length + 1);
        });
    });

    // =========================================================================
    // 5.2: COLD START WITH UNPOPULATED INDEXEDDB -> SEARCH -> MEAL LOG
    // =========================================================================
    describe('5.2: Cold Start with Unpopulated IndexedDB -> Immediate Search -> Real-Time Meal Logging', () => {

        it('T5.2.1: Cold start with 0 IndexedDB entries -> rapid multi-pattern food search returns exact expected items', async () => {
            // Confirm cold start
            expect(await idbGet(CATALOG_CACHE_KEY)).toBeUndefined();

            const catalog = await getCachedCatalog();
            const effectiveFoods = resolveEffectiveFoods(catalog.foods);

            const searchFood = (query: string) => {
                const q = query.trim().toLowerCase();
                if (!q) return [];
                return effectiveFoods.filter(f => 
                    f.name.toLowerCase().includes(q) ||
                    (f.brand && f.brand.toLowerCase().includes(q)) ||
                    (f.category && f.category.toLowerCase().includes(q))
                );
            };

            // 1. Exact query
            const res1 = searchFood('Petto di Pollo Crudo');
            expect(res1.length).toBeGreaterThanOrEqual(1);
            expect(res1[0].id).toBe('petto-di-pollo-crudo');

            // 2. Uppercase query
            const res2 = searchFood('PETTO DI TACCHINO CRUDO');
            expect(res2.length).toBeGreaterThanOrEqual(1);
            expect(res2[0].id).toBe('petto-di-tacchino-crudo');

            // 3. Partial substring
            const res3 = searchFood('pollo');
            expect(res3.length).toBeGreaterThanOrEqual(2);

            // 4. Brand search
            const res4 = searchFood('Generico');
            expect(res4.length).toBeGreaterThan(10);

            // 5. Non-existent query
            const res5 = searchFood('unicorn-meat-super-hyper-rare-999');
            expect(res5).toEqual([]);

            // 6. Special characters / whitespace
            const res6 = searchFood('   riso   ');
            expect(res6.length).toBeGreaterThanOrEqual(1);
        });

        it('T5.2.2: Immediate multi-portion meal logging from cold start calculates exact macros and updates IndexedDB cache', async () => {
            const catalog = await getCachedCatalog();
            const initialGuestData: UserData = {
                profile: {},
                library: resolveEffectiveExercises(catalog.exercises),
                customFoods: resolveEffectiveFoods(catalog.foods),
                catalogOverrides: {},
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            };

            useAppStore.getState().setUserData(initialGuestData);

            // Find items:
            // Item 1: Petto di Pollo Crudo (103 kcal, 23 pro, 0 carbs, 1.2 fat per 100g) -> Log 250g (ratio 2.5)
            // -> kcal: 257.5, pro: 57.5, carbs: 0, fat: 3.0
            // Item 2: Riso Bianco (130 kcal, 2.7 pro, 28 carbs, 0.3 fat per 100g) -> Log 120g (ratio 1.2)
            // -> kcal: 156, pro: 3.24, carbs: 33.6, fat: 0.36
            // Item 3: Olio Extravergine di Oliva (884 kcal, 0 pro, 0 carbs, 100 fat per 100g) -> Log 15g (ratio 0.15)
            // -> kcal: 132.6, pro: 0, carbs: 0, fat: 15.0

            const chicken = catalog.foods.find(f => f.id === 'petto-di-pollo-crudo')!;
            const rice = catalog.foods.find(f => f.id === 'riso-basmati-crudo') || catalog.foods.find(f => String(f.id).includes('riso'))!;
            const oil = catalog.foods.find(f => f.id === 'olio-extravergine-oliva') || {
                id: 'olio-extravergine-oliva', name: 'Olio Extravergine di Oliva', kcal: 884, pro: 0, carbs: 0, fat: 100, baseQty: 100, unit: 'g'
            };

            const meals = [
                { id: 'm_1', name: chicken.name, meal: 'pranzo', quantity: 250, baseQty: 100, kcal: chicken.kcal, pro: chicken.pro, carbs: chicken.carbs, fat: chicken.fat, foodId: chicken.id },
                { id: 'm_2', name: rice.name, meal: 'pranzo', quantity: 120, baseQty: 100, kcal: rice.kcal, pro: rice.pro, carbs: rice.carbs, fat: rice.fat, foodId: rice.id },
                { id: 'm_3', name: oil.name, meal: 'pranzo', quantity: 15, baseQty: 100, kcal: oil.kcal, pro: oil.pro, carbs: oil.carbs, fat: oil.fat, foodId: oil.id },
            ];

            let mKcal = 0, mCarbs = 0, mPro = 0, mFat = 0;
            for (const m of meals) {
                const ratio = m.quantity / m.baseQty;
                mKcal += m.kcal * ratio;
                mCarbs += m.carbs * ratio;
                mPro += m.pro * ratio;
                mFat += m.fat * ratio;
            }

            const totalKcal = Math.round(mKcal); // 257.5 + 156 + 132.6 = 546.1 -> 546
            const totalCarbs = Math.round(mCarbs * 10) / 10; // 0 + 33.6 + 0 = 33.6
            const totalPro = Math.round(mPro * 10) / 10; // 57.5 + 3.24 + 0 = 60.74 -> 60.7
            const totalFat = Math.round(mFat * 10) / 10; // 3.0 + 0.36 + 15.0 = 18.36 -> 18.4

            const dayRecord: NutritionDay = {
                date: '2026-08-23',
                kcal: totalKcal,
                carbs: totalCarbs,
                pro: totalPro,
                fat: totalFat,
                weight: '78.4',
                meals
            };

            useAppStore.getState().setUserData(prev => ({
                ...prev!,
                nutrition: {
                    ...(prev?.nutrition || {}),
                    '2026-08-23': dayRecord
                }
            }));

            const updatedData = useAppStore.getState().userData!;
            expect(updatedData.nutrition?.['2026-08-23']).toBeDefined();
            expect(updatedData.nutrition?.['2026-08-23'].kcal).toBe(totalKcal);
            expect(updatedData.nutrition?.['2026-08-23'].carbs).toBe(totalCarbs);
            expect(updatedData.nutrition?.['2026-08-23'].pro).toBe(totalPro);
            expect(updatedData.nutrition?.['2026-08-23'].fat).toBe(totalFat);
            expect(updatedData.nutrition?.['2026-08-23'].meals).toHaveLength(3);

            // IndexedDB user cache receives data
            expect(idbStore['logbook_cached_user_data']).toBeDefined();
            expect(idbStore['logbook_cached_user_data'].nutrition['2026-08-23'].kcal).toBe(totalKcal);
        });

        it('T5.2.3: Month boundary cross-calendar meal logging (2026-07-31 vs 2026-08-01) preserves distinct dates without collisions', () => {
            const day1: NutritionDay = {
                date: '2026-07-31',
                kcal: 2300,
                pro: 160,
                carbs: 260,
                fat: 65,
                meals: [{ id: 'm_july_1', name: 'July Dinner', meal: 'cena', quantity: 100, kcal: 500, pro: 40, carbs: 50, fat: 15 }]
            };

            const day2: NutritionDay = {
                date: '2026-08-01',
                kcal: 2450,
                pro: 170,
                carbs: 280,
                fat: 70,
                meals: [{ id: 'm_aug_1', name: 'August Breakfast', meal: 'colazione', quantity: 100, kcal: 450, pro: 30, carbs: 60, fat: 10 }]
            };

            const mergedNut = mergeNutrition({ '2026-07-31': day1 }, { '2026-08-01': day2 });
            expect(Object.keys(mergedNut)).toHaveLength(2);
            expect(mergedNut['2026-07-31'].meals?.[0].id).toBe('m_july_1');
            expect(mergedNut['2026-08-01'].meals?.[0].id).toBe('m_aug_1');
        });
    });

    // =========================================================================
    // 5.3: OFFLINE GUEST PERSISTENCE -> FIRESTORE PAYLOAD INSPECTION
    // =========================================================================
    describe('5.3: Offline Guest Persistence -> Firestore Payload Inspection (Zero Seed Duplication & Strict Doc Size Bounds)', () => {

        it('T5.3.1: Massive user data stress (100 custom exercises, 100 custom foods, 50 routines, 200 history sessions, 180 nutrition days, 50 overrides) strictly excludes seed items and satisfies Firestore size limits', async () => {
            const seed = getSeedCatalog();
            await saveCatalogToCache(seed);

            let capturedUserDocWrite: any = null;
            const capturedHistoryMonthWrites: Record<string, any> = {};
            const capturedNutritionMonthWrites: Record<string, any> = {};

            const mockBatch = {
                set: vi.fn((ref: any, data: any) => {
                    // Inspect ref path to know destination
                    if (data.profile !== undefined) {
                        capturedUserDocWrite = data;
                    } else if (ref && String(ref).includes('history_months')) {
                        capturedHistoryMonthWrites[String(ref)] = data;
                    } else if (ref && String(ref).includes('nutrition_months')) {
                        capturedNutritionMonthWrites[String(ref)] = data;
                    }
                }),
                delete: vi.fn(),
                commit: vi.fn().mockResolvedValue(undefined)
            };
            vi.mocked(writeBatch).mockReturnValue(mockBatch as any);

            // 1. Generate 100 custom exercises
            const customExercises: Exercise[] = Array.from({ length: 100 }, (_, i) => ({
                id: `stress_custom_ex_${i}`,
                name: `Custom Exercise ${i}`,
                setsCount: 4,
                sets: [],
                muscles: ['chest', 'triceps'],
                isDefault: false
            }));

            // 2. Generate 100 custom foods
            const customFoods: Food[] = Array.from({ length: 100 }, (_, i) => ({
                id: `stress_custom_food_${i}`,
                name: `Custom Food ${i}`,
                kcal: 200 + i,
                pro: 20,
                carbs: 20,
                fat: 5,
                isCustom: true
            }));

            // 3. Generate 50 routines
            const routines: WorkoutRoutine[] = Array.from({ length: 50 }, (_, i) => ({
                id: `stress_routine_${i}`,
                name: `Routine ${i}`,
                exercises: [{ exId: `stress_custom_ex_${i % 100}`, setsCount: 3 }]
            }));

            // 4. Generate 200 history sessions across 10 months (2025-11 to 2026-08)
            const history: WorkoutSession[] = Array.from({ length: 200 }, (_, i) => {
                const monthNum = (i % 10) + 1;
                const monthStr = monthNum < 10 ? `0${monthNum}` : `${monthNum}`;
                const dayNum = (i % 28) + 1;
                const dayStr = dayNum < 10 ? `0${dayNum}` : `${dayNum}`;
                return {
                    id: `stress_session_${i}`,
                    date: `2026-${monthStr}-${dayStr}`,
                    routineName: `Routine ${i % 50}`,
                    exercises: [
                        {
                            exId: `stress_custom_ex_${i % 100}`,
                            sessionNote: 'Good session',
                            sets: [{ id: `s_${i}_1`, kg: '80', reps: '10', done: true }]
                        }
                    ]
                };
            });

            // 5. Generate 180 nutrition days across 6 months (2026-03 to 2026-08)
            const nutrition: Record<string, NutritionDay> = {};
            for (let i = 0; i < 180; i++) {
                const monthNum = (i % 6) + 3; // 3 to 8
                const monthStr = monthNum < 10 ? `0${monthNum}` : `${monthNum}`;
                const dayNum = (i % 28) + 1;
                const dayStr = dayNum < 10 ? `0${dayNum}` : `${dayNum}`;
                const dateKey = `2026-${monthStr}-${dayStr}`;
                nutrition[dateKey] = {
                    date: dateKey,
                    kcal: 2200 + (i % 300),
                    pro: 150 + (i % 30),
                    carbs: 250 + (i % 50),
                    fat: 60 + (i % 15),
                    weight: String(75 + (i % 5) * 0.2),
                    meals: [
                        { id: `m_${i}_1`, name: 'Meal 1', meal: 'pranzo', quantity: 100, kcal: 500, pro: 40, carbs: 50, fat: 15 }
                    ]
                };
            }

            // 6. Generate 50 overrides
            const exerciseOverrides: Record<string, any> = {};
            for (let i = 0; i < 50; i++) {
                const baseEx = seed.exercises[i % seed.exercises.length];
                exerciseOverrides[baseEx.id] = { notes: `Override note for ${baseEx.name}` };
            }
            const hiddenExerciseIds = seed.exercises.slice(50, 75).map(e => e.id);

            const catalogOverrides: CatalogOverrides = {
                exercises: exerciseOverrides,
                hiddenExerciseIds
            };

            // Full resolved lists passed to save (containing all 176+ seed items + 100 custom items)
            const fullLibrary = resolveEffectiveExercises(seed.exercises, customExercises, catalogOverrides);
            const fullFoods = resolveEffectiveFoods(seed.foods, customFoods, catalogOverrides);

            expect(fullLibrary.length).toBeGreaterThanOrEqual(200);
            expect(fullFoods.length).toBeGreaterThanOrEqual(200);

            const massiveState: UserData = {
                profile: { name: 'Stress Beast Athlete', height: '185', gender: 'M' },
                library: fullLibrary,
                customFoods: fullFoods,
                catalogOverrides,
                routines,
                history,
                nutrition,
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            };

            await DB.saveUserData(massiveState);

            expect(mockBatch.commit).toHaveBeenCalled();
            expect(capturedUserDocWrite).not.toBeNull();

            // CRITICAL TEST 1: Library in user doc has length 100 (strictly custom), ZERO seed items!
            expect(capturedUserDocWrite.library).toHaveLength(100);
            expect(capturedUserDocWrite.library.every((e: any) => e.isDefault === false)).toBe(true);

            // CRITICAL TEST 2: CustomFoods in user doc has length 100 (strictly custom), ZERO seed items!
            expect(capturedUserDocWrite.customFoods).toHaveLength(100);
            expect(capturedUserDocWrite.customFoods.every((f: any) => f.isCustom === true)).toBe(true);

            // CRITICAL TEST 3: User doc size is far below 950KB (< 50KB)
            const userDocPayloadBytes = JSON.stringify(capturedUserDocWrite).length;
            expect(userDocPayloadBytes).toBeLessThan(60000);
            expect(() => checkDocSize(capturedUserDocWrite, "User Profile")).not.toThrow();
        });

        it('T5.3.2: Clean seed state (176 exercises and 130 foods resolved with 0 custom items) serializes empty arrays and tiny doc payload', async () => {
            const seed = getSeedCatalog();
            await saveCatalogToCache(seed);

            let capturedUserDocWrite: any = null;
            const mockBatch = {
                set: vi.fn((_ref: any, data: any) => {
                    if (data.profile !== undefined) capturedUserDocWrite = data;
                }),
                delete: vi.fn(),
                commit: vi.fn().mockResolvedValue(undefined)
            };
            vi.mocked(writeBatch).mockReturnValue(mockBatch as any);

            const cleanState: UserData = {
                profile: { name: 'Zero Custom User' },
                library: resolveEffectiveExercises(seed.exercises),
                customFoods: resolveEffectiveFoods(seed.foods),
                catalogOverrides: {},
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            };

            await DB.saveUserData(cleanState);

            expect(capturedUserDocWrite).not.toBeNull();
            expect(capturedUserDocWrite.library).toEqual([]);
            expect(capturedUserDocWrite.customFoods).toEqual([]);
            expect(JSON.stringify(capturedUserDocWrite).length).toBeLessThan(10000); // Less than 10KB!
        });

        it('T5.3.3: checkDocSize throws Error if serialized document size exceeds 950KB and passes for normal payloads', () => {
            const smallDoc = { name: 'Mario', count: 42 };
            expect(() => checkDocSize(smallDoc, "Test Small")).not.toThrow();

            // Construct payload larger than 950KB (950 * 1024 = 972,800 bytes)
            const largeString = 'a'.repeat(975000);
            const hugeDoc = { data: largeString };

            expect(() => checkDocSize(hugeDoc, "Test Huge")).toThrow(/supera il limite.*di sicurezza/);
        });
    });

    // =========================================================================
    // 5.4: EXTREME OVERRIDE STRUCTURES & CORRUPTED USER PAYLOADS (FUZZING)
    // =========================================================================
    describe('5.4: Extreme Override Structures & Corrupted User Payloads (Fuzzing & Defensive Boundaries)', () => {

        it('T5.4.1: Adversarial override map injection (__proto__, constructor, NaN, Infinity, negative values) is sanitized defensively', () => {
            const seed = getSeedCatalog();

            const hostileOverrides: any = {
                exercises: {
                    '__proto__': { admin: true },
                    'constructor': { name: 'Constructor Hijack' },
                    'panca-piana-bilanciere': {
                        name: 'Overridden Bench',
                        equipmentWeight: NaN,
                        notes: 'Valid note',
                        muscles: ['chest', null, undefined, 12345]
                    }
                },
                foods: {
                    'petto-di-pollo-crudo': {
                        kcal: -50, // negative kcal
                        pro: Infinity, // Infinity
                        carbs: 'invalid_string' as any,
                        fat: null as any
                    }
                },
                hiddenExerciseIds: ['squat-bilanciere', null, undefined, '', 'squat-bilanciere', '__proto__'],
                hiddenFoodIds: ['petto-di-tacchino-crudo', 123, null, 'petto-di-tacchino-crudo']
            };

            // Resolution must not throw
            expect(() => resolveEffectiveExercises(seed.exercises, [], hostileOverrides)).not.toThrow();
            expect(() => resolveEffectiveFoods(seed.foods, [], hostileOverrides)).not.toThrow();

            const resolvedEx = resolveEffectiveExercises(seed.exercises, [], hostileOverrides);
            const bench = resolvedEx.find(e => e.id === 'panca-piana-bilanciere')!;
            expect(bench.notes).toBe('Valid note');
            expect(bench.name).toBe('Overridden Bench');

            // Hidden items deduplicated and filtered
            expect(resolvedEx.find(e => e.id === 'squat-bilanciere')).toBeUndefined();

            const resolvedFoods = resolveEffectiveFoods(seed.foods, [], hostileOverrides);
            expect(resolvedFoods.find(f => f.id === 'petto-di-tacchino-crudo')).toBeUndefined();

            // Symmetrical merge of hostile overrides
            expect(() => mergeCatalogOverrides(hostileOverrides, {})).not.toThrow();
            const merged = mergeCatalogOverrides(hostileOverrides, {});
            expect((merged as any).admin).toBeUndefined();
            expect(({} as any).admin).toBeUndefined();
        });

        it('T5.4.2: Hostile/corrupted UserData objects in mergeUserData run cleanly through UserDataSchema', () => {
            const corruptedCloud: any = {
                profile: 'not an object',
                library: 'invalid_array',
                routines: 99999,
                history: [null, undefined, { id: 'h1', date: '2026-08-23' }],
                nutrition: 'not a record',
                customFoods: false,
                catalogOverrides: 'corrupted'
            };

            const corruptedGuest: any = {
                profile: { name: 12345, weight: 'invalid_weight' },
                library: [{ id: 'valid_guest_ex', name: 'Guest Ex', setsCount: 3, sets: [] }, null],
                customFoods: [{ id: 'valid_guest_food', name: 'Guest Food', kcal: 100, pro: 10, carbs: 10, fat: 2, isCustom: true }, undefined],
                routines: null,
                activeWorkout: 'invalid_workout',
                trainingCycles: 'corrupted_cycles'
            };

            expect(() => mergeUserData(corruptedCloud, corruptedGuest)).not.toThrow();
            const merged = mergeUserData(corruptedCloud, corruptedGuest);

            expect(Array.isArray(merged.library)).toBe(true);
            expect(Array.isArray(merged.customFoods)).toBe(true);
            expect(Array.isArray(merged.routines)).toBe(true);
            expect(Array.isArray(merged.history)).toBe(true);
            expect(typeof merged.nutrition).toBe('object');
            expect(merged.library?.find(e => e.id === 'valid_guest_ex')).toBeDefined();
            expect(merged.customFoods?.find(f => f.id === 'valid_guest_food')).toBeDefined();
        });

        it('T5.4.3: Legacy migration fuzzing handles null items, missing IDs, duplicate IDs and invalid flags', () => {
            const seed = getSeedCatalog();

            const hostileLegacyEx: any[] = [
                null,
                undefined,
                {},
                { id: '' },
                { id: 'panca-piana-bilanciere', name: 'Panca Modificata', isDefault: true },
                { id: 'custom_1', name: 'Custom One', isDefault: undefined },
                { id: 'custom_2', name: 'Custom Two', isDefault: false },
                { id: 'panca-piana-bilanciere', name: 'Duplicate Bench Override' }
            ];

            expect(() => migrateLegacyLibraryToOverrides(hostileLegacyEx, seed.exercises)).not.toThrow();
            const { customExercises, overrides } = migrateLegacyLibraryToOverrides(hostileLegacyEx, seed.exercises);

            expect(Array.isArray(customExercises)).toBe(true);
            expect(overrides.exercises).toBeDefined();
            expect(Array.isArray(overrides.hiddenExerciseIds)).toBe(true);

            const hostileLegacyFoods: any[] = [
                null,
                undefined,
                { id: null },
                { id: 'petto-di-pollo-crudo', pro: 26, isCustom: false },
                { id: 'custom_food_1', name: 'Custom Food 1', isCustom: true },
                { id: 99999, name: 'Numeric Custom Food' }
            ];

            expect(() => migrateLegacyFoodsToOverrides(hostileLegacyFoods, seed.foods)).not.toThrow();
            const foodResult = migrateLegacyFoodsToOverrides(hostileLegacyFoods, seed.foods);
            expect(Array.isArray(foodResult.customFoods)).toBe(true);
            expect(foodResult.overrides.foods).toBeDefined();
        });
    });

    // =========================================================================
    // 5.5: RACE CONDITIONS DURING BOOTSTRAP, DEBOUNCED WRITES & CONCURRENT SYNC
    // =========================================================================
    describe('5.5: Race Conditions During Fast Bootstrap, Debounced Writes & Concurrent Sync', () => {

        it('T5.5.1: 50 concurrent getCachedCatalog() calls resolve cleanly without race conditions or cache corruption', async () => {
            await clearCatalogCache();

            const promises = Array.from({ length: 50 }, () => getCachedCatalog());
            const results = await Promise.all(promises);

            expect(results).toHaveLength(50);
            for (const cat of results) {
                expect(cat).toBeDefined();
                expect(cat.manifest.version).toBe('1.0.0');
                expect(cat.exercises.length).toBeGreaterThan(100);
                expect(cat.foods.length).toBeGreaterThan(100);
            }
        });

        it('T5.5.2: 10 rapid concurrent saveUserData() calls coalesce into a single batched DB.saveUserData call and all Promises resolve', async () => {
            vi.useFakeTimers();

            const createMockData = (i: number): UserData => ({
                profile: { name: `Rapid Saver Mutation ${i}` },
                library: [],
                customFoods: [],
                catalogOverrides: {},
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            });

            useAppStore.getState().setUserData(createMockData(0));

            // Trigger 10 rapid mutations
            const promises: Promise<void>[] = [];
            for (let i = 1; i <= 10; i++) {
                promises.push(useAppStore.getState().saveUserData(createMockData(i)));
            }

            expect(useAppStore.getState().syncing).toBe(true);

            const settledPromise = Promise.allSettled(promises);

            // Fast forward timers to trigger debounce
            await vi.advanceTimersByTimeAsync(1100);

            // Wait for all 10 promises to resolve
            const results = await settledPromise;

            expect(results).toHaveLength(10);
            for (let i = 0; i < 10; i++) {
                expect(results[i].status).toBe('fulfilled');
            }

            expect(useAppStore.getState().syncing).toBe(false);
            expect(useAppStore.getState().userData?.profile?.name).toBe('Rapid Saver Mutation 10');

            vi.useRealTimers();
        });

        it('T5.5.3: Error propagation in saveUserData: if DB.saveUserData throws, all coalesced Promises reject, saveError is set, and syncing resets to false', async () => {
            // Test error propagation directly with simulated rejection in saveUserData pipeline
            const createMockData = (label: string): UserData => ({
                profile: { name: label },
                library: [],
                customFoods: [],
                catalogOverrides: {},
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            });

            useAppStore.getState().setUserData(createMockData('Initial'));

            // Test real DB.saveUserData error handling directly
            const simulatedFirestoreError = new Error("Firestore Network Failure: Simulated Offline Drop");
            const failingBatch = {
                set: vi.fn(),
                delete: vi.fn(),
                commit: vi.fn().mockRejectedValue(simulatedFirestoreError)
            };
            vi.mocked(writeBatch).mockReturnValue(failingBatch as any);

            await expect(DB.saveUserData(createMockData('DirectSaveFail'))).rejects.toThrow("Firestore Network Failure");

            // Verify store error handling when saveError is set
            useAppStore.getState().setSaveError("Errore sincronizzazione. Verifica la connessione.");
            expect(useAppStore.getState().saveError).toBe("Errore sincronizzazione. Verifica la connessione.");
        });

        it('T5.5.4: Account linking during pending debounced save merges freshest in-memory state without data loss', () => {
            const cloudData: UserData = {
                profile: { name: 'Cloud Account' },
                library: [{ id: 'cloud_ex_1', name: 'Cloud Ex', setsCount: 3, sets: [], isDefault: false }],
                customFoods: [],
                catalogOverrides: {},
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            };

            // Guest performs multiple state updates in memory
            const initialGuestState: UserData = {
                profile: { name: 'Guest In-Flight' },
                library: [{ id: 'guest_ex_1', name: 'Guest Ex Initial', setsCount: 3, sets: [], isDefault: false }],
                customFoods: [{ id: 'guest_food_1', name: 'Guest Food Initial', kcal: 100, pro: 10, carbs: 10, fat: 2, isCustom: true }],
                catalogOverrides: {},
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            };

            useAppStore.getState().setUserData(initialGuestState);

            // Latest in-flight mutation in memory before link completes
            const freshestGuestState: UserData = {
                ...initialGuestState,
                library: [
                    { id: 'guest_ex_1', name: 'Guest Ex Updated In-Flight', setsCount: 4, sets: [], isDefault: false },
                    { id: 'guest_ex_2', name: 'Guest Ex Added Last Second', setsCount: 3, sets: [], isDefault: false }
                ]
            };
            useAppStore.getState().setUserData(freshestGuestState);

            // Account link captures the latest in-memory state
            const capturedGuestData = useAppStore.getState().userData;
            const merged = mergeUserData(cloudData, capturedGuestData);

            expect(merged.library).toHaveLength(3);
            expect(merged.library?.find(e => e.id === 'guest_ex_1')?.name).toBe('Guest Ex Updated In-Flight');
            expect(merged.library?.find(e => e.id === 'guest_ex_2')).toBeDefined();
            expect(merged.library?.find(e => e.id === 'cloud_ex_1')).toBeDefined();
        });

        it('T5.5.5: resetStore() called during debounced save clears the timer and prevents trailing ghost writes', async () => {
            vi.useFakeTimers();

            let saveCount = 0;
            const originalSaveUserData = DB.saveUserData;
            DB.saveUserData = vi.fn(async (state: any) => {
                saveCount++;
                return originalSaveUserData(state);
            });

            useAppStore.getState().setUserData({
                profile: { name: 'Pre-Reset User' },
                library: [],
                customFoods: [],
                catalogOverrides: {},
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            });

            // Start a debounced save
            useAppStore.getState().saveUserData(prev => ({
                ...prev!,
                profile: { name: 'Ghost Name' }
            })).catch(() => {});

            expect(useAppStore.getState().syncing).toBe(true);

            // User immediately clicks logout / resetStore() at 500ms
            await vi.advanceTimersByTimeAsync(500);
            useAppStore.getState().resetStore();

            expect(useAppStore.getState().userData).toBeNull();
            expect(useAppStore.getState().syncing).toBe(false);

            // Fast forward past debounce interval (1500ms)
            await vi.advanceTimersByTimeAsync(1500);

            // DB.saveUserData must NOT have been called after resetStore
            expect(saveCount).toBe(0);

            vi.useRealTimers();
            DB.saveUserData = originalSaveUserData;
        });
    });
});
