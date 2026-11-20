import { describe, it, expect } from 'vitest';
import { mergeUserData, mergeNutritionPlanning } from '../../../src/lib/merge';
import type { UserData, NutritionDay, WorkoutSession } from '../../../src/types';

describe('Empirical Challenger: Deterministic Guest Merge (R5) Stress & Adversarial Suite', () => {

    describe('4. Idempotency and Determinism Stress', () => {
        it('guarantees idempotence: mergeUserData(merged, merged) === merged', () => {
            const cloudData: UserData = {
                profile: { height: '178', gender: 'M', waist: '84' },
                library: [{ id: 'ex1', name: 'Bench', setsCount: 3, sets: [] }],
                routines: [{ id: 'r1', name: 'Push', exercises: [] }],
                customFoods: [{ id: 'f1', name: 'Oats', kcal: 370, pro: 13, carbs: 60, fat: 7 }],
                trainingCycles: [{ id: 'tc1', name: 'Cycle A', durationWeeks: 4, routines: [] }],
                history: [{ id: 'h1', date: '2026-08-01', exercises: [] }],
                supplements: [{ id: 's1', name: 'Creatine', unit: 'g' }],
                nutrition: { '2026-08-01': { date: '2026-08-01', kcal: 2000, carbs: 200, pro: 150, fat: 60, meals: [], supplementsIntake: [] } },
                activeWorkout: { id: 'w1', exercises: [] },
                activeCycleId: 'tc1',
                nutritionPlanning: { weight: 75, avgMacros: { carbsPerKg: 3.0, proPerKg: 2.0, fatPerKg: 1.0 } }
            };

            const guestData: UserData = {
                profile: { height: '180', neck: '40' },
                library: [{ id: 'ex2', name: 'Squat', setsCount: 4, sets: [] }],
                routines: [{ id: 'r2', name: 'Legs', exercises: [] }],
                customFoods: [{ id: 'f2', name: 'Chicken', kcal: 165, pro: 31, carbs: 0, fat: 3.6 }],
                trainingCycles: [{ id: 'tc2', name: 'Cycle B', durationWeeks: 6, routines: [] }],
                history: [{ id: 'h2', date: '2026-08-02', exercises: [] }],
                supplements: [{ id: 's2', name: 'Omega 3', unit: 'cps' }],
                nutrition: { '2026-08-02': { date: '2026-08-02', kcal: 2200, carbs: 220, pro: 160, fat: 65, meals: [], supplementsIntake: [] } },
                activeWorkout: { id: 'w2', exercises: [] },
                activeCycleId: 'tc2',
                nutritionPlanning: { weight: 78, avgMacros: { carbsPerKg: 3.5, proPerKg: 2, fatPerKg: 1 }, normocalorica: { kcal: 2600, carbs: 300, pro: 170, fat: 70 } }
            };

            const merged1 = mergeUserData(cloudData, guestData);
            const merged2 = mergeUserData(merged1, merged1);
            const merged3 = mergeUserData(merged1, guestData);

            expect(merged2).toEqual(merged1);
            expect(merged3).toEqual(merged1);
        });

        it('keeps competing nutritionPlanning partials separately without unmarked-origin deep merge', () => {
            const cloudPlan = {
                weight: 70,
                avgMacros: { carbsPerKg: 3.0, proPerKg: 2.0, fatPerKg: 1.0 },
                onBoost: { carbsPercent: 10, proPercent: 0, fatPercent: 0 },
                onMacros: { carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 },
                offMacros: { carbsPerKg: 2.5, proPerKg: 2.0, fatPerKg: 1.0 },
                normocalorica: { kcal: 2200, carbs: 250, pro: 150, fat: 60 }
            };

            const guestPlan = {
                weight: 75,
                avgMacros: { carbsPerKg: 3.5, proPerKg: 2.2, fatPerKg: 0.9 },
                onBoost: { carbsPercent: 15, proPercent: 5, fatPercent: -5 },
                normocalorica: { kcal: 2500, carbs: 300 }
            };

            const merged = mergeNutritionPlanning(cloudPlan, guestPlan);
            expect(merged.activeOrigin).toBe('user-edited');
            expect(merged.activePlan).toEqual(cloudPlan);
            expect(merged.pendingConflict).toEqual(guestPlan);
            expect(merged.activePlan?.normocalorica?.pro).toBe(150);
            expect(merged.pendingConflict?.avgMacros?.proPerKg).toBe(2.2);
            expect(merged.pendingConflict?.normocalorica?.carbs).toBe(300);
        });
    });

    describe('5. Large Scale Dataset Merge (Volume, Performance & Memory Stress)', () => {
        it('merges large datasets with deterministic collisions and preserves all collections', () => {
            const ITEM_COUNT = 60; // 60 cloud + 60 guest with 30 collisions each = 90 items per collection (within schema max limits: cycles/supps <= 100, routines <= 300, lib/foods <= 500)

            const cloudLibrary: any[] = [];
            const guestLibrary: any[] = [];

            const cloudRoutines: any[] = [];
            const guestRoutines: any[] = [];

            const cloudCustomFoods: any[] = [];
            const guestCustomFoods: any[] = [];

            const cloudCycles: any[] = [];
            const guestCycles: any[] = [];

            const cloudHistory: WorkoutSession[] = [];
            const guestHistory: WorkoutSession[] = [];

            const cloudSupplements: any[] = [];
            const guestSupplements: any[] = [];

            const cloudNutrition: Record<string, NutritionDay> = {};
            const guestNutrition: Record<string, NutritionDay> = {};

            // Generate datasets
            for (let i = 0; i < ITEM_COUNT; i++) {
                // Library
                cloudLibrary.push({ id: `ex_${i}`, name: `Cloud Exercise ${i}`, targetMuscle: 'petto', setsCount: 3, sets: [] });
                // 50% collision
                const guestExId = i < 30 ? `ex_${i}` : `ex_guest_${i}`;
                guestLibrary.push({ id: guestExId, name: `Guest Exercise ${i}`, targetMuscle: 'petto', setsCount: 4, sets: [] });

                // Routines
                cloudRoutines.push({ id: `rt_${i}`, name: `Cloud Routine ${i}`, exercises: [{ exId: `ex_${i}`, setsCount: 3 }] });
                const guestRtId = i < 30 ? `rt_${i}` : `rt_guest_${i}`;
                guestRoutines.push({ id: guestRtId, name: `Guest Routine ${i}`, exercises: [{ exId: guestExId, setsCount: 4 }] });

                // Custom Foods
                cloudCustomFoods.push({ id: `food_${i}`, name: `Cloud Food ${i}`, kcal: 100 + i, pro: 10, carbs: 20, fat: 5 });
                const guestFoodId = i < 30 ? `food_${i}` : `food_guest_${i}`;
                guestCustomFoods.push({ id: guestFoodId, name: `Guest Food ${i}`, kcal: 120 + i, pro: 12, carbs: 22, fat: 6 });

                // Training Cycles
                cloudCycles.push({ id: `cyc_${i}`, name: `Cloud Cycle ${i}`, durationWeeks: 4, routines: [] });
                const guestCycId = i < 30 ? `cyc_${i}` : `cyc_guest_${i}`;
                guestCycles.push({ id: guestCycId, name: `Guest Cycle ${i}`, durationWeeks: 6, routines: [] });

                // History
                cloudHistory.push({
                    id: `hist_${i}`,
                    date: '2026-08-01',
                    routineName: `Cloud Session ${i}`,
                    exercises: [{ exId: `ex_${i}`, sessionNote: '', sets: [{ id: `s_${i}`, kg: '80', reps: '10' }] }]
                });
                const guestHistId = i < 30 ? `hist_${i}` : `hist_guest_${i}`;
                guestHistory.push({
                    id: guestHistId,
                    date: '2026-08-02',
                    routineName: `Guest Session ${i}`,
                    exercises: [{ exId: guestExId, sessionNote: '', sets: [{ id: `s_${i}`, kg: '85', reps: '10' }] }]
                });

                // Supplements
                cloudSupplements.push({ id: `supp_${i}`, name: `Cloud Supplement ${i}`, unit: 'g', target: 5 });
                const guestSuppId = i < 30 ? `supp_${i}` : `supp_guest_${i}`;
                guestSupplements.push({ id: guestSuppId, name: `Guest Supplement ${i}`, unit: 'g', target: 10 });

                // Nutrition Days (Dates)
                const dateKey = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
                cloudNutrition[dateKey] = {
                    date: dateKey,
                    kcal: 2000 + i,
                    carbs: 200,
                    pro: 150,
                    fat: 60,
                    meals: [{ id: `meal_c_${i}`, name: `Cloud Meal ${i}`, meal: 'pranzo', quantity: 100, baseQty: 100, kcal: 300, carbs: 30, pro: 20, fat: 5 }]
                };
                const guestDateKey = i < 30 ? dateKey : new Date(Date.UTC(2026, 6, i + 1)).toISOString().slice(0, 10);
                guestNutrition[guestDateKey] = {
                    date: guestDateKey,
                    kcal: 2100 + i,
                    carbs: 210,
                    pro: 160,
                    fat: 65,
                    meals: [{ id: `meal_g_${i}`, name: `Guest Meal ${i}`, meal: 'cena', quantity: 100, baseQty: 100, kcal: 400, carbs: 40, pro: 30, fat: 10 }]
                };
            }

            const cloudData: UserData = {
                profile: { height: '180', waist: '80' },
                library: cloudLibrary,
                routines: cloudRoutines,
                customFoods: cloudCustomFoods,
                trainingCycles: cloudCycles,
                history: cloudHistory,
                supplements: cloudSupplements,
                nutrition: cloudNutrition,
                activeWorkout: null,
                activeCycleId: 'cyc_0'
            };

            const guestData: UserData = {
                profile: { height: '182', waist: '82' },
                library: guestLibrary,
                routines: guestRoutines,
                customFoods: guestCustomFoods,
                trainingCycles: guestCycles,
                history: guestHistory,
                supplements: guestSupplements,
                nutrition: guestNutrition,
                activeWorkout: { id: 'w_active_large', exercises: [] },
                activeCycleId: 'cyc_guest_0'
            };

            const merged = mergeUserData(cloudData, guestData);

            // Assert all collections survive deterministic collision resolution.
            expect(merged.library).toHaveLength(90); // 60 + 60 - 30 collisions = 90
            expect(merged.routines).toHaveLength(90);
            expect(merged.customFoods).toHaveLength(90);
            expect(merged.trainingCycles).toHaveLength(90);
            expect(merged.history).toHaveLength(90);
            expect(merged.supplements).toHaveLength(90);
            // The dates must be real ISO calendar days: malformed fixture keys can be
            // discarded by schema validation and conceal missing nutrition records.
            expect(Object.keys(merged.nutrition ?? {})).toHaveLength(90);
            expect(Object.keys(merged.nutrition ?? {}).every(date => /^\d{4}-\d{2}-\d{2}$/.test(date))).toBe(true);
            expect(merged.nutrition?.['2026-01-01']).toBeDefined();
            expect(merged.nutrition?.['2026-08-01']).toBeDefined();
            // A length-only check could miss a wrong collision winner or
            // another entry silently replacing a required distinct identity.
            const collections = [
                { names: new Map(merged.library?.map(item => [item.id, item.name] as const)), prefix: 'ex', label: 'Exercise' },
                { names: new Map(merged.routines?.map(item => [item.id, item.name] as const)), prefix: 'rt', label: 'Routine' },
                { names: new Map(merged.customFoods?.map(item => [item.id, item.name] as const)), prefix: 'food', label: 'Food' },
                { names: new Map(merged.trainingCycles?.map(item => [item.id, item.name] as const)), prefix: 'cyc', label: 'Cycle' },
                { names: new Map(merged.history?.map(item => [item.id, item.routineName] as const)), prefix: 'hist', label: 'Session' },
                { names: new Map(merged.supplements?.map(item => [item.id, item.name] as const)), prefix: 'supp', label: 'Supplement' },
            ];
            for (const { names, prefix, label } of collections) {
                expect(names.size).toBe(90);
                for (let i = 0; i < ITEM_COUNT; i++) {
                    expect(names.get(`${prefix}_${i}`)).toBe(`${i < 30 ? 'Guest' : 'Cloud'} ${label} ${i}`);
                    if (i >= 30) {
                        expect(names.get(`${prefix}_guest_${i}`)).toBe(`Guest ${label} ${i}`);
                    }
                }
            }
            for (let i = 0; i < 30; i++) {
                const date = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
                expect(merged.nutrition?.[date]?.meals?.map(meal => meal.id).sort())
                    .toEqual([`meal_c_${i}`, `meal_g_${i}`]);
            }
            for (let i = 30; i < ITEM_COUNT; i++) {
                const cloudDate = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
                const guestDate = new Date(Date.UTC(2026, 6, i + 1)).toISOString().slice(0, 10);
                expect(merged.nutrition?.[cloudDate]?.meals?.map(meal => meal.id))
                    .toEqual([`meal_c_${i}`]);
                expect(merged.nutrition?.[guestDate]?.meals?.map(meal => meal.id))
                    .toEqual([`meal_g_${i}`]);
            }

            expect(merged.activeWorkout?.id).toBe('w_active_large');
            expect(merged.profile?.height).toBe('182');
            expect(merged.profile?.waist).toBe('82');
        });
    });
});
