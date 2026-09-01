import { describe, it, expect } from 'vitest';
import {
    mergeUserData,
    hasUserData,
    mergeArrayById,
    mergeNutrition,
    mergeProfile,
    mergeNutritionPlanning,
    filterCustomExercises,
    filterCustomFoods
} from '../src/lib/merge';
import { getSeedCatalog } from '../src/lib/catalog/catalogService';
import type { UserData, Exercise, Food } from '../src/types';

describe('Deterministic Guest Merge (R5) Suite', () => {
    describe('filterCustomExercises & filterCustomFoods helpers', () => {
        it('filters out standard seed catalog exercises and preserves user custom exercises', () => {
            const seed = getSeedCatalog();
            const standardEx = seed.exercises[0]; // e.g. panca-piana-bilanciere
            const customEx1: Exercise = { id: 'custom_ex_1', name: 'Custom Fly', setsCount: 3, sets: [], isDefault: false };
            const customEx2: Exercise = { id: 'custom_ex_2', name: 'Another Custom', setsCount: 4, sets: [] };

            const filtered = filterCustomExercises([standardEx, customEx1, customEx2]);
            expect(filtered).toHaveLength(2);
            expect(filtered.map(e => e.id)).toEqual(['custom_ex_1', 'custom_ex_2']);
        });

        it('filters out standard seed catalog foods and preserves user custom foods', () => {
            const seed = getSeedCatalog();
            const standardFood = seed.foods[0]; // e.g. petto-di-pollo-crudo
            const customFood1: Food = { id: 'custom_food_1', name: 'Custom Shake', kcal: 250, pro: 30, carbs: 10, fat: 5, isCustom: true };
            const customFood2: Food = { id: 'custom_food_2', name: 'Custom Oats', kcal: 350, pro: 12, carbs: 60, fat: 7 };

            const filtered = filterCustomFoods([standardFood, customFood1, customFood2]);
            expect(filtered).toHaveLength(2);
            expect(filtered.map(f => f.id)).toEqual(['custom_food_1', 'custom_food_2']);
        });
    });

    describe('hasUserData utility', () => {
        it('returns false for null, undefined, or empty objects', () => {
            expect(hasUserData(null)).toBe(false);
            expect(hasUserData(undefined)).toBe(false);
            expect(hasUserData({})).toBe(false);
            expect(hasUserData({ library: [], routines: [], history: [], nutrition: {}, customFoods: [], supplements: [], trainingCycles: [] })).toBe(false);
        });

        it('returns false for pristine state containing only standard seed catalog items', () => {
            const seed = getSeedCatalog();
            expect(hasUserData({
                library: seed.exercises,
                customFoods: seed.foods,
                catalogOverrides: { exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }
            })).toBe(false);
        });

        it('returns true if catalogOverrides contains any modification or hidden item', () => {
            expect(hasUserData({ catalogOverrides: { exercises: { 'panca-piana-bilanciere': { notes: 'Pausa' } } } })).toBe(true);
            expect(hasUserData({ catalogOverrides: { foods: { 'petto-di-pollo-crudo': { pro: 25 } } } })).toBe(true);
            expect(hasUserData({ catalogOverrides: { hiddenExerciseIds: ['panca-declinata-bilanciere'] } })).toBe(true);
            expect(hasUserData({ catalogOverrides: { hiddenFoodIds: ['petto-di-tacchino-crudo'] } })).toBe(true);
        });

        it('returns true if any collection or profile has user data', () => {
            expect(hasUserData({ library: [{ id: 'ex1', name: 'Bench', setsCount: 3, sets: [] }] })).toBe(true);
            expect(hasUserData({ routines: [{ id: 'r1', name: 'Push', exercises: [] }] })).toBe(true);
            expect(hasUserData({ history: [{ id: 'h1', exercises: [] }] })).toBe(true);
            expect(hasUserData({ customFoods: [{ id: 'f1', name: 'Oats', kcal: 370, pro: 13, carbs: 60, fat: 7 }] })).toBe(true);
            expect(hasUserData({ trainingCycles: [{ id: 'c1', name: 'Hypertrophy', durationWeeks: 8, routines: [] }] })).toBe(true);
            expect(hasUserData({ supplements: [{ id: 's1', name: 'Creatine', unit: 'g' }] })).toBe(true);
            expect(hasUserData({ nutrition: { '2026-08-16': { date: '2026-08-16', kcal: 2000, carbs: 200, pro: 150, fat: 60 } } })).toBe(true);
            expect(hasUserData({ activeWorkout: { exercises: [{ exId: 'ex1', sessionNote: '', sets: [] }] } })).toBe(true);
            expect(hasUserData({ profile: { height: '180' } })).toBe(true);
        });
    });

    describe('mergeArrayById helper', () => {
        it('handles null and undefined arrays gracefully', () => {
            expect(mergeArrayById(null, null)).toEqual([]);
            expect(mergeArrayById(undefined, [{ id: '1', name: 'A' }])).toEqual([{ id: '1', name: 'A' }]);
            expect(mergeArrayById([{ id: '1', name: 'A' }], undefined)).toEqual([{ id: '1', name: 'A' }]);
        });

        it('deduplicates by ID with guest priority and preserves disjoint items', () => {
            const cloud = [
                { id: '1', name: 'Cloud Item 1', val: 10 },
                { id: '2', name: 'Cloud Item 2', val: 20 }
            ];
            const guest = [
                { id: '2', name: 'Guest Item 2 Edited', val: 25 },
                { id: '3', name: 'Guest Item 3', val: 30 }
            ];

            const result = mergeArrayById(cloud, guest);
            expect(result).toHaveLength(3);
            expect(result.find(x => x.id === '1')).toEqual({ id: '1', name: 'Cloud Item 1', val: 10 });
            expect(result.find(x => x.id === '2')).toEqual({ id: '2', name: 'Guest Item 2 Edited', val: 25 });
            expect(result.find(x => x.id === '3')).toEqual({ id: '3', name: 'Guest Item 3', val: 30 });
        });

        it('normalizes string and number IDs to deduplicate correctly', () => {
            const cloud = [{ id: 100, name: 'Cloud Food' }];
            const guest = [{ id: '100', name: 'Guest Food Overwrite' }];

            const result = mergeArrayById(cloud, guest);
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Guest Food Overwrite');
        });
        it('preserves non-ID items from both arrays', () => {
            const cloud = [{ name: 'Cloud Item Without ID' } as any, { id: 'c1', name: 'Cloud 1' }];
            const guest = [{ name: 'Guest Item Without ID' } as any, { id: 'g1', name: 'Guest 1' }];

            const result = mergeArrayById(cloud, guest);
            expect(result).toHaveLength(4);
            expect(result.find(x => x.name === 'Cloud Item Without ID')).toBeDefined();
            expect(result.find(x => x.name === 'Guest Item Without ID')).toBeDefined();
            expect(result.find(x => x.id === 'c1')).toBeDefined();
            expect(result.find(x => x.id === 'g1')).toBeDefined();
        });
    });

    describe('mergeProfile & mergeNutritionPlanning helpers', () => {
        it('merges user profile fields non-destructively giving guest priority', () => {
            const cloudProfile = { height: '175', dob: '1990-01-01', gender: 'M', neck: '38' };
            const guestProfile = { height: '180', waist: '82', neck: '' }; // neck is empty, should keep cloud

            const merged = mergeProfile(cloudProfile, guestProfile);
            expect(merged.height).toBe('180'); // guest priority
            expect(merged.dob).toBe('1990-01-01'); // preserved from cloud
            expect(merged.gender).toBe('M'); // preserved from cloud
            expect(merged.neck).toBe('38'); // preserved from cloud because guest was empty string
            expect(merged.waist).toBe('82'); // added from guest
        });

        it('merges nutrition planning settings and preserves normocalorica targets', () => {
            const cloudPlan = {
                weight: 75,
                carbsPerKg: 3.0,
                proPerKg: 2.0,
                fatPerKg: 1.0,
                normocalorica: { kcal: 2400, carbs: 280, pro: 160, fat: 65 }
            };
            const guestPlan = {
                weight: 80,
                carbsPerKg: 3.5,
                normocalorica: { kcal: 2600, carbs: 320 }
            };

            const mergedResult = mergeNutritionPlanning(cloudPlan, guestPlan, 'user-edited', 'user-edited');
            const merged = mergedResult.activePlan;
            // Since it's user-edited + user-edited differing, cloud wins actively (Policy case 5)
            expect(merged?.weight).toBe(75);
            expect(merged?.carbsPerKg).toBe(3.0);
            expect(merged?.normocalorica?.kcal).toBe(2400);
            // Guest is saved in pendingConflict
            expect(mergedResult.pendingConflict?.weight).toBe(80);
        });

        it('handles null/undefined nutrition planning inputs safely', () => {
            expect(mergeNutritionPlanning(null, null).activePlan).toBeUndefined();
            const plan = { weight: 70, carbsPerKg: 3.0, proPerKg: 2.0, fatPerKg: 1.0 };
            expect(mergeNutritionPlanning(plan, null, 'user-edited', 'generated-default').activePlan).toEqual(plan);
            expect(mergeNutritionPlanning(null, plan, 'generated-default', 'user-edited').activePlan).toEqual(plan);
        });
    });

    describe('mergeNutrition record helper', () => {
        it('preserves disjoint dates from both cloud and guest', () => {
            const cloudNut = {
                '2026-08-01': { date: '2026-08-01', kcal: 2000, carbs: 200, pro: 150, fat: 60, meals: [], supplementsIntake: [] }
            };
            const guestNut = {
                '2026-08-02': { date: '2026-08-02', kcal: 2200, carbs: 220, pro: 160, fat: 70, meals: [], supplementsIntake: [] }
            };

            const merged = mergeNutrition(cloudNut, guestNut);
            expect(Object.keys(merged)).toHaveLength(2);
            expect(merged['2026-08-01'].kcal).toBe(2000);
            expect(merged['2026-08-02'].kcal).toBe(2200);
        });

        it('merges matching dates: combines meals and supplementsIntake, recalculates macros, and merges measurements', () => {
            const cloudDay = {
                date: '2026-08-15',
                kcal: 500,
                carbs: 50,
                pro: 30,
                fat: 10,
                weight: '78.5',
                neck: '38',
                meals: [
                    { id: 'm1', name: 'Breakfast Oats', meal: 'colazione', quantity: 100, kcal: 370, carbs: 60, pro: 13, fat: 7 }
                ],
                supplementsIntake: [
                    { id: 'si1', supplementId: 's1', amount: 5, time: 1000 }
                ]
            };

            const guestDay = {
                date: '2026-08-15',
                kcal: 400,
                carbs: 40,
                pro: 25,
                fat: 12,
                weight: '78.2', // updated weight
                waist: '81', // new measurement
                meals: [
                    { id: 'm1', name: 'Breakfast Oats (Bigger)', meal: 'colazione', quantity: 100, kcal: 450, carbs: 70, pro: 15, fat: 8 }, // collision on m1: guest wins
                    { id: 'm2', name: 'Lunch Chicken & Rice', meal: 'pranzo', quantity: 100, kcal: 600, carbs: 80, pro: 45, fat: 10 } // new meal
                ],
                supplementsIntake: [
                    { id: 'si2', supplementId: 's2', amount: 30, time: 2000 }
                ]
            };

            const merged = mergeNutrition({ '2026-08-15': cloudDay }, { '2026-08-15': guestDay });
            const day = merged['2026-08-15'];

            expect(day).toBeDefined();
            // Measurements
            expect(day.weight).toBe('78.2'); // guest prioritized
            expect(day.neck).toBe('38'); // cloud preserved
            expect(day.waist).toBe('81'); // guest added

            // Meals merged by ID
            expect(day.meals).toHaveLength(2);
            expect(day.meals?.find(m => m.id === 'm1')?.name).toBe('Breakfast Oats (Bigger)');
            expect(day.meals?.find(m => m.id === 'm2')?.name).toBe('Lunch Chicken & Rice');

            // Recalculated macros from combined meals (450 + 600 = 1050 kcal)
            expect(day.kcal).toBe(1050);
            expect(day.carbs).toBe(150);
            expect(day.pro).toBe(60);
            expect(day.fat).toBe(18);

            // Supplements intake merged
            expect(day.supplementsIntake).toHaveLength(2);
            expect(day.supplementsIntake?.find(s => s.id === 'si1')).toBeDefined();
            expect(day.supplementsIntake?.find(s => s.id === 'si2')).toBeDefined();
        });

        it('accurately calculates meal macros with custom baseQty ratios and decimal rounding', () => {
            const cloudDay = {
                date: '2026-08-16',
                meals: [
                    // quantity 200g of baseQty 100g -> ratio 2.0 (100kcal * 2 = 200)
                    { id: 'm1', name: 'Double Portion Rice', quantity: 200, baseQty: 100, kcal: 100, carbs: 22.2, pro: 3.3, fat: 1.1 }
                ]
            };
            const guestDay = {
                date: '2026-08-16',
                meals: [
                    // quantity 50g of baseQty 100g -> ratio 0.5 (100kcal * 0.5 = 50)
                    { id: 'm2', name: 'Half Portion Tuna', quantity: 50, baseQty: 100, kcal: 100, carbs: 0, pro: 20, fat: 2 }
                ]
            };

            const merged = mergeNutrition({ '2026-08-16': cloudDay as any }, { '2026-08-16': guestDay as any });
            const day = merged['2026-08-16'];

            expect(day.kcal).toBe(250); // 200 + 50
            expect(day.carbs).toBe(44.4); // 44.4 + 0
            expect(day.pro).toBe(16.6); // 6.6 + 10 = 16.6
            expect(day.fat).toBe(3.2); // 2.2 + 1 = 3.2
        });

        it('preserves all body measurement fields across matching dates', () => {
            const cloudDay = {
                date: '2026-08-17',
                weight: '75',
                bf: '15',
                neck: '38',
                waist: '82',
                hip: '95',
                chest: '100',
                shoulders: '120',
                biceps: '36',
                thighs: '55',
                calves: '37',
                measurementTime: '08:00',
                isDayOn: true
            };
            const guestDay = {
                date: '2026-08-17',
                weight: '74.5',
                waist: '80',
                biceps: '36.5',
                measurementTime: '07:30',
                isDayOn: false
            };

            const merged = mergeNutrition({ '2026-08-17': cloudDay as any }, { '2026-08-17': guestDay as any });
            const day = merged['2026-08-17'];

            expect(day.weight).toBe('74.5'); // guest
            expect(day.bf).toBe('15'); // cloud preserved
            expect(day.neck).toBe('38'); // cloud preserved
            expect(day.waist).toBe('80'); // guest
            expect(day.hip).toBe('95'); // cloud preserved
            expect(day.chest).toBe('100'); // cloud preserved
            expect(day.shoulders).toBe('120'); // cloud preserved
            expect(day.biceps).toBe('36.5'); // guest
            expect(day.thighs).toBe('55'); // cloud preserved
            expect(day.calves).toBe('37'); // cloud preserved
            expect(day.measurementTime).toBe('07:30'); // guest
            expect(day.isDayOn).toBe(false); // guest
        });

        it('merges sleep metrics (sleepHours, sleepDeep, sleepLight, sleepRem, sleepAwake) deterministically across matching dates', () => {
            const cloudDay = {
                date: '2026-08-20',
                kcal: 2000,
                carbs: 200,
                pro: 150,
                fat: 50,
                sleepHours: '07:00',
                sleepDeep: '01:30',
                sleepAwake: '00:20'
            };
            const guestDay = {
                date: '2026-08-20',
                sleepHours: '08:30', // guest overwrites cloud
                sleepLight: '04:30', // guest adds new phase
                sleepRem: '01:30',   // guest adds new phase
                sleepAwake: ''       // guest empty string, should preserve cloud
            };

            const merged = mergeNutrition({ '2026-08-20': cloudDay as any }, { '2026-08-20': guestDay as any });
            const day = merged['2026-08-20'];

            expect(day).toBeDefined();
            expect(day.sleepHours).toBe('08:30'); // guest priority
            expect(day.sleepDeep).toBe('01:30');  // cloud preserved
            expect(day.sleepLight).toBe('04:30'); // guest added
            expect(day.sleepRem).toBe('01:30');   // guest added
            expect(day.sleepAwake).toBe('00:20'); // cloud preserved because guest was empty string
        });
    });

    describe('mergeUserData full pipeline', () => {
        it('returns sanitized default data when both inputs are null or empty', () => {
            const merged = mergeUserData(null, null);
            expect(merged).toBeDefined();
            expect(merged.library).toEqual([]);
            expect(merged.routines).toEqual([]);
            expect(merged.history).toEqual([]);
            expect(merged.customFoods).toEqual([]);
            expect(merged.trainingCycles).toEqual([]);
            expect(merged.supplements).toEqual([]);
            expect(merged.nutrition).toEqual({});
        });

        it('merges completely disjoint cloud and guest datasets without losing any collection data', () => {
            const cloudData: UserData = {
                library: [{ id: 'ex_c1', name: 'Cloud Bench', setsCount: 3, sets: [] }],
                routines: [{ id: 'r_c1', name: 'Cloud Routine', exercises: [] }],
                customFoods: [{ id: 'f_c1', name: 'Cloud Rice', kcal: 130, pro: 2.7, carbs: 28, fat: 0.3 }],
                trainingCycles: [{ id: 'tc_c1', name: 'Cloud Cycle', durationWeeks: 4, routines: [] }],
                history: [{ id: 'h_c1', date: '2026-08-01', exercises: [] }],
                supplements: [{ id: 's_c1', name: 'Cloud Whey', unit: 'g' }],
                activeCycleId: 'tc_c1',
                activeWorkout: null
            };

            const guestData: UserData = {
                library: [{ id: 'ex_g1', name: 'Guest Squat', setsCount: 4, sets: [] }],
                routines: [{ id: 'r_g1', name: 'Guest Routine', exercises: [] }],
                customFoods: [{ id: 'f_g1', name: 'Guest Chicken', kcal: 165, pro: 31, carbs: 0, fat: 3.6 }],
                trainingCycles: [{ id: 'tc_g1', name: 'Guest Cycle', durationWeeks: 6, routines: [] }],
                history: [{ id: 'h_g1', date: '2026-08-10', exercises: [] }],
                supplements: [{ id: 's_g1', name: 'Guest Creatine', unit: 'g' }],
                activeCycleId: 'tc_g1',
                activeWorkout: { id: 'w_active', exercises: [] }
            };

            const merged = mergeUserData(cloudData, guestData);

            expect(merged.library).toHaveLength(2);
            expect(merged.library?.map(e => e.id)).toEqual(expect.arrayContaining(['ex_c1', 'ex_g1']));

            expect(merged.routines).toHaveLength(2);
            expect(merged.routines?.map(r => r.id)).toEqual(expect.arrayContaining(['r_c1', 'r_g1']));

            expect(merged.customFoods).toHaveLength(2);
            expect(merged.customFoods?.map(f => f.id)).toEqual(expect.arrayContaining(['f_c1', 'f_g1']));

            expect(merged.trainingCycles).toHaveLength(2);
            expect(merged.trainingCycles?.map(c => c.id)).toEqual(expect.arrayContaining(['tc_c1', 'tc_g1']));

            expect(merged.history).toHaveLength(2);
            expect(merged.history?.map(h => h.id)).toEqual(expect.arrayContaining(['h_c1', 'h_g1']));

            expect(merged.supplements).toHaveLength(2);
            expect(merged.supplements?.map(s => s.id)).toEqual(expect.arrayContaining(['s_c1', 's_g1']));

            expect(merged.activeCycleId).toBe('tc_g1'); // guest prioritized
            expect(merged.activeWorkout?.id).toBe('w_active'); // guest prioritized
        });

        it('gives priority to guest on ID collisions across all collections while preserving non-colliding items', () => {
            const cloudData: UserData = {
                library: [
                    { id: 'ex1', name: 'Cloud Bench', setsCount: 3, sets: [] },
                    { id: 'ex2', name: 'Cloud Incline', setsCount: 3, sets: [] }
                ],
                routines: [
                    { id: 'r1', name: 'Cloud Push', exercises: [] },
                    { id: 'r2', name: 'Cloud Pull', exercises: [] }
                ],
                customFoods: [
                    { id: 'f1', name: 'Cloud Oats', kcal: 350, pro: 12, carbs: 60, fat: 6 },
                    { id: 'f2', name: 'Cloud Milk', kcal: 50, pro: 3.3, carbs: 4.8, fat: 1.5 }
                ],
                trainingCycles: [
                    { id: 'tc1', name: 'Cloud Hypertrophy', durationWeeks: 8, routines: [] },
                    { id: 'tc2', name: 'Cloud Strength', durationWeeks: 6, routines: [] }
                ],
                history: [
                    { id: 'h1', date: '2026-08-01', routineName: 'Cloud Session 1', exercises: [] },
                    { id: 'h2', date: '2026-08-02', routineName: 'Cloud Session 2', exercises: [] }
                ],
                supplements: [
                    { id: 's1', name: 'Cloud Creatine', unit: 'g', target: 3 },
                    { id: 's2', name: 'Cloud Glutamine', unit: 'g', target: 5 }
                ]
            };

            const guestData: UserData = {
                library: [
                    { id: 'ex1', name: 'Guest Bench Modified', setsCount: 4, sets: [] }, // collision
                    { id: 'ex3', name: 'Guest Shoulder Press', setsCount: 3, sets: [] } // new
                ],
                routines: [
                    { id: 'r1', name: 'Guest Push Modified', exercises: [] }, // collision
                    { id: 'r3', name: 'Guest Legs', exercises: [] } // new
                ],
                customFoods: [
                    { id: 'f1', name: 'Guest Oats Modified', kcal: 370, pro: 14, carbs: 58, fat: 7 }, // collision
                    { id: 'f3', name: 'Guest Eggs', kcal: 155, pro: 13, carbs: 1.1, fat: 11 } // new
                ],
                trainingCycles: [
                    { id: 'tc1', name: 'Guest Hypertrophy Modified', durationWeeks: 10, routines: [] }, // collision
                    { id: 'tc3', name: 'Guest Powerbuilding', durationWeeks: 12, routines: [] } // new
                ],
                history: [
                    { id: 'h1', date: '2026-08-01', routineName: 'Guest Session 1 Modified', exercises: [] }, // collision
                    { id: 'h3', date: '2026-08-03', routineName: 'Guest Session 3', exercises: [] } // new
                ],
                supplements: [
                    { id: 's1', name: 'Guest Creatine Creapure', unit: 'g', target: 5 }, // collision
                    { id: 's3', name: 'Guest Multivitamin', unit: 'cps', target: 1 } // new
                ]
            };

            const merged = mergeUserData(cloudData, guestData);

            // Library: ex1 (guest), ex2 (cloud), ex3 (guest)
            expect(merged.library).toHaveLength(3);
            expect(merged.library?.find(e => e.id === 'ex1')?.name).toBe('Guest Bench Modified');
            expect(merged.library?.find(e => e.id === 'ex2')?.name).toBe('Cloud Incline');
            expect(merged.library?.find(e => e.id === 'ex3')?.name).toBe('Guest Shoulder Press');

            // Routines: r1 (guest), r2 (cloud), r3 (guest)
            expect(merged.routines).toHaveLength(3);
            expect(merged.routines?.find(r => r.id === 'r1')?.name).toBe('Guest Push Modified');
            expect(merged.routines?.find(r => r.id === 'r2')?.name).toBe('Cloud Pull');
            expect(merged.routines?.find(r => r.id === 'r3')?.name).toBe('Guest Legs');

            // Custom Foods: f1 (guest), f2 (cloud), f3 (guest)
            expect(merged.customFoods).toHaveLength(3);
            expect(merged.customFoods?.find(f => f.id === 'f1')?.name).toBe('Guest Oats Modified');
            expect(merged.customFoods?.find(f => f.id === 'f2')?.name).toBe('Cloud Milk');
            expect(merged.customFoods?.find(f => f.id === 'f3')?.name).toBe('Guest Eggs');

            // Training Cycles: tc1 (guest), tc2 (cloud), tc3 (guest)
            expect(merged.trainingCycles).toHaveLength(3);
            expect(merged.trainingCycles?.find(c => c.id === 'tc1')?.name).toBe('Guest Hypertrophy Modified');
            expect(merged.trainingCycles?.find(c => c.id === 'tc2')?.name).toBe('Cloud Strength');
            expect(merged.trainingCycles?.find(c => c.id === 'tc3')?.name).toBe('Guest Powerbuilding');

            // History: h1 (guest), h2 (cloud), h3 (guest)
            expect(merged.history).toHaveLength(3);
            expect(merged.history?.find(h => h.id === 'h1')?.routineName).toBe('Guest Session 1 Modified');
            expect(merged.history?.find(h => h.id === 'h2')?.routineName).toBe('Cloud Session 2');
            expect(merged.history?.find(h => h.id === 'h3')?.routineName).toBe('Guest Session 3');

            // Supplements: s1 (guest), s2 (cloud), s3 (guest)
            expect(merged.supplements).toHaveLength(3);
            expect(merged.supplements?.find(s => s.id === 's1')?.name).toBe('Guest Creatine Creapure');
            expect(merged.supplements?.find(s => s.id === 's2')?.name).toBe('Cloud Glutamine');
            expect(merged.supplements?.find(s => s.id === 's3')?.name).toBe('Guest Multivitamin');
        });

        it('handles activeWorkout and activeCycleId fallbacks when guest values are null or empty string', () => {
            const cloudData: UserData = {
                activeCycleId: 'cloud_cycle_id',
                activeWorkout: { id: 'cloud_workout_id', exercises: [] }
            };

            // Guest with empty string activeCycleId and null activeWorkout
            const guestData1: UserData = {
                activeCycleId: '',
                activeWorkout: null
            };

            const merged1 = mergeUserData(cloudData, guestData1);
            expect(merged1.activeCycleId).toBe('cloud_cycle_id');
            expect(merged1.activeWorkout?.id).toBe('cloud_workout_id');

            // Guest with defined activeCycleId and activeWorkout
            const guestData2: UserData = {
                activeCycleId: 'guest_cycle_id',
                activeWorkout: { id: 'guest_workout_id', exercises: [] }
            };

            const merged2 = mergeUserData(cloudData, guestData2);
            expect(merged2.activeCycleId).toBe('guest_cycle_id');
            expect(merged2.activeWorkout?.id).toBe('guest_workout_id');
        });

        it('passes complete merged data through UserDataSchema validation without stripping valid fields', () => {
            const cloudData: UserData = {
                profile: { name: 'Cloud User', dob: '1990-01-01', height: '175', gender: 'M' },
                library: [{ id: 'ex1', name: 'Squat', targetMuscle: 'gambe', setsCount: 3, sets: [] }],
                routines: [{ id: 'r1', name: 'Leg Day', exercises: [{ exId: 'ex1', setsCount: 3 }] }],
                customFoods: [{ id: 'cf1', name: 'Oats', kcal: 370, pro: 13, carbs: 60, fat: 7 }],
                trainingCycles: [{ id: 'tc1', name: 'Mesociclo 1', durationWeeks: 4, routines: [{ routineId: 'r1', frequencyPerWeek: 2 }] }],
                supplements: [{ id: 's1', name: 'Creatine', unit: 'g', target: 5 }],
                history: [{ id: 'w1', date: '2026-08-01', routineName: 'Leg Day', exercises: [] }],
                nutrition: { '2026-08-01': { date: '2026-08-01', kcal: 2500, carbs: 300, pro: 150, fat: 70 } }
            };

            const guestData: UserData = {
                profile: { weight: 80, bodyFat: 14 },
                library: [{ id: 'ex2', name: 'Deadlift', targetMuscle: 'schiena', setsCount: 4, sets: [] }],
                routines: [{ id: 'r2', name: 'Back Day', exercises: [{ exId: 'ex2', setsCount: 4 }] }],
                customFoods: [{ id: 'cf2', name: 'Whey', kcal: 380, pro: 80, carbs: 4, fat: 3 }],
                trainingCycles: [{ id: 'tc2', name: 'Mesociclo 2', durationWeeks: 6, routines: [{ routineId: 'r2', frequencyPerWeek: 1 }] }],
                supplements: [{ id: 's2', name: 'Omega 3', unit: 'cps', target: 2 }],
                history: [{ id: 'w2', date: '2026-08-02', routineName: 'Back Day', exercises: [] }],
                nutrition: { '2026-08-02': { date: '2026-08-02', kcal: 2600, carbs: 320, pro: 160, fat: 65 } }
            };

            const result = mergeUserData(cloudData, guestData);

            expect(result.library).toHaveLength(2);
            expect(result.routines).toHaveLength(2);
            expect(result.customFoods).toHaveLength(2);
            expect(result.trainingCycles).toHaveLength(2);
            expect(result.supplements).toHaveLength(2);
            expect(result.history).toHaveLength(2);
            expect(Object.keys(result.nutrition || {})).toHaveLength(2);
            expect(result.profile?.name).toBe('Cloud User');
            expect(result.profile?.weight).toBe(80);
            expect(result.profile?.bodyFat).toBe(14);
        });

        it('filters out monolithic seed items from guest/cloud libraries and merges catalogOverrides without duplication', () => {
            const seed = getSeedCatalog();

            const cloudData: UserData = {
                profile: { name: 'Cloud User' },
                library: [
                    ...seed.exercises.slice(0, 10), // monolithic legacy slice
                    { id: 'cloud_custom_1', name: 'Cloud Special', setsCount: 3, sets: [], isDefault: false }
                ],
                customFoods: [
                    ...seed.foods.slice(0, 10), // monolithic legacy slice
                    { id: 'cloud_food_1', name: 'Cloud Protein', kcal: 200, pro: 30, carbs: 5, fat: 2, isCustom: true }
                ],
                catalogOverrides: {
                    exercises: { 'squat-bilanciere': { notes: 'Discesa lenta' } },
                    hiddenExerciseIds: ['leg-extension-macchina']
                }
            };

            const guestData: UserData = {
                profile: { weight: 75 },
                library: [
                    ...seed.exercises, // full resolved guest library
                    { id: 'guest_custom_1', name: 'Guest Special', setsCount: 4, sets: [], isDefault: false }
                ],
                customFoods: [
                    ...seed.foods, // full resolved guest foods
                    { id: 'guest_food_1', name: 'Guest Snack', kcal: 150, pro: 15, carbs: 10, fat: 3, isCustom: true }
                ],
                catalogOverrides: {
                    exercises: { 'panca-piana-bilanciere': { notes: 'Pausa 2s' } },
                    foods: { 'petto-di-pollo-crudo': { pro: 24 } },
                    hiddenExerciseIds: ['panca-declinata-bilanciere'],
                    hiddenFoodIds: ['petto-di-tacchino-crudo']
                }
            };

            const result = mergeUserData(cloudData, guestData);

            // Library and customFoods must contain strictly the 2 custom items, NOT 70+ seed duplicates!
            expect(result.library).toHaveLength(2);
            expect(result.library?.map(e => e.id)).toEqual(expect.arrayContaining(['cloud_custom_1', 'guest_custom_1']));

            expect(result.customFoods).toHaveLength(2);
            expect(result.customFoods?.map(f => f.id)).toEqual(expect.arrayContaining(['cloud_food_1', 'guest_food_1']));

            // Catalog overrides are fully preserved and combined
            expect(result.catalogOverrides?.exercises?.['squat-bilanciere']?.notes).toBe('Discesa lenta');
            expect(result.catalogOverrides?.exercises?.['panca-piana-bilanciere']?.notes).toBe('Pausa 2s');
            expect(result.catalogOverrides?.foods?.['petto-di-pollo-crudo']?.pro).toBe(24);
            expect(result.catalogOverrides?.hiddenExerciseIds).toEqual(expect.arrayContaining(['leg-extension-macchina', 'panca-declinata-bilanciere']));
            expect(result.catalogOverrides?.hiddenFoodIds).toEqual(expect.arrayContaining(['petto-di-tacchino-crudo']));
        });
    });
});

