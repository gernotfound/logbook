import { describe, it, expect } from 'vitest';
import { mergeNutrition, mergeProfile, mergeNutritionPlanning } from '../../../src/lib/merge';

describe('Deterministic Guest Merge (R5) Suite', () => {
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
                avgMacros: { carbsPerKg: 3.0, proPerKg: 2.0, fatPerKg: 1.0 },
                normocalorica: { kcal: 2400, carbs: 280, pro: 160, fat: 65 }
            };
            const guestPlan = {
                weight: 80,
                avgMacros: { carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 },
                normocalorica: { kcal: 2600, carbs: 320 }
            };

            const mergedResult = mergeNutritionPlanning(cloudPlan, guestPlan, 'user-edited', 'user-edited');
            const merged = mergedResult.activePlan;
            // Since it's user-edited + user-edited differing, cloud wins actively (Policy case 5)
            expect(merged?.weight).toBe(75);
            expect(merged?.avgMacros?.carbsPerKg).toBe(3.0);
            expect(merged?.normocalorica?.kcal).toBe(2400);
            // Guest is saved in pendingConflict
            expect(mergedResult.pendingConflict?.weight).toBe(80);
        });

        it('handles null plans and treats missing provenance conservatively', () => {
            expect(mergeNutritionPlanning(null, null).activePlan).toBeUndefined();
            const plan = { weight: 70, avgMacros: { carbsPerKg: 3.0, proPerKg: 2.0, fatPerKg: 1.0 } };
            expect(mergeNutritionPlanning(plan, null, 'user-edited', 'generated-default').activePlan).toEqual(plan);
            expect(mergeNutritionPlanning(null, plan, 'generated-default', 'user-edited').activePlan).toEqual(plan);
            expect(mergeNutritionPlanning(null, plan).activeOrigin).toBe('user-edited');
            expect(mergeNutritionPlanning(plan, null).activeOrigin).toBe('user-edited');
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

});
