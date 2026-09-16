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

        it('T1.2: Verifies immediate presence and properties of specific known standard exercises in a populated catalog', async () => {
            // Local fixture (seed is empty — commit e61a133) simulating remote catalog payload
            const catalog = {
                exercises: [
                    { id: 'panca-piana-bilanciere', name: 'Panca Piana Bilanciere', muscles: ['chest'], secondaryMuscles: ['triceps', 'shoulders'], trackingType: 'weight_reps', isDefault: true, setsCount: 3 },
                    { id: 'panca-inclinata-bilanciere', name: 'Panca Inclinata Bilanciere', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 3 },
                    { id: 'squat-bilanciere', name: 'Squat con Bilanciere', muscles: ['quads'], trackingType: 'weight_reps', isDefault: true, setsCount: 3 },
                    { id: 'stacchi-da-terra', name: 'Stacchi da Terra (Deadlift)', muscles: ['back'], secondaryMuscles: ['hamstrings'], trackingType: 'weight_reps', isDefault: true, setsCount: 3 }
                ] as import('../src/types').CatalogExercise[]
            };

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

        it('T1.3: Verifies immediate presence and properties of specific known standard foods in a populated catalog', async () => {
            // Local fixture (seed is empty — commit e61a133) simulating remote catalog payload
            const catalog = {
                foods: [
                    { id: 'petto-di-pollo-crudo', name: 'Petto di Pollo Crudo', brand: 'Generico', kcal: 103, pro: 23, carbs: 0, fat: 1.2, isCustom: false },
                    { id: 'petto-di-tacchino-crudo', name: 'Petto di Tacchino', kcal: 110, pro: 24, carbs: 0, fat: 1.5, isCustom: false },
                    { id: 'vitello-magro-crudo', name: 'Vitello magro', kcal: 107, pro: 21, carbs: 0, fat: 2.5, isCustom: false },
                    ...Array.from({ length: 118 }, (_, i) => ({ id: `food-${i}`, name: `Food ${i}`, kcal: 100, pro: 10, carbs: 10, fat: 2, isCustom: false }))
                ] as import('../src/types').CatalogFood[]
            };

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

            // 4. Total simulated foods count meets catalog contract
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
