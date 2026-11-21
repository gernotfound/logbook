import { describe, it, expect } from 'vitest';
import { mergeUserData } from '../../../src/lib/merge';
import { getSeedCatalog } from '../../../src/lib/catalog/catalogService';
import type { UserData } from '../../../src/types';
import { asUserExercises } from './guestMergeFixture';

describe('Deterministic Guest Merge (R5) Suite', () => {
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
                profile: { dob: '1990-01-01', height: '175', gender: 'M' },
                library: [{ id: 'ex1', name: 'Squat', setsCount: 3, sets: [] }],
                routines: [{ id: 'r1', name: 'Leg Day', exercises: [{ exId: 'ex1', setsCount: 3 }] }],
                customFoods: [{ id: 'cf1', name: 'Oats', kcal: 370, pro: 13, carbs: 60, fat: 7 }],
                trainingCycles: [{ id: 'tc1', name: 'Mesociclo 1', durationWeeks: 4, routines: [{ routineId: 'r1', frequencyPerWeek: 2 }] }],
                supplements: [{ id: 's1', name: 'Creatine', unit: 'g', target: 5 }],
                history: [{ id: 'w1', date: '2026-08-01', routineName: 'Leg Day', exercises: [] }],
                nutrition: { '2026-08-01': { date: '2026-08-01', kcal: 2500, carbs: 300, pro: 150, fat: 70 } }
            };

            const guestData: UserData = {
                profile: { waist: '80' },
                library: [{ id: 'ex2', name: 'Deadlift', setsCount: 4, sets: [] }],
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
            expect(result.profile?.height).toBe('175');
            expect(result.profile?.waist).toBe('80');
        });

        it('filters out monolithic seed items from guest/cloud libraries and merges catalogOverrides without duplication', () => {
            const seed = getSeedCatalog();

            const cloudData: UserData = {
                profile: { height: '170' },
                library: [
                    ...asUserExercises(seed.exercises.slice(0, 10)), // monolithic legacy slice
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
                profile: { waist: '75' },
                library: [
                    ...asUserExercises(seed.exercises), // full resolved guest library
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
    });});
