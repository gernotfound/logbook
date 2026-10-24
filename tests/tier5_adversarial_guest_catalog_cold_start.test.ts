import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get as idbGet } from 'idb-keyval';
import { doc } from 'firebase/firestore';

vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import {
    getCachedCatalog,
    saveCatalogToCache,
    clearCatalogCache,
    CATALOG_CACHE_KEY
} from '../src/lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../src/lib/catalog/deltaResolver';
import { mergeNutrition } from '../src/lib/merge';
import { applyDomainOperations } from '../src/lib/sync/domainOperations';
import { searchFoods } from '../src/lib/calc/nutrition';
import { useAppStore } from '../src/store/useAppStore';
import { clearSyncTimers } from '../src/store/slices/createSyncSlice';
import type { UserData, NutritionDay } from '../src/types';
import { idbStore } from './setup';

vi.mock('../src/lib/firebase', () => ({
    auth: {
        currentUser: { uid: 'test-user-id', email: 'test@example.com' },
        signOut: vi.fn().mockResolvedValue(undefined),
    },
    db: { type: 'firestore_mock' },
    getDb: vi.fn().mockReturnValue({}),
    ensureAppCheck: vi.fn().mockResolvedValue(undefined),
    waitForPendingWrites: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    isAppCheckFallbackOffline: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/lib/sync/session', async () => {
    const actual = await vi.importActual<typeof import('../src/lib/sync/session')>('../src/lib/sync/session');
    return {
        ...actual,
        storageOwner: () => {
            let guest = false;
            try { guest = localStorage.getItem('logbook_is_guest') === 'true'; } catch {}
            return !guest ? 'user:test-user-id' : 'guest';
        }
    };
});

describe('Tier 5: Adversarial Coverage Hardening Suite', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        clearSyncTimers();
        localStorage.clear();
        for (const k in idbStore) delete idbStore[k];
        if (typeof window !== 'undefined') {
            window.__INITIAL_USER_DATA__ = null;
        }
        vi.mocked(doc).mockImplementation((_db: any, ...parts: string[]) => ({
            path: parts.join('/'),
            toString: () => parts.join('/')
        } as any));
        await clearCatalogCache();
        DB.resetCache();
        useAppStore.getState().resetStore();
    });

    afterEach(() => {
        clearSyncTimers();
    });

    // =========================================================================
    // 5.2: COLD START WITH UNPOPULATED INDEXEDDB -> SEARCH -> MEAL LOG
    // =========================================================================
    describe('5.2: Cold Start with Unpopulated IndexedDB -> Immediate Search -> Real-Time Meal Logging', () => {

        it('T5.2.1: Cold start with 0 IndexedDB entries -> bootstrap catalog -> rapid multi-pattern food search returns exact expected items', async () => {
            // Confirm cold start before deterministic bootstrap data is installed.
            expect(await idbGet(CATALOG_CACHE_KEY)).toBeUndefined();

            const fixtureCatalog = {
                manifest: { version: '1.0.0', schemaVersion: 1, docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' } },
                exercises: [],
                foods: [
                    { id: 'petto-di-pollo-crudo', name: 'Petto di Pollo Crudo', brand: 'Generico', category: 'carne', kcal: 106, pro: 22.5, carbs: 0, fat: 1.9, isCustom: false },
                    { id: 'petto-di-tacchino-crudo', name: 'Petto di Tacchino Crudo', brand: 'Generico', category: 'carne', kcal: 104, pro: 22, carbs: 0, fat: 1.5, isCustom: false },
                    { id: 'riso-basmati-crudo', name: 'Riso Basmati Crudo', brand: 'Generico', category: 'cereali', kcal: 350, pro: 8, carbs: 78, fat: 1, isCustom: false }
                ]
            } as any;
            await saveCatalogToCache(fixtureCatalog);

            const catalog = await getCachedCatalog();
            const effectiveFoods = resolveEffectiveFoods(catalog.foods);

            const searchFood = (query: string) => searchFoods(effectiveFoods, query);

            // 1. Exact query
            expect(() => searchFood('Petto di Pollo Crudo')).not.toThrow();
            const res1 = searchFood('Petto di Pollo Crudo');
            expect(res1.map(food => food.id)).toContain('petto-di-pollo-crudo');

            // 2. Uppercase query
            expect(() => searchFood('PETTO DI TACCHINO CRUDO')).not.toThrow();
            const res2 = searchFood('PETTO DI TACCHINO CRUDO');
            expect(res2.map(food => food.id)).toContain('petto-di-tacchino-crudo');

            // 3. Partial substring
            expect(() => searchFood('pollo')).not.toThrow();
            const res3 = searchFood('pollo');
            expect(res3.map(food => food.id)).toContain('petto-di-pollo-crudo');

            // 4. Brand search
            expect(() => searchFood('Generico')).not.toThrow();
            const res4 = searchFood('Generico');
            expect(res4.map(food => food.id)).toEqual(expect.arrayContaining(['petto-di-pollo-crudo', 'petto-di-tacchino-crudo']));

            // 5. Non-existent query
            expect(() => searchFood('unicorn-meat-super-hyper-rare-999')).not.toThrow();
            const res5 = searchFood('unicorn-meat-super-hyper-rare-999');
            expect(res5).toEqual([]);

            // 6. Special characters / whitespace
            expect(() => searchFood('   riso   ')).not.toThrow();
            const res6 = searchFood('   riso   ');
            expect(res6.map(food => food.id)).toContain('riso-basmati-crudo');
        });

        it('T5.2.2: Cold start catalog meals produce exact totals through Production Domain Operations', async () => {
            // Local fixture to populate the cache (seed is empty — commit e61a133)
            const fixtureCatalog = {
                manifest: { version: '1.0.0', schemaVersion: 1, docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' } },
                exercises: [],
                foods: [
                    { id: 'petto-di-pollo-crudo', name: 'Petto di pollo crudo', kcal: 103, pro: 23, carbs: 0, fat: 1.2, isCustom: false, baseQty: 100, unit: 'g' },
                    { id: 'riso-basmati-crudo', name: 'Riso Basmati Crudo', kcal: 130, pro: 2.7, carbs: 28, fat: 0.3, isCustom: false, baseQty: 100, unit: 'g' },
                    { id: 'olio-extravergine-oliva', name: 'Olio Extravergine di Oliva', kcal: 884, pro: 0, carbs: 0, fat: 100, isCustom: false, baseQty: 100, unit: 'g' }
                ]
            } as any;
            await saveCatalogToCache(fixtureCatalog);

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

            // Calculate through the production domain reducer, not a duplicate formula.

            // Find items:
            // Item 1: Petto di Pollo Crudo (103 kcal, 23 pro, 0 carbs, 1.2 fat per 100g) -> Log 250g (ratio 2.5)
            // -> kcal: 257.5, pro: 57.5, carbs: 0, fat: 3.0
            // Item 2: Riso Bianco (130 kcal, 2.7 pro, 28 carbs, 0.3 fat per 100g) -> Log 120g (ratio 1.2)
            // -> kcal: 156, pro: 3.24, carbs: 33.6, fat: 0.36
            // Item 3: Olio Extravergine di Oliva (884 kcal, 0 pro, 0 carbs, 100 fat per 100g) -> Log 15g (ratio 0.15)
            // -> kcal: 132.6, pro: 0, carbs: 0, fat: 15.0

            const chicken = catalog.foods.find((f: any) => f.id === 'petto-di-pollo-crudo')!;
            const rice = catalog.foods.find((f: any) => f.id === 'riso-basmati-crudo')!;
            const oil = catalog.foods.find((f: any) => f.id === 'olio-extravergine-oliva')!;

            const meals = [
                { id: 'm_1', name: chicken.name, meal: 'pranzo', quantity: 250, baseQty: 100, kcal: chicken.kcal, pro: chicken.pro, carbs: chicken.carbs, fat: chicken.fat, foodId: chicken.id },
                { id: 'm_2', name: rice.name, meal: 'pranzo', quantity: 120, baseQty: 100, kcal: rice.kcal, pro: rice.pro, carbs: rice.carbs, fat: rice.fat, foodId: rice.id },
                { id: 'm_3', name: oil.name, meal: 'pranzo', quantity: 15, baseQty: 100, kcal: oil.kcal, pro: oil.pro, carbs: oil.carbs, fat: oil.fat, foodId: oil.id },
            ];

            const logged = applyDomainOperations(initialGuestData, meals.map(meal => ({
                type: 'nutrition-meal.upsert' as const, date: '2026-08-23', meal,
            })));
            const day = logged.nutrition?.['2026-08-23'];
            expect(initialGuestData.nutrition).toEqual({});
            expect(day?.meals?.map(meal => meal.id)).toEqual(['m_1', 'm_2', 'm_3']);
            expect(day).toMatchObject({
                kcal: 546, carbs: 33.6, pro: 60.7, fat: 18.4,
            });
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
});
