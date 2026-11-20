import { describe, it, expect } from 'vitest';
import { mergeArrayById, mergeNutrition } from '../../../src/lib/merge';
import type { NutritionDay, WorkoutSession, WorkoutRoutine, TrainingCycle } from '../../../src/types';

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
            const cloudRoutines: WorkoutRoutine[] = [
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

            const guestRoutines: WorkoutRoutine[] = [
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
            const cloudCycles: TrainingCycle[] = [
                {
                    id: 'cycle_1',
                    name: 'Cloud Meso 1',
                    durationWeeks: 4,
                    progressionMode: 'fixed' as const,
                    routines: [{ routineId: 'r_push', frequencyPerWeek: 2 }]
                }
            ];

            const guestCycles: TrainingCycle[] = [
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
                                    segments: [
                                        { technique: 'dropset' as const, id: 'd1', kg: '80', reps: '8' },
                                        { technique: 'isometry' as const, reps: '', id: 'i1', kg: '60', time: '10' }
                                    ],
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
            expect(s1?.exercises[0].sets[0].segments?.filter(segment => segment.technique === 'dropset')).toHaveLength(1);
            expect(s1?.exercises[0].sets[0].segments?.filter(segment => segment.technique === 'isometry')).toHaveLength(1);
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

});
