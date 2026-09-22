import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defaultMockUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import type { NutritionDay } from '../src/types';
import {
    getLatestUserWeightContract,
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
     * TIER 4: REAL-WORLD WORKFLOWS (End-to-End User Scenarios)
     * ========================================================================= */
    describe('Tier 4: Real-World Workflows', () => {

        it('T4.1: Scenario 1 — "The Calisthenics & Weighted Street Workout Progression"', () => {
            // User starts session with weighted pull-ups and dips
            const library = [
                { id: 'c_pullup', name: 'Weighted Pull-Up', isBodyweight: true, equipmentWeight: 1.5, muscles: ['dorso', 'bicipiti'] },
                { id: 'c_dip', name: 'Weighted Dips', isBodyweight: true, equipmentWeight: 1.5, muscles: ['petto', 'tricipiti'] }
            ];

            const userWeight = 74.0;

            const session = {
                id: 'ws_cali_1',
                routineName: 'Street Workout Upper',
                date: '2026-08-20',
                exercises: [
                    {
                        exId: 'c_pullup',
                        sessionNote: 'Focus esplosivo',
                        sets: [
                            { id: 's1', kg: '15', reps: '6' }, // (15 + 1.5 + 74) * 6 = 90.5 * 6 = 543
                            { id: 's2', kg: '15', reps: '6' }, // 543
                            { id: 's3', kg: '10', reps: '8' }  // (10 + 1.5 + 74) * 8 = 85.5 * 8 = 684
                        ]
                    },
                    {
                        exId: 'c_dip',
                        sessionNote: 'Scendi fino a 90 gradi',
                        sets: [
                            { id: 's4', kg: '25', reps: '6' }, // (25 + 1.5 + 74) * 6 = 100.5 * 6 = 603
                            { id: 's5', kg: '20', reps: '8' }  // (20 + 1.5 + 74) * 8 = 95.5 * 8 = 764
                        ]
                    }
                ]
            };

            const totalVol = calculateWorkoutVolumeContract(session, library, userWeight);
            expect(totalVol).toBe(3137); // 543 + 543 + 684 + 603 + 764 = 3137

            // Session completion with ratings and sore triceps
            const activePainsBefore = ['spalle'];
            const sessionPains = ['tricipiti'];
            const activePainsAfter = autoHealPainsContract(activePainsBefore, session.exercises, library, sessionPains);
            expect(activePainsAfter).toContain('spalle');
            expect(activePainsAfter).toContain('tricipiti');
        });

        it('T4.2: Scenario 2 — "The Bodybuilder Meal Prep & Macro Auto-Balancing"', () => {
            // Athlete prepares 3 custom staples for the week:
            // 1. Pollo al forno (0g C, 31g P, 3.5g F)
            // 2. Riso Jasmine (79g C, 7g P, 0.5g F)
            // 3. Olio EVO (0g C, 0g P, 99.9g F)
            const chickenKcal = calculateRealtimeKcalContract(0, 31, 3.5); // 0 + 124 + 31.5 = 155.5 -> 156
            const riceKcal = calculateRealtimeKcalContract(79, 7, 0.5);   // 316 + 28 + 4.5 = 348.5 -> 349
            const oilKcal = calculateRealtimeKcalContract(0, 0, 99.9);    // 899.1 -> 899

            expect(chickenKcal).toBe(156);
            expect(riceKcal).toBe(349);
            expect(oilKcal).toBe(899);

            // Assemble lunch meal: 200g chicken (31g P, 3.5g F per 100g), 100g rice (79g C, 7g P, 0.5g F per 100g), 10g oil (99.9g F per 100g)
            const lunchCarbs = 79;
            const lunchPro = 31 * 2 + 7;
            const lunchFat = 3.5 * 2 + 0.5 + 99.9 * 0.1;
            const lunchKcal = calculateRealtimeKcalContract(lunchCarbs, lunchPro, lunchFat);

            expect(lunchCarbs).toBe(79);
            expect(lunchPro).toBe(69);
            expect(Math.round(lunchFat)).toBe(17); // 7 + 0.5 + 9.99 = 17.49 -> 17
            expect(lunchKcal).toBe(749); // 79*4 + 69*4 + 17.49*9 = 316 + 276 + 157.41 = 749.41 -> 749
        });

        it('T4.3: Scenario 3 — "Leg Day Recovery & DOMS Auto-Healing Life Cycle"', () => {
            // Day 1: User does heavy squats. Next day logs 'quadricipiti' DOMS in Home card.
            let userActivePains = ['quadricipiti'];
            const library = [
                { id: 'ex_squat', name: 'Squat', muscles: ['quadricipiti'] },
                { id: 'ex_bench', name: 'Panca Piana', muscles: ['petto'] }
            ];

            // Day 3: Upper body workout (Panca Piana). Session completes.
            const upperSession = [{ exId: 'ex_bench' }];
            userActivePains = autoHealPainsContract(userActivePains, upperSession, library, []);
            // Quadricipiti was not trained -> remains in pain
            expect(userActivePains).toEqual(['quadricipiti']);

            // Day 5: Legs workout again (Squat). Session completes with no pain re-selected.
            const legSession = [{ exId: 'ex_squat' }];
            userActivePains = autoHealPainsContract(userActivePains, legSession, library, []);
            // Quadricipiti was trained and not re-selected -> auto-healed!
            expect(userActivePains).toEqual([]);
        });

        it('T4.4: Scenario 4 — "Athlete Multi-Day Training, Recovery & Nutrition Integration"', () => {
            // Day 1 (Monday): Log morning measurements
            const monday = '2026-08-17';
            const initialNutrition: Record<string, NutritionDay> = {
                [monday]: {
                    date: monday,
                    weight: 76.5,
                    waist: 81.0,
                    neck: 38.0,
                    kcal: 2600,
                    carbs: 320,
                    pro: 170,
                    fat: 70
                }
            };

            useAppStore.setState({
                userData: {
                    ...defaultMockUserData,
                    nutrition: initialNutrition,
                    activePains: ['dorso']
                }
            });

            // Day 1 Workout: Back & Biceps (Dorso)
            const library = [
                { id: 'ex_row', isBodyweight: false, equipmentWeight: 0, muscles: ['dorso'] }
            ];
            const backSession = {
                exercises: [{ exId: 'ex_row', sets: [{ kg: '70', reps: '10' }] }]
            };

            const latestWeight = getLatestUserWeightContract(useAppStore.getState().userData?.nutrition);
            expect(latestWeight).toBe(76.5);

            const vol = calculateWorkoutVolumeContract(backSession, library, latestWeight);
            expect(vol).toBe(700);

            // Auto-heal 'dorso' on completion
            const resolvedPains = autoHealPainsContract(
                useAppStore.getState().userData?.activePains,
                backSession.exercises,
                library,
                []
            );
            expect(resolvedPains).toEqual([]);
        });

        it('T4.5: Scenario 5 — "Rehabilitation & Pain Recovery Tracking through Deload Week"', () => {
            // Athlete enters deload with shoulder and elbow fatigue
            let pains = ['spalle', 'tricipiti'];
            const library = [
                { id: 'ex_ohp', muscles: ['spalle'] },
                { id: 'ex_pushdown', muscles: ['tricipiti'] }
            ];

            // Deload Day 1: Light overhead press only
            pains = autoHealPainsContract(pains, [{ exId: 'ex_ohp' }], library, []);
            expect(pains).toEqual(['tricipiti']); // Shoulder recovered!

            // Deload Day 2: Light triceps extensions
            pains = autoHealPainsContract(pains, [{ exId: 'ex_pushdown' }], library, []);
            expect(pains).toEqual([]); // All recovered!
        });
    });
});
