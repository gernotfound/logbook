import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get as idbGet } from 'idb-keyval';
import { getDoc } from 'firebase/firestore';

vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
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
    resolveEffectiveFoods
} from '../src/lib/catalog/deltaResolver';
import { useAppStore } from '../src/store/useAppStore';
import { idbStore } from './setup';

describe('Integration Suite: Guest Mode & Global Catalog Resolution', () => {
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

            // Assertions: Catalog is valid, non-null, and comes from standard seed catalog
            expect(catalog).toBeDefined();
            expect(catalog.manifest.version).toBe('1.0.0');
            expect(Array.isArray(catalog.exercises)).toBe(true);
            expect(Array.isArray(catalog.foods)).toBe(true);
            expect(catalog.exercises.length).toBe(0);
            expect(catalog.foods.length).toBe(0);
            expect(catalog.manifest.itemCounts.exercises).toBe(0);
            expect(catalog.manifest.itemCounts.foods).toBe(0);

            // In-memory catalog is now warm
            expect(getInMemoryCatalog()).not.toBeNull();
        });

        it('T1.2: Resolves real catalog exercise fields to a usable workout library without mutating the source', () => {
            const globalExercises: import('../src/types').CatalogExercise[] = [
                {
                    id: 'bench', name: 'Panca Piana Bilanciere', muscles: ['chest'],
                    secondaryMuscles: ['triceps'], trackingType: 'weight_reps',
                    setsCount: 4, isDefault: true,
                },
            ];
            const resolved = resolveEffectiveExercises(globalExercises);

            expect(resolved).toEqual([{
                id: 'bench', name: 'Panca Piana Bilanciere', notes: undefined,
                muscles: ['chest'], secondaryMuscles: ['triceps'],
                trackingType: 'weight_reps', setsCount: 4,
                isDefault: true, isBodyweight: false, equipmentWeight: undefined, sets: [],
            }]);
            expect(globalExercises[0]).not.toHaveProperty('sets');
        });

        it('T1.3: Resolves foods with custom-ID precedence while preserving standard macros', () => {
            const globalFoods: import('../src/types').CatalogFood[] = [
                { id: 'chicken', name: 'Petto di pollo', kcal: 103, pro: 23, carbs: 0, fat: 1.2 },
                { id: 'rice', name: 'Riso', kcal: 130, pro: 2.7, carbs: 28, fat: 0.3 },
            ];
            const customFoods: import('../src/types').Food[] = [
                { id: 'chicken', name: 'Ricetta personale', kcal: 220, pro: 17, carbs: 12, fat: 9, isCustom: true },
            ];

            const resolved = resolveEffectiveFoods(globalFoods, customFoods);

            expect(resolved.map(food => food.id)).toEqual(['chicken', 'rice']);
            expect(resolved[0]).toMatchObject({
                name: 'Ricetta personale', kcal: 220, pro: 17, isCustom: true,
            });
            expect(resolved[1]).toMatchObject({
                name: 'Riso', kcal: 130, pro: 2.7, carbs: 28, fat: 0.3, isCustom: false,
            });
            expect(globalFoods[0].name).toBe('Petto di pollo');
        });

        it('T1.4: Flat store contract: resolveEffectiveExercises and resolveEffectiveFoods produce ready-to-consume lists', () => {
            const catalog = getSeedCatalog();

            expect(catalog.exercises).toHaveLength(0);
            expect(catalog.foods).toHaveLength(0);
            const populatedExercises = [{ id: 'std-ex', name: 'Panca', trackingType: 'weight_reps' as const }];
            const populatedFoods = [{ id: 'std-food', name: 'Riso', kcal: 100, pro: 2, carbs: 20, fat: 1 }];
            const effectiveExercises = resolveEffectiveExercises(populatedExercises);
            const effectiveFoods = resolveEffectiveFoods(populatedFoods);

            expect(effectiveExercises.map(e => e.id)).toEqual(['std-ex']);
            expect(effectiveFoods.map(f => f.id)).toEqual(['std-food']);

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
            expect(currentData?.library?.map(e => e.id)).toEqual(['std-ex']);
            expect(currentData?.customFoods?.map(f => f.id)).toEqual(['std-food']);
        });

        it('T1.5: Catalog snapshots stay available across local cache and remote manifest no-op', async () => {
            // Step 1: Initial Cold State (using a populated fixture since seed is empty)
            const stage1Catalog = {
                manifest: { version: '1.0.0', schemaVersion: 1, docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' }, itemCounts: { exercises: 5, foods: 5 } },
                exercises: Array.from({ length: 5 }, (_, i) => ({ id: `ex-${i}`, name: `Ex ${i}`, isDefault: true, setsCount: 3 } as any)),
                foods: Array.from({ length: 5 }, (_, i) => ({ id: `food-${i}`, name: `Food ${i}`, isCustom: false } as any))
            } as any;

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
            // Verify that the previously visible items didn't disappear during the sync check
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
});
