import { describe, it, expect } from 'vitest';
import { mergeUserData, mergeArrayById, mergeNutrition, mergeProfile, mergeNutritionPlanning, hasUserData } from '../src/lib/merge';
import { UserDataSchema } from '../src/lib/schema';
import type { UserData, NutritionDay, WorkoutSession, LoggedMealItem } from '../src/types';

describe('Empirical Challenger: Deterministic Guest Merge (R5) Stress & Adversarial Suite', () => {

    describe('1. Deep ID Collisions across All 11 Collections & Nested Structures', () => {
        it('handles collisions in library (exercises) with varying ID formats (numeric, uuid, string)', () => {
            const cloudLib = [
                { id: '101', name: 'Cloud Bench', targetMuscle: 'petto', setsCount: 3, sets: [] },
                { id: 202 as any, name: 'Cloud Squat (Numeric ID)', targetMuscle: 'gambe', setsCount: 4, sets: [] },
                { id: 'uuid-ex-303', name: 'Cloud Deadlift', targetMuscle: 'schiena', setsCount: 5, sets: [] },
                { id: 'cloud-unique', name: 'Cloud Overhead Press', targetMuscle: 'spalle', setsCount: 3, sets: [] },
            ];

            const guestLib = [
                { id: '101', name: 'Guest Bench Overwrite', targetMuscle: 'petto', setsCount: 4, sets: [] },
                { id: '202', name: 'Guest Squat (String ID match)', targetMuscle: 'gambe', setsCount: 5, sets: [] },
                { id: 'uuid-ex-303', name: 'Guest Deadlift Overwrite', targetMuscle: 'schiena', setsCount: 6, sets: [] },
                { id: 'guest-unique', name: 'Guest Lateral Raise', targetMuscle: 'spalle', setsCount: 3, sets: [] },
            ];

            const merged = mergeArrayById(cloudLib, guestLib);
            expect(merged).toHaveLength(5);
            expect(merged.find(e => String(e.id) === '101')?.name).toBe('Guest Bench Overwrite');
            expect(merged.find(e => String(e.id) === '202')?.name).toBe('Guest Squat (String ID match)');
            expect(merged.find(e => String(e.id) === 'uuid-ex-303')?.name).toBe('Guest Deadlift Overwrite');
            expect(merged.find(e => String(e.id) === 'cloud-unique')?.name).toBe('Cloud Overhead Press');
            expect(merged.find(e => String(e.id) === 'guest-unique')?.name).toBe('Guest Lateral Raise');
        });

        it('handles collisions in routines with nested exercise arrays', () => {
            const cloudRoutines = [
                {
                    id: 'r_push',
                    name: 'Cloud Push Routine',
                    exercises: [{ exId: 'ex1', setsCount: 3, minReps: 8, maxReps: 10 }]
                },
                {
                    id: 'r_pull',
                    name: 'Cloud Pull Routine',
                    exercises: [{ exId: 'ex2', setsCount: 4, minReps: 6, maxReps: 8 }]
                }
            ];

            const guestRoutines = [
                {
                    id: 'r_push',
                    name: 'Guest Push Routine Overwrite',
                    exercises: [
                        { exId: 'ex1', setsCount: 4, minReps: 10, maxReps: 12, defaultTechnique: 'dropset' as const },
                        { exId: 'ex3', setsCount: 3, minReps: 12, maxReps: 15 }
                    ]
                },
                {
                    id: 'r_legs',
                    name: 'Guest Legs Routine',
                    exercises: [{ exId: 'ex4', setsCount: 5, minReps: 5, maxReps: 5 }]
                }
            ];

            const merged = mergeArrayById(cloudRoutines, guestRoutines);
            expect(merged).toHaveLength(3);
            const push = merged.find(r => r.id === 'r_push');
            expect(push?.name).toBe('Guest Push Routine Overwrite');
            expect(push?.exercises).toHaveLength(2);
            expect(push?.exercises[0].defaultTechnique).toBe('dropset');
        });

        it('handles collisions in customFoods with nutritional macro differences', () => {
            const cloudFoods = [
                { id: 'f_rice', name: 'White Rice', kcal: 130, carbs: 28, pro: 2.7, fat: 0.3, isCustom: true },
                { id: 'f_beef', name: 'Lean Beef', kcal: 200, carbs: 0, pro: 26, fat: 10, isCustom: true }
            ];

            const guestFoods = [
                { id: 'f_rice', name: 'Basmati Rice (Organic)', kcal: 135, carbs: 29, pro: 3.0, fat: 0.4, isCustom: true },
                { id: 'f_salmon', name: 'Wild Salmon', kcal: 208, carbs: 0, pro: 20, fat: 13, isCustom: true }
            ];

            const merged = mergeArrayById(cloudFoods, guestFoods);
            expect(merged).toHaveLength(3);
            const rice = merged.find(f => f.id === 'f_rice');
            expect(rice?.name).toBe('Basmati Rice (Organic)');
            expect(rice?.kcal).toBe(135);
        });

        it('handles collisions in trainingCycles with nested routine frequencies and progression modes', () => {
            const cloudCycles = [
                {
                    id: 'cycle_1',
                    name: 'Cloud Meso 1',
                    durationWeeks: 4,
                    progressionMode: 'fixed' as const,
                    routines: [{ routineId: 'r_push', frequencyPerWeek: 2 }]
                }
            ];

            const guestCycles = [
                {
                    id: 'cycle_1',
                    name: 'Guest Meso 1 Overwrite',
                    durationWeeks: 6,
                    progressionMode: 'sequential' as const,
                    routines: [
                        { routineId: 'r_push', frequencyPerWeek: 2 },
                        { routineId: 'r_pull', frequencyPerWeek: 2 }
                    ]
                },
                {
                    id: 'cycle_2',
                    name: 'Guest Meso 2',
                    durationWeeks: 8,
                    routines: [{ routineId: 'r_legs', frequencyPerWeek: 2 }]
                }
            ];

            const merged = mergeArrayById(cloudCycles, guestCycles);
            expect(merged).toHaveLength(2);
            const c1 = merged.find(c => c.id === 'cycle_1');
            expect(c1?.name).toBe('Guest Meso 1 Overwrite');
            expect(c1?.durationWeeks).toBe(6);
            expect(c1?.progressionMode).toBe('sequential');
            expect(c1?.routines).toHaveLength(2);
        });

        it('handles collisions in history with multi-set, dropsets, and isometric details', () => {
            const cloudHistory: WorkoutSession[] = [
                {
                    id: 'sess_001',
                    date: '2026-08-01',
                    routineName: 'Push Day Cloud',
                    globalDurationStr: '01:00:00',
                    exercises: [
                        {
                            exId: 'ex1',
                            sessionNote: 'Cloud notes',
                            sets: [{ id: 's1', kg: '100', reps: '10', done: true }]
                        }
                    ]
                }
            ];

            const guestHistory: WorkoutSession[] = [
                {
                    id: 'sess_001',
                    date: '2026-08-01',
                    routineName: 'Push Day Guest Overwrite',
                    globalDurationStr: '01:15:00',
                    moodRating: 5,
                    exercises: [
                        {
                            exId: 'ex1',
                            sessionNote: 'Guest notes updated',
                            sets: [
                                {
                                    id: 's1',
                                    kg: '105',
                                    reps: '10',
                                    done: true,
                                    dropsets: [{ id: 'd1', kg: '80', reps: '8' }],
                                    isometrics: [{ id: 'i1', kg: '60', time: '10' }]
                                }
                            ]
                        }
                    ]
                },
                {
                    id: 'sess_002',
                    date: '2026-08-03',
                    routineName: 'Pull Day Guest',
                    exercises: []
                }
            ];

            const merged = mergeArrayById(cloudHistory, guestHistory);
            expect(merged).toHaveLength(2);
            const s1 = merged.find(s => s.id === 'sess_001');
            expect(s1?.routineName).toBe('Push Day Guest Overwrite');
            expect(s1?.moodRating).toBe(5);
            expect(s1?.exercises[0].sets[0].kg).toBe('105');
            expect(s1?.exercises[0].sets[0].dropsets).toHaveLength(1);
            expect(s1?.exercises[0].sets[0].isometrics).toHaveLength(1);
        });

        it('handles collisions in supplements collection', () => {
            const cloudSupps = [
                { id: 'supp_1', name: 'Creatine Monohydrate', unit: 'g', target: 3, portion: 3 },
                { id: 'supp_2', name: 'Whey Protein', unit: 'g', target: 30, portion: 30 }
            ];

            const guestSupps = [
                { id: 'supp_1', name: 'Creatine Creapure', unit: 'g', target: 5, portion: 5 },
                { id: 'supp_3', name: 'Zinc & Magnesium', unit: 'cps', target: 1, portion: 1 }
            ];

            const merged = mergeArrayById(cloudSupps, guestSupps);
            expect(merged).toHaveLength(3);
            const s1 = merged.find(s => s.id === 'supp_1');
            expect(s1?.name).toBe('Creatine Creapure');
            expect(s1?.target).toBe(5);
        });
    });

    describe('2. Extreme Date Ranges & Overlapping Nutrition Logs', () => {
        it('handles disjoint date ranges across multi-year timeline (2020 through 2030 + Leap Years)', () => {
            const cloudNut: Record<string, NutritionDay> = {
                '2020-02-29': { date: '2020-02-29', kcal: 2000, carbs: 200, pro: 150, fat: 50, meals: [], supplementsIntake: [] },
                '2024-02-29': { date: '2024-02-29', kcal: 2200, carbs: 220, pro: 160, fat: 60, meals: [], supplementsIntake: [] },
                '2026-12-31': { date: '2026-12-31', kcal: 3000, carbs: 350, pro: 180, fat: 80, meals: [], supplementsIntake: [] }
            };

            const guestNut: Record<string, NutritionDay> = {
                '2024-02-29': { date: '2024-02-29', kcal: 2300, carbs: 230, pro: 170, fat: 65, weight: 75.5, meals: [], supplementsIntake: [] },
                '2028-02-29': { date: '2028-02-29', kcal: 2400, carbs: 240, pro: 180, fat: 70, meals: [], supplementsIntake: [] },
                '2030-01-01': { date: '2030-01-01', kcal: 2500, carbs: 250, pro: 190, fat: 75, meals: [], supplementsIntake: [] }
            };

            const merged = mergeNutrition(cloudNut, guestNut);
            const dates = Object.keys(merged).sort();
            expect(dates).toEqual(['2020-02-29', '2024-02-29', '2026-12-31', '2028-02-29', '2030-01-01']);
            expect(merged['2024-02-29'].weight).toBe(75.5);
            expect(merged['2024-02-29'].kcal).toBe(2300);
        });

        it('merges overlapping dates with complex meal and supplement intake collision matrices', () => {
            const date = '2026-08-16';
            const cloudDay: NutritionDay = {
                date,
                kcal: 1000,
                carbs: 100,
                pro: 80,
                fat: 30,
                weight: 80.0,
                waist: 85,
                neck: 40,
                meals: [
                    { id: 'meal_1', name: 'Breakfast Oats', meal: 'colazione', quantity: 100, baseQty: 100, kcal: 370, carbs: 60, pro: 13, fat: 7 },
                    { id: 'meal_2', name: 'Lunch Chicken Rice', meal: 'pranzo', quantity: 200, baseQty: 100, kcal: 250, carbs: 40, pro: 20, fat: 2 },
                    { id: 'meal_3', name: 'Snack Apple', meal: 'snack', quantity: 150, baseQty: 100, kcal: 52, carbs: 14, pro: 0.3, fat: 0.2 },
                ],
                supplementsIntake: [
                    { id: 'intake_1', supplementId: 'supp_creatine', amount: 5, time: 1000 },
                    { id: 'intake_2', supplementId: 'supp_whey', amount: 30, time: 2000 },
                ]
            };

            const guestDay: NutritionDay = {
                date,
                kcal: 1200,
                carbs: 120,
                pro: 90,
                fat: 35,
                weight: 79.5, // guest updated weight
                waist: 84, // guest updated waist
                chest: 105, // guest added chest
                // neck omitted, should keep cloud neck (40)
                meals: [
                    // Collision on meal_2: guest modified quantity to 250g
                    { id: 'meal_2', name: 'Lunch Chicken Rice (Extra)', meal: 'pranzo', quantity: 250, baseQty: 100, kcal: 250, carbs: 40, pro: 20, fat: 2 },
                    // New meal_4 from guest
                    { id: 'meal_4', name: 'Dinner Salmon Potatoes', meal: 'cena', quantity: 100, baseQty: 100, kcal: 500, carbs: 40, pro: 35, fat: 20 },
                ],
                supplementsIntake: [
                    // Collision on intake_2: guest updated amount to 40g
                    { id: 'intake_2', supplementId: 'supp_whey', amount: 40, time: 2000 },
                    // New intake_3 from guest
                    { id: 'intake_3', supplementId: 'supp_omega3', amount: 2, time: 3000 },
                ]
            };

            const merged = mergeNutrition({ [date]: cloudDay }, { [date]: guestDay });
            const day = merged[date];

            // Measurements
            expect(day.weight).toBe(79.5);
            expect(day.waist).toBe(84);
            expect(day.neck).toBe(40);
            expect(day.chest).toBe(105);

            // Meals merged: meal_1 (cloud), meal_2 (guest), meal_3 (cloud), meal_4 (guest)
            expect(day.meals).toHaveLength(4);
            const m2 = day.meals?.find(m => m.id === 'meal_2');
            expect(m2?.name).toBe('Lunch Chicken Rice (Extra)');
            expect(m2?.quantity).toBe(250);

            // Supplements intake merged: intake_1 (cloud), intake_2 (guest 40g), intake_3 (guest)
            expect(day.supplementsIntake).toHaveLength(3);
            const i2 = day.supplementsIntake?.find(i => i.id === 'intake_2');
            expect(i2?.amount).toBe(40);

            // Macro calculation verification:
            // meal_1: 100g -> 370 kcal, 60c, 13p, 7f
            // meal_2: 250g (ratio 2.5 of 250kcal) -> 625 kcal, 100c, 50p, 5f
            // meal_3: 150g (ratio 1.5 of 52kcal) -> 78 kcal, 21c, 0.45p, 0.3f
            // meal_4: 100g (ratio 1.0 of 500kcal) -> 500 kcal, 40c, 35p, 20f
            // Total kcal = 370 + 625 + 78 + 500 = 1573
            // Total carbs = 60 + 100 + 21 + 40 = 221
            // Total pro = 13 + 50 + 0.45 + 35 = 98.45 -> rounded 98.5
            // Total fat = 7 + 5 + 0.3 + 20 = 32.3
            expect(day.kcal).toBe(1573);
            expect(day.carbs).toBe(221);
            expect(day.pro).toBe(98.5);
            expect(day.fat).toBe(32.3);
        });
    });

    describe('3. Edge Cases, Missing Fields, Null/Undefined, and Malformed Payload Resistance', () => {
        it('safely handles nulls, undefined, and non-array items inside array collections', () => {
            const cloudWithNulls = [
                null,
                { id: '1', name: 'Item 1' },
                undefined,
                { id: '', name: 'No ID Item' },
                { id: '2', name: 'Item 2' }
            ] as any;

            const guestWithNulls = [
                undefined,
                { id: '2', name: 'Item 2 Guest' },
                null,
                { id: '3', name: 'Item 3 Guest' }
            ] as any;

            const merged = mergeArrayById(cloudWithNulls, guestWithNulls);
            expect(merged.length).toBeGreaterThanOrEqual(3);
            expect(merged.find(x => x && x.id === '2')?.name).toBe('Item 2 Guest');
            expect(merged.find(x => x && x.id === '1')?.name).toBe('Item 1');
            expect(merged.find(x => x && x.id === '3')?.name).toBe('Item 3 Guest');
        });

        it('safely handles meal items with zero baseQty, negative baseQty, or string quantities during nutrition merge', () => {
            const cloudDay = {
                date: '2026-08-16',
                kcal: 0,
                carbs: 0,
                pro: 0,
                fat: 0,
                meals: [
                    { id: 'm1', name: 'Zero Base Food', quantity: 100, baseQty: 0, kcal: 100, carbs: 10, pro: 10, fat: 0 },
                    { id: 'm2', name: 'Negative Base Food', quantity: 50, baseQty: -100, kcal: 200, carbs: 20, pro: 20, fat: 0 },
                    { id: 'm3', name: 'String Val Food', quantity: '150' as any, baseQty: '100' as any, kcal: '100' as any, carbs: '10' as any, pro: '5' as any, fat: '2' as any }
                ]
            };

            const guestDay = {
                date: '2026-08-16',
                kcal: 0,
                carbs: 0,
                pro: 0,
                fat: 0,
                meals: [
                    { id: 'm4', name: 'Guest Food', quantity: 100, baseQty: 100, kcal: 150, carbs: 15, pro: 10, fat: 5 }
                ]
            };

            // 1. Direct mergeNutrition on colliding date
            const mergedColliding = mergeNutrition({ '2026-08-16': cloudDay as any }, { '2026-08-16': guestDay as any });
            const dayColliding = mergedColliding['2026-08-16'];
            expect(dayColliding).toBeDefined();
            expect(Number.isFinite(dayColliding.kcal)).toBe(true);
            expect(Number.isFinite(dayColliding.carbs)).toBe(true);
            expect(Number.isFinite(dayColliding.pro)).toBe(true);
            expect(Number.isFinite(dayColliding.fat)).toBe(true);
            expect(dayColliding.kcal).toBeGreaterThan(0);

            // 2. mergeUserData with one-sided date without kcal property passes schema sanitization
            const cloudWithoutKcal = {
                nutrition: {
                    '2026-08-17': {
                        date: '2026-08-17',
                        meals: [{ id: 'm_lone', name: 'Lone Meal', quantity: 100, kcal: 200, carbs: 20, pro: 10, fat: 5 }]
                    } as any
                }
            };
            const sanitizedResult = mergeUserData(cloudWithoutKcal, {});
            expect(sanitizedResult.nutrition['2026-08-17']).toBeDefined();
            expect(Number.isFinite(sanitizedResult.nutrition['2026-08-17'].kcal)).toBe(true);
            expect(sanitizedResult.nutrition['2026-08-17'].kcal).toBe(0);
        });

        it('merges profile with empty strings, nulls, and undefined without obliterating valid cloud data', () => {
            const cloudProfile = {
                dob: '1995-05-15',
                height: '182',
                gender: 'M',
                neck: '41',
                waist: '86',
                hip: '98',
                chest: '108',
                shoulders: '124',
                biceps: '39',
                thighs: '60',
                calves: '38'
            };

            const guestProfile = {
                dob: undefined,
                height: null as any,
                gender: '', // empty string should NOT overwrite 'M'
                neck: '42', // updated
                waist: '', // empty string should NOT overwrite '86'
                biceps: '40', // updated
            };

            const merged = mergeProfile(cloudProfile, guestProfile);
            expect(merged.dob).toBe('1995-05-15');
            expect(merged.height).toBe('182');
            expect(merged.gender).toBe('M');
            expect(merged.neck).toBe('42');
            expect(merged.waist).toBe('86');
            expect(merged.biceps).toBe('40');
            expect(merged.chest).toBe('108');
        });

        it('survives malformed UserData inputs and schema parsing sanitizes to valid structures', () => {
            const malformedCloud = {
                profile: { height: 180 as any },
                library: [{ id: 'ex1', name: 12345 as any, setsCount: 'three' as any }],
                routines: [{ id: 'r1', name: 'Routine 1', exercises: [{ exId: 'ex1', setsCount: -5 }] }],
                history: [{ id: 'h1', moodRating: 'invalid' as any, waterLiters: '2.5' as any }],
                nutrition: {
                    '2026-08-16': {
                        date: '2026-08-16',
                        kcal: 'not-num' as any,
                        carbs: NaN,
                        meals: [{ id: 'm1', name: 'Test', quantity: 'invalid' as any, kcal: 'abc' as any }]
                    }
                },
                customFoods: [{ name: 'Bad Food', kcal: NaN, pro: 'twenty' as any }],
                activeWorkout: { id: 'w1', moodRating: 'bad' as any },
                trainingCycles: [{ id: 'c1', name: 'Cycle', durationWeeks: 'four' as any }],
                supplements: [{ id: 's1', name: 'Supp', target: 'none' as any }]
            } as any;

            const malformedGuest = {
                profile: { waist: 82 as any },
                nutritionPlanning: {
                    weight: 'eighty' as any,
                    normocalorica: { kcal: 'two-thousand' as any }
                }
            } as any;

            // mergeUserData should run schema validation and sanitize everything cleanly without throwing
            const result = mergeUserData(malformedCloud, malformedGuest);
            expect(result).toBeDefined();
            expect(result.library).toHaveLength(1);
            expect(typeof result.library[0].name).toBe('string');
            expect(result.history).toHaveLength(1);
            expect(result.history[0].waterLiters).toBe(2.5); // string '2.5' converted to number
            expect(result.nutrition['2026-08-16']).toBeDefined();
            expect(Number.isFinite(result.nutrition['2026-08-16'].kcal)).toBe(true);
        });

        it('resists prototype pollution and malicious property injection', () => {
            const maliciousPayload = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"prototype": {"injected": "yes"}}}');
            const guestData: UserData = {
                profile: maliciousPayload,
                library: [{ id: 'ex_safe', name: 'Safe Ex', setsCount: 3, sets: [] }]
            };

            const merged = mergeUserData({}, guestData);
            expect((Object.prototype as any).polluted).toBeUndefined();
            expect((Object.prototype as any).injected).toBeUndefined();
            expect(merged.library[0].id).toBe('ex_safe');
        });
    });

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
                nutritionPlanning: { weight: 75, carbsPerKg: 3.0, proPerKg: 2.0, fatPerKg: 1.0 }
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
                nutritionPlanning: { weight: 78, carbsPerKg: 3.5, normocalorica: { kcal: 2600, carbs: 300, pro: 170, fat: 70 } }
            };

            const merged1 = mergeUserData(cloudData, guestData);
            const merged2 = mergeUserData(merged1, merged1);
            const merged3 = mergeUserData(merged1, guestData);

            expect(merged2).toEqual(merged1);
            expect(merged3).toEqual(merged1);
        });

        it('deeply merges nutritionPlanning partials (normocalorica, avgMacros, onBoost, offMacros)', () => {
            const cloudPlan = {
                weight: 70,
                carbsPerKg: 3.0,
                proPerKg: 2.0,
                fatPerKg: 1.0,
                avgMacros: { carbsPerKg: 3.0, proPerKg: 2.0, fatPerKg: 1.0 },
                onBoost: { carbsPercent: 10, proPercent: 0, fatPercent: 0 },
                onMacros: { carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 },
                offMacros: { carbsPerKg: 2.5, proPerKg: 2.0, fatPerKg: 1.0 },
                normocalorica: { kcal: 2200, carbs: 250, pro: 150, fat: 60 }
            };

            const guestPlan = {
                weight: 75,
                carbsPerKg: 3.5,
                avgMacros: { carbsPerKg: 3.5, proPerKg: 2.2, fatPerKg: 0.9 },
                onBoost: { carbsPercent: 15, proPercent: 5, fatPercent: -5 },
                normocalorica: { kcal: 2500, carbs: 300 }
            };

            const merged = mergeNutritionPlanning(cloudPlan, guestPlan);
            expect(merged?.weight).toBe(75);
            expect(merged?.carbsPerKg).toBe(3.5);
            expect(merged?.proPerKg).toBe(2.0); // cloud preserved
            expect(merged?.avgMacros?.carbsPerKg).toBe(3.5); // guest
            expect(merged?.avgMacros?.proPerKg).toBe(2.2); // guest
            expect(merged?.onBoost?.carbsPercent).toBe(15); // guest
            expect(merged?.onMacros?.carbsPerKg).toBe(3.5); // cloud preserved
            expect(merged?.offMacros?.carbsPerKg).toBe(2.5); // cloud preserved
            expect(merged?.normocalorica?.kcal).toBe(2500); // guest
            expect(merged?.normocalorica?.carbs).toBe(300); // guest
            expect(merged?.normocalorica?.pro).toBe(150); // cloud preserved
            expect(merged?.normocalorica?.fat).toBe(60); // cloud preserved
        });
    });

    describe('5. Large Scale Dataset Merge (Volume, Performance & Memory Stress)', () => {
        it('merges large scale datasets in sub-second execution time (< 350ms)', () => {
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
                const dateKey = `2026-01-${String((i % 28) + 1).padStart(2, '0')}-${Math.floor(i / 28)}`;
                cloudNutrition[dateKey] = {
                    date: dateKey,
                    kcal: 2000 + i,
                    carbs: 200,
                    pro: 150,
                    fat: 60,
                    meals: [{ id: `meal_c_${i}`, name: `Cloud Meal ${i}`, meal: 'pranzo', quantity: 100, baseQty: 100, kcal: 300, carbs: 30, pro: 20, fat: 5 }]
                };
                const guestDateKey = i < 30 ? dateKey : `2026-06-${String((i % 28) + 1).padStart(2, '0')}-${Math.floor(i / 28)}`;
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
                profile: { height: '180', weight: 80 },
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
                profile: { height: '182', weight: 82 },
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

            const startTime = performance.now();
            const merged = mergeUserData(cloudData, guestData);
            const durationMs = performance.now() - startTime;

            console.log(`[PERFORMANCE STRESS] Large merge duration: ${durationMs.toFixed(2)}ms across ${ITEM_COUNT * 2} items/collection`);

            // Assertions
            expect(durationMs).toBeLessThan(1500); // Must be fast and efficient even under parallel load
            expect(merged.library).toHaveLength(90); // 60 + 60 - 30 collisions = 90
            expect(merged.routines).toHaveLength(90);
            expect(merged.customFoods).toHaveLength(90);
            expect(merged.trainingCycles).toHaveLength(90);
            expect(merged.history).toHaveLength(90);
            expect(merged.supplements).toHaveLength(90);
            expect(merged.activeWorkout?.id).toBe('w_active_large');
            expect(merged.profile?.height).toBe('182');
            expect(merged.profile?.weight).toBe(82);
        });
    });
});
