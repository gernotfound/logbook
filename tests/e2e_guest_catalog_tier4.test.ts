import { describe, it, expect, beforeEach, vi } from 'vitest';
import { writeBatch } from 'firebase/firestore';

vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import { getSeedCatalog, saveCatalogToCache, clearCatalogCache } from '../src/lib/catalog/catalogService';
import {
    resolveEffectiveExercises,
    resolveEffectiveFoods,
    extractCustomExercisesAndOverrides
} from '../src/lib/catalog/deltaResolver';
import { mergeUserData, hasUserData } from '../src/lib/merge';
import { useAppStore } from '../src/store/useAppStore';
import type {
    UserData,
    Exercise,
    Food,
    CatalogExercise,
    CatalogFood,
    CatalogOverrides
} from '../src/types';
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

            const { customExercises, overrides } = extractCustomExercisesAndOverrides(legacyLibrary, globalFixture);

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
