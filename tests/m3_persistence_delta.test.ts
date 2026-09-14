import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDoc, writeBatch } from 'firebase/firestore';

vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import {
    getSeedCatalog,
    clearCatalogCache,
    saveCatalogToCache
} from '../src/lib/catalog/catalogService';
import {
    resolveEffectiveExercises,
    resolveEffectiveFoods,
    createExerciseOverride,
    createFoodOverride,
    hideCatalogExercise,
    hideCatalogFood
} from '../src/lib/catalog/deltaResolver';
import { saveUserDataToCache, getInitialUserData } from '../src/store/slices/createDataSlice';
import { idbStore } from './setup';
import type { UserData, Exercise, Food, CatalogOverrides } from '../src/types';



describe('M3: Storage & Persistence Delta Isolation Suite', () => {
    let mockBatch: any;
    let capturedUserDocData: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        localStorage.clear();
        for (const k in idbStore) delete idbStore[k];
        await clearCatalogCache();
        DB.resetCache();
        capturedUserDocData = null;

        mockBatch = {
            set: vi.fn((_ref: any, data: any) => {
                if (data && (data.library !== undefined || data.customFoods !== undefined || data.catalogOverrides !== undefined)) {
                    capturedUserDocData = data;
                }
            }),
            delete: vi.fn(),
            commit: vi.fn().mockResolvedValue(undefined)
        };
        vi.mocked(writeBatch).mockReturnValue(mockBatch);
    });

    describe('DB.saveUserData Delta Isolation', () => {
        it('persists strictly custom exercises and custom foods, isolating them from 176+ seed items', async () => {
            const seed = getSeedCatalog();
            await saveCatalogToCache(seed);

            const customExercise1: Exercise = {
                id: 'custom_ex_hack_squat',
                name: 'Hack Squat 45° Custom',
                setsCount: 4,
                sets: [],
                muscles: ['quads'],
                isDefault: false
            };
            const customExercise2: Exercise = {
                id: 'custom_ex_reverse_fly',
                name: 'Reverse Fly ai Cavi',
                setsCount: 3,
                sets: [],
                muscles: ['shoulders'],
                isDefault: false
            };

            const customFood1: Food = {
                id: 'custom_food_clear_whey',
                name: 'Clear Whey Isolate Anguria',
                kcal: 85,
                pro: 20,
                carbs: 0.5,
                fat: 0.1,
                isCustom: true
            };
            const customFood2: Food = {
                id: 'custom_food_rice_creme',
                name: 'Crema di Riso Cioccolato',
                kcal: 350,
                pro: 7,
                carbs: 78,
                fat: 1.5,
                isCustom: true
            };

            const fullResolvedLibrary = resolveEffectiveExercises(seed.exercises, [customExercise1, customExercise2]);
            const fullResolvedFoods = resolveEffectiveFoods(seed.foods, [customFood1, customFood2]);

            expect(fullResolvedLibrary.length).toBe(seed.exercises.length + 2);
            expect(fullResolvedFoods.length).toBe(seed.foods.length + 2);

            const stateToSave: UserData = {
                profile: { name: 'Delta Test Athlete' },
                library: fullResolvedLibrary,
                customFoods: fullResolvedFoods,
                catalogOverrides: {},
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            };

            expect(await DB.saveUserData(stateToSave)).toEqual({ ok: true, status: 'synced' });

            expect(mockBatch.commit).toHaveBeenCalled();
            expect(capturedUserDocData).toBeDefined();

            // Library in Firestore contains ONLY the 2 custom items, NOT the 176+ seed items!
            expect(capturedUserDocData.library).toHaveLength(2);
            expect(capturedUserDocData.library.map((e: any) => e.id)).toEqual(
                expect.arrayContaining(['custom_ex_hack_squat', 'custom_ex_reverse_fly'])
            );

            // customFoods in Firestore contains ONLY the 2 custom items, NOT the 221+ seed items!
            expect(capturedUserDocData.customFoods).toHaveLength(2);
            expect(capturedUserDocData.customFoods.map((f: any) => f.id)).toEqual(
                expect.arrayContaining(['custom_food_clear_whey', 'custom_food_rice_creme'])
            );

            // Document size is tiny (< 15KB, well below 950KB limit)
            expect(JSON.stringify(capturedUserDocData).length).toBeLessThan(15000);
        });

        it('persists modified catalog overrides and hidden IDs accurately to Firestore', async () => {
            // Local fixture (seed is empty — commit e61a133)
            const globalExFixture: import('../src/types').CatalogExercise[] = [
                { id: 'panca-piana-bilanciere', name: 'Panca Piana Bilanciere', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 4 },
                { id: 'panca-declinata-bilanciere', name: 'Panca Declinata', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 3 }
            ];
            const globalFoodFixture: import('../src/types').CatalogFood[] = [
                { id: 'petto-di-pollo-crudo', name: 'Petto di pollo crudo', kcal: 106, pro: 22.5, carbs: 0, fat: 1.9, isCustom: false },
                { id: 'petto-di-tacchino-crudo', name: 'Petto di tacchino crudo', kcal: 104, pro: 22.0, carbs: 0, fat: 1.5, isCustom: false }
            ];
            const fixtureCatalog = {
                manifest: { version: '1.0.0', schemaVersion: 1, docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' } },
                exercises: globalExFixture,
                foods: globalFoodFixture
            } as any;
            await saveCatalogToCache(fixtureCatalog);

            const baseBench = globalExFixture.find(e => e.id === 'panca-piana-bilanciere')!;
            const benchOverride = createExerciseOverride(baseBench, {
                notes: 'Pausa 2 secondi al petto',
                equipmentWeight: 20
            });

            const baseChicken = globalFoodFixture.find(f => f.id === 'petto-di-pollo-crudo')!;
            const chickenOverride = createFoodOverride(baseChicken, {
                pro: 25,
                kcal: 110
            });

            let overrides: CatalogOverrides = {
                exercises: {
                    'panca-piana-bilanciere': benchOverride
                },
                foods: {
                    'petto-di-pollo-crudo': chickenOverride
                }
            };
            overrides = hideCatalogExercise('panca-declinata-bilanciere', overrides);
            overrides = hideCatalogFood('petto-di-tacchino-crudo', overrides);

            const fullResolvedLibrary = resolveEffectiveExercises(globalExFixture, [], overrides);
            const fullResolvedFoods = resolveEffectiveFoods(globalFoodFixture, [], overrides);

            const stateToSave: UserData = {
                profile: { name: 'Override Athlete' },
                library: fullResolvedLibrary,
                customFoods: fullResolvedFoods,
                catalogOverrides: overrides,
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            };

            expect(await DB.saveUserData(stateToSave)).toEqual({ ok: true, status: 'synced' });

            expect(mockBatch.commit).toHaveBeenCalled();
            expect(capturedUserDocData).toBeDefined();

            // Zero custom items
            expect(capturedUserDocData.library).toHaveLength(0);
            expect(capturedUserDocData.customFoods).toHaveLength(0);

            // Overrides serialized correctly
            expect(capturedUserDocData.catalogOverrides.exercises['panca-piana-bilanciere'].notes).toBe('Pausa 2 secondi al petto');
            expect(capturedUserDocData.catalogOverrides.exercises['panca-piana-bilanciere'].equipmentWeight).toBe(20);
            expect(capturedUserDocData.catalogOverrides.foods['petto-di-pollo-crudo'].pro).toBe(25);
            expect(capturedUserDocData.catalogOverrides.hiddenExerciseIds).toContain('panca-declinata-bilanciere');
            expect(capturedUserDocData.catalogOverrides.hiddenFoodIds).toContain('petto-di-tacchino-crudo');
        });

        it('guarantees seed catalog fallback when inMemoryCatalogCache is null without leaking seed items', async () => {
            // Ensure in-memory cache is completely clear
            await clearCatalogCache();

            const seed = getSeedCatalog();
            const fullResolvedLibrary = resolveEffectiveExercises(seed.exercises, []);
            const fullResolvedFoods = resolveEffectiveFoods(seed.foods, []);

            const stateToSave: UserData = {
                profile: { name: 'Cold Fallback User' },
                library: fullResolvedLibrary,
                customFoods: fullResolvedFoods,
                catalogOverrides: {},
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: [],
                activeWorkout: null
            };

            // Should not throw and should still isolate deltas via getSeedCatalog fallback
            expect(await DB.saveUserData(stateToSave)).toEqual({ ok: true, status: 'synced' });

            expect(mockBatch.commit).toHaveBeenCalled();
            expect(capturedUserDocData).toBeDefined();
            expect(capturedUserDocData.library).toHaveLength(0);
            expect(capturedUserDocData.customFoods).toHaveLength(0);
        });
    });

    describe('DB.loadUserData Catalog Resolution', () => {
        it('hydrates user data from Firestore and resolves effective library and foods', async () => {
            // Inject a fixture catalog so DB.loadUserData can resolve effective library and foods.
            // seedExercises.json is intentionally empty (commit e61a133); the global catalog
            // is normally fetched from Firestore. This simulates that post-fetch state.
            const globalExFixture: import('../src/types').CatalogExercise[] = [
                { id: 'panca-piana-bilanciere', name: 'Panca Piana Bilanciere', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 4 },
                { id: 'panca-declinata-bilanciere', name: 'Panca Declinata', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true, setsCount: 3 },
                { id: 'squat-bilanciere', name: 'Squat Bilanciere', muscles: ['quads'], trackingType: 'weight_reps', isDefault: true, setsCount: 4 }
            ];
            const globalFoodFixture: import('../src/types').CatalogFood[] = [
                { id: 'petto-di-pollo-crudo', name: 'Petto di pollo crudo', kcal: 106, pro: 22.5, carbs: 0, fat: 1.9, isCustom: false },
                { id: 'riso-bianco-cotto', name: 'Riso bianco cotto', kcal: 130, pro: 2.7, carbs: 28.6, fat: 0.3, isCustom: false }
            ];
            const fixtureCatalog = {
                manifest: { version: '1.0.0', schemaVersion: 1, docRefs: { exercises: 'exercises_v1', foods: 'foods_v1' } },
                exercises: globalExFixture,
                foods: globalFoodFixture
            } as any;
            await saveCatalogToCache(fixtureCatalog);

            const mockFirestoreDoc = {
                profile: { name: 'Cloud User', height: '180' },
                library: [
                    { id: 'cloud_custom_dip', name: 'Dip alle Parallele Zavorrate', setsCount: 4, sets: [], isDefault: false }
                ],
                customFoods: [
                    { id: 'cloud_custom_quark', name: 'Formaggio Quark Magro', kcal: 68, pro: 12, carbs: 4, fat: 0.2, isCustom: true }
                ],
                catalogOverrides: {
                    exercises: {
                        'panca-piana-bilanciere': { notes: 'Presa stretta' }
                    },
                    hiddenExerciseIds: ['panca-declinata-bilanciere']
                },
                routines: [],
                history: [],
                nutrition: {},
                trainingCycles: [],
                activeCycleId: null,
                supplements: []
            };

            vi.mocked(getDoc).mockResolvedValueOnce({
                exists: () => true,
                data: () => mockFirestoreDoc
            } as any);

            const loaded = await DB.loadUserData();

            expect(loaded).not.toBeNull();
            expect(loaded?.profile?.name).toBe('Cloud User');
            // Library: 1 custom + 2 unhidden globals (panca-declinata hidden) = 3
            expect(loaded?.library?.length).toBeGreaterThan(1);
            expect(loaded?.library?.find(e => e.id === 'cloud_custom_dip')).toBeDefined();
            expect(loaded?.library?.find(e => e.id === 'panca-piana-bilanciere')?.notes).toBe('Presa stretta');
            expect(loaded?.library?.find(e => e.id === 'panca-declinata-bilanciere')).toBeUndefined();

            // Foods: 1 custom + 2 standard globals = 3
            expect(loaded?.customFoods?.length).toBeGreaterThan(1);
            expect(loaded?.customFoods?.find(f => f.id === 'cloud_custom_quark')).toBeDefined();
        });

        it('returns standard catalog defaults when user document does not exist', async () => {
            vi.mocked(getDoc).mockResolvedValueOnce({
                exists: () => false,
                data: () => undefined
            } as any);

            const loaded = await DB.loadUserData();

            // When user doc is missing, standard catalog defaults are loaded from seeds (which are now empty).
            expect(loaded?.library?.length).toBe(0);
            expect(loaded?.customFoods?.length).toBe(0);
        });
    });

    describe('createDataSlice Cache Tiering', () => {
        it('saveUserDataToCache stores and removes user data in an owner-scoped IndexedDB envelope', async () => {
            const testData: UserData = {
                profile: { name: 'Cache User' },
                library: [],
                routines: [],
                history: [],
                nutrition: {},
                customFoods: [],
                activeWorkout: null,
                nutritionPlanning: null
            };

            await saveUserDataToCache(testData);
            expect(idbStore['logbook:v2:user:test-user-id']).toBeDefined();
            expect(idbStore['logbook:v2:user:test-user-id'].data.profile.name).toBe('Cache User');

            await saveUserDataToCache(null);
            expect(idbStore['logbook:v2:user:test-user-id']).toBeUndefined();
        });

        it('getInitialUserData safely returns validated UserData from window.__INITIAL_USER_DATA__', () => {
            const rawData = {
                profile: { name: 'Preboot User' },
                library: [],
                routines: [],
                history: [],
                nutrition: {},
                customFoods: [],
                catalogOverrides: { exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }
            };

            window.__INITIAL_USER_DATA__ = rawData;
            const parsed = getInitialUserData();

            expect(parsed).not.toBeNull();
            expect(parsed?.profile?.name).toBe('Preboot User');
            expect(parsed?.catalogOverrides).toBeDefined();
        });
    });
});
