import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.unmock('../src/lib/db');
import { TestDB as DB } from './testUtils';
import { getSeedCatalog, clearCatalogCache } from '../src/lib/catalog/catalogService';
import {
    resolveEffectiveExercises,
    resolveEffectiveFoods,
    createExerciseOverride,
    createFoodOverride,
    hideCatalogExercise,
    hideCatalogFood
} from '../src/lib/catalog/deltaResolver';
import { useAppStore } from '../src/store/useAppStore';
import type {
    Exercise,
    Food,
    CatalogExercise,
    CatalogFood,
    CatalogOverrides,
    WorkoutSession,
    WorkoutRoutine,
    NutritionDay
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
            expect(currentData.nutrition?.['2026-08-23'].weight).toBe(79.5);
        });
    });
});
