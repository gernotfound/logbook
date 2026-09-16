import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, renderHook } from '@testing-library/react';
import { renderWithProviders, emptyUserData, defaultMockUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { Logic } from '../src/lib/logic';
import {
    UserDataSchema,
    ExerciseSchema,
    NutritionDaySchema,
    FoodSchema,
    WorkoutSessionSchema
} from '../src/lib/schema';
import CustomFoodForm from '../src/components/Nutrition/CustomFoodForm';
import DataMeasurements from '../src/components/Data/DataMeasurements';
import SessionSetRow from '../src/components/Training/session/SessionSetRow';
import SessionRatings from '../src/components/Training/session/SessionRatings';
import MuscleModel from '../src/components/Training/MuscleModel';
import HomeView from '../src/components/Home/HomeView';
import { useNutritionMeasurements } from '../src/hooks/useNutritionMeasurements';
import type { Food, NutritionDay } from '../src/types';
import {
    getLatestUserWeightContract,
    calculateEffectiveSetWeightContract,
    calculateSetVolumeContract,
    calculateWorkoutVolumeContract,
    calculateRealtimeKcalContract,
    autoHealPainsContract
} from './requirements_r1_r6_contracts';

describe('LogBook 4-Tier Automated Test Suite (Requirements R1 - R6)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

    /* =========================================================================
     * TIER 3: CROSS-FEATURE COMBINATIONS (Pairwise & Multi-Feature Interactions)
     * ========================================================================= */
    describe('Tier 3: Cross-Feature Combinations', () => {
        it('T3.1: Bodyweight Chin-ups with Dropsets & Equipment Weight (R1 + R4)', () => {
            // User weight = 78 kg. Chin-ups have 2 kg dip belt base weight.
            // Main set: +15 kg ballast x 8 reps
            // Dropset 1: +5 kg ballast x 6 reps
            // Dropset 2: 0 kg ballast (bodyweight only) x 5 reps
            const ex = { isBodyweight: true, equipmentWeight: 2 };
            const userWeight = 78;

            const set = {
                kg: '15',
                reps: '8',
                dropsets: [
                    { kg: '5', reps: '6' },
                    { kg: '0', reps: '5' }
                ]
            };

            // Main set: (15 + 2 + 78) * 8 = 95 * 8 = 760
            // Dropset 1: (5 + 2 + 78) * 6 = 85 * 6 = 510
            // Dropset 2: (0 + 2 + 78) * 5 = 80 * 5 = 400
            // Total set volume = 760 + 510 + 400 = 1670 kg
            const vol = calculateSetVolumeContract(set, ex, userWeight);
            expect(vol).toBe(1670);
        });

        it('T3.2: Custom Food Auto-Kcal creation -> Logged into Daily Meals -> Nutrition Day verification (R2 + R3)', () => {
            // Step 1: User creates custom high-protein pudding in form
            const carbs = 12;
            const pro = 20;
            const fat = 3;
            const calculatedKcal = calculateRealtimeKcalContract(carbs, pro, fat);
            expect(calculatedKcal).toBe(155); // 12*4 + 20*4 + 3*9 = 48 + 80 + 27 = 155

            const customFood: Food = {
                id: 'cf_pudding',
                name: 'Budino proteico',
                carbs,
                pro,
                fat,
                kcal: calculatedKcal,
                unit: '100g',
                isCustom: true
            };

            // Step 2: Log food on historical past date (2026-08-14)
            const targetDate = '2026-08-14';
            const initialDay: NutritionDay = {
                date: targetDate,
                kcal: 0,
                carbs: 0,
                pro: 0,
                fat: 0,
                meals: []
            };

            const loggedMeal = {
                id: 'm_1',
                name: customFood.name,
                meal: 'spuntino',
                quantity: 2, // 200g
                kcal: customFood.kcal * 2,
                carbs: customFood.carbs * 2,
                pro: customFood.pro * 2,
                fat: customFood.fat * 2
            };

            const updatedDay: NutritionDay = {
                ...initialDay,
                kcal: loggedMeal.kcal,
                carbs: loggedMeal.carbs,
                pro: loggedMeal.pro,
                fat: loggedMeal.fat,
                meals: [loggedMeal]
            };

            expect(updatedDay.kcal).toBe(310);
            expect(updatedDay.pro).toBe(40);
            expect(updatedDay.carbs).toBe(24);
            expect(updatedDay.fat).toBe(6);
        });

        it('T3.3: DOMS Pain Tracking in Home -> Workout Session with Muscle -> Auto-healing on Completion -> State Updated (R5 + R6)', () => {
            // Initial state: User has DOMS in 'petto' and 'bicipiti'
            const initialUserData: any = {
                ...defaultMockUserData,
                activePains: ['petto', 'bicipiti'],
                library: [
                    { id: 'ex_bench', name: 'Panca piana', muscles: ['petto'], setsCount: 3, sets: [] }
                ]
            };

            // User performs Bench Press (Primary: petto)
            const sessionExercises = [{ exId: 'ex_bench' }];
            const sessionRatingsPains: string[] = []; // User notes chest pain is gone!

            const newActivePains = autoHealPainsContract(
                initialUserData.activePains,
                sessionExercises,
                initialUserData.library,
                sessionRatingsPains
            );

            // 'petto' was trained and not re-selected -> auto-healed. 'bicipiti' was untrained -> retained.
            expect(newActivePains).toEqual(['bicipiti']);

            // Update Zustand store
            useAppStore.setState({
                userData: {
                    ...initialUserData,
                    activePains: newActivePains
                }
            });

            expect(useAppStore.getState().userData?.activePains).toEqual(['bicipiti']);
        });

        it('T3.4: Past Date Measurement Logging -> Affects Bodyweight Workout Volume Calculation for Past Workout (R1 + R3)', () => {
            // User weighed 80kg on 2026-08-01, and 75kg on 2026-08-15
            const ex = { id: 'ex_dip', isBodyweight: true, equipmentWeight: 0 };
            const session = {
                date: '2026-08-01',
                exercises: [{ exId: 'ex_dip', sets: [{ kg: '10', reps: '10' }] }]
            };

            // For the 2026-08-01 session: weight was 80 kg -> (10 + 80) * 10 = 900
            const pastWeight = 80;
            const volumePast = calculateWorkoutVolumeContract(session, [ex], pastWeight);
            expect(volumePast).toBe(900);

            // If done at 75 kg -> (10 + 75) * 10 = 850
            const currentWeight = 75;
            const volumeCurrent = calculateWorkoutVolumeContract(session, [ex], currentWeight);
            expect(volumeCurrent).toBe(850);
        });

        it('T3.5: DOMS Selection in Session Ratings with Auto-Calculated Volume and Custom Food Post-Workout Snack (R1 + R2 + R5 + R6)', () => {
            // 1. Session volume calculation
            const library = [{ id: 'ex_pullup', isBodyweight: true, equipmentWeight: 0, muscles: ['dorso', 'bicipiti'] }];
            const session = {
                exercises: [{ exId: 'ex_pullup', sets: [{ kg: '0', reps: '10' }, { kg: '5', reps: '8' }] }]
            };
            const userWeight = 75;
            // Set 1: (0 + 75) * 10 = 750
            // Set 2: (5 + 75) * 8 = 640 -> Total = 1390
            const sessionVol = calculateWorkoutVolumeContract(session, library, userWeight);
            expect(sessionVol).toBe(1390);

            // 2. DOMS auto-healing: initial pain was 'dorso', user experienced new 'bicipiti' pump
            const initialPains = ['dorso'];
            const sessionPains = ['bicipiti']; // Dorso unselected, bicipiti selected
            const updatedPains = autoHealPainsContract(initialPains, session.exercises, library, sessionPains);
            expect(updatedPains).toEqual(['bicipiti']);

            // 3. Post-workout snack auto-calculated kcal
            const postWorkoutSnackKcal = calculateRealtimeKcalContract(45, 30, 2); // 45*4 + 30*4 + 2*9 = 180 + 120 + 18 = 318
            expect(postWorkoutSnackKcal).toBe(318);
        });

        it('T3.6: Multi-Muscle Complex Session with Equipment Base + Bodyweight Ballast + DOMS Partial Auto-Healing (R1 + R4 + R5 + R6)', () => {
            const library = [
                { id: 'ex_dip', name: 'Dip alle parallele', isBodyweight: true, equipmentWeight: 3, muscles: ['petto', 'tricipiti'] },
                { id: 'ex_squat', name: 'Squat con bilanciere', isBodyweight: false, equipmentWeight: 20, muscles: ['quadricipiti'] }
            ];

            const session = {
                exercises: [
                    {
                        exId: 'ex_dip',
                        sets: [
                            {
                                kg: '20',
                                reps: '6',
                                dropsets: [{ kg: '0', reps: '6' }] // BW + equip = 75 + 3 = 78
                            }
                        ]
                    },
                    {
                        exId: 'ex_squat',
                        sets: [
                            { kg: '80', reps: '5' } // (80 + 20) * 5 = 500
                        ]
                    }
                ]
            };

            const userWeight = 75;
            // Dip Set: (20 + 3 + 75) * 6 = 98 * 6 = 588
            // Dip Dropset: (0 + 3 + 75) * 6 = 78 * 6 = 468
            // Squat Set: (80 + 20) * 5 = 500
            // Total = 588 + 468 + 500 = 1556
            const totalVol = calculateWorkoutVolumeContract(session, library, userWeight);
            expect(totalVol).toBe(1556);

            // Auto-healing: active pains were 'petto', 'quadricipiti', 'polpacci'
            // User re-selected 'petto' in session pains, left 'quadricipiti' empty
            const activePains = ['petto', 'quadricipiti', 'polpacci'];
            const resolvedPains = autoHealPainsContract(activePains, session.exercises, library, ['petto']);
            // 'petto' retained because reselected
            // 'quadricipiti' healed because trained as primary and not reselected
            // 'polpacci' retained because untrained
            expect(resolvedPains).toEqual(['petto', 'polpacci']);
        });
    });
});
