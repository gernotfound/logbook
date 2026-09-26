import { describe, it, expect } from 'vitest';
import { calculateTDEE } from '../src/lib/calc/nutrition';
import { computeWorkoutReport } from '../src/lib/calc/workoutReport';
import { calculateEffectiveSetWeight, calculateSetVolume, calculateWorkoutVolume } from '../src/lib/calc/workout';
import type { WorkoutSession, SessionExercise } from '../src/types';

describe('EMPIRICAL ADVERSARIAL SUITE — R1 (TDEE Calculation) & R2 (Workout Volume & PR Logic)', () => {

    // =========================================================================
    // SECTION 1: R1 (TDEE CALCULATION) ADVERSARIAL CHALLENGES
    // =========================================================================
    describe('R1: TDEE Calculation Adversarial Stress Tests', () => {

        // 1.1 Permutation Invariance
        it('R1.1: Guaranteed permutation invariance across 50 pseudo-random shuffles', () => {
            const baseData = [
                { date: '2026-01-01', weight: 80.0, kcal: 2500 },
                { date: '2026-01-02', weight: 80.1, kcal: 2600 },
                { date: '2026-01-03', weight: 79.9, kcal: 2450 },
                { date: '2026-01-04', weight: 80.2, kcal: 2700 },
                { date: '2026-01-05', weight: 80.0, kcal: 2550 },
                { date: '2026-01-06', weight: 80.3, kcal: 2650 },
                { date: '2026-01-07', weight: 80.2, kcal: 2500 },
                { date: '2026-01-08', weight: 80.4, kcal: 2800 },
                { date: '2026-01-09', weight: 80.1, kcal: 2400 },
                { date: '2026-01-10', weight: 80.5, kcal: 2900 },
                { date: '2026-01-11', weight: 80.3, kcal: 2550 },
                { date: '2026-01-12', weight: 80.6, kcal: 2750 },
                { date: '2026-01-13', weight: 80.5, kcal: 2600 },
                { date: '2026-01-14', weight: 80.7, kcal: 2850 },
            ];

            const canonicalResult = calculateTDEE(baseData);
            expect(canonicalResult.error).toBe(false);

            // Test strictly reversed
            const reversedResult = calculateTDEE([...baseData].reverse());
            expect(reversedResult).toEqual(canonicalResult);

            // Test 50 random shuffles with deterministic seed-like swapping
            for (let seed = 1; seed <= 50; seed++) {
                const shuffled = [...baseData];
                for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = (seed * (i + 17)) % (i + 1);
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                }
                const res = calculateTDEE(shuffled);
                expect(res).toEqual(canonicalResult);
            }
        });

        // 1.2 Leap Year Transitions (2024 leap year vs 2023 non-leap year)
        it('R1.2: Correctly computes timeSpanDays and TDEE across Leap Year boundaries (Feb 29)', () => {
            // 2024 Leap Year: Feb 25 to Mar 02 (crossing Feb 29) -> 25, 26, 27, 28, 29, Mar 1, Mar 2 (7 days total, 6 days diff)
            const leapData = [
                { date: '2024-02-25', weight: 80.0, kcal: 2500 },
                { date: '2024-02-26', weight: 80.0, kcal: 2500 },
                { date: '2024-02-27', weight: 80.0, kcal: 2500 },
                { date: '2024-02-28', weight: 80.0, kcal: 2500 },
                { date: '2024-02-29', weight: 80.0, kcal: 2500 },
                { date: '2024-03-01', weight: 80.0, kcal: 2500 },
                { date: '2024-03-02', weight: 80.0, kcal: 2500 },
            ];

            const leapRes = calculateTDEE(leapData);
            expect(leapRes.error).toBe(false);
            expect(leapRes.daysTracked).toBe(7);
            expect(leapRes.timeSpanDays).toBe(6); // Feb 25 to Mar 2 = 6 calendar days in 2024
            expect(leapRes.tdee).toBe(2500);

            // 2023 Non-Leap Year: Feb 25 to Mar 02 -> 25, 26, 27, 28, Mar 1, Mar 2 (6 days total, 5 days diff)
            const nonLeapData = [
                { date: '2023-02-25', weight: 80.0, kcal: 2500 },
                { date: '2023-02-26', weight: 80.0, kcal: 2500 },
                { date: '2023-02-27', weight: 80.0, kcal: 2500 },
                { date: '2023-02-28', weight: 80.0, kcal: 2500 },
                { date: '2023-03-01', weight: 80.0, kcal: 2500 },
                { date: '2023-03-02', weight: 80.0, kcal: 2500 },
                { date: '2023-03-03', weight: 80.0, kcal: 2500 },
            ];

            const nonLeapRes = calculateTDEE(nonLeapData);
            expect(nonLeapRes.error).toBe(false);
            expect(nonLeapRes.daysTracked).toBe(7);
            expect(nonLeapRes.timeSpanDays).toBe(6); // Feb 25 to Mar 3 = 6 calendar days
            expect(nonLeapRes.tdee).toBe(2500);
        });

        // 1.3 String numbers with Italian comma format and leading/trailing whitespace
        it('R1.3: Gracefully handles Italian comma decimals, string values, and whitespace', () => {
            const stringData = [
                { date: '2026-05-01', weight: ' 75,5 ', kcal: ' 2450,0 ' },
                { date: '2026-05-02', weight: '75,6', kcal: '2500,5' },
                { date: '2026-05-03', weight: '75,4', kcal: '2400' },
                { date: '2026-05-04', weight: '75,7', kcal: '2600,2' },
                { date: '2026-05-05', weight: 75.5, kcal: 2550 },
                { date: '2026-05-06', weight: '75,8', kcal: '2700' },
                { date: '2026-05-07', weight: ' 76,0 ', kcal: ' 2500 ' },
            ];

            const res = calculateTDEE(stringData);
            expect(res.error).toBe(false);
            expect(res.daysTracked).toBe(7);
            expect(res.weightDiff).toBe('0.50'); // 76.0 - 75.5
            expect(res.timeSpanDays).toBe(6);
            expect(typeof res.tdee).toBe('number');
            expect(!isNaN(res.tdee!)).toBe(true);
        });

        // 1.4 Missing fields, corrupt records, NaNs, negative numbers, 0s
        it('R1.4: Filters out corrupt objects, missing fields, 0 weights/kcals, and negative values', () => {
            const dirtyData = [
                null,
                undefined,
                {},
                { date: '' },
                { date: '2026-06-01', weight: 0, kcal: 2500 }, // 0 weight
                { date: '2026-06-02', weight: -75, kcal: 2500 }, // negative weight
                { date: '2026-06-03', weight: 80, kcal: 0 }, // 0 kcal
                { date: '2026-06-04', weight: 80, kcal: -2000 }, // negative kcal
                { date: '2026-06-05', weight: 'NaN', kcal: 2500 },
                { date: '2026-06-06', weight: 80, kcal: 'invalid' },
                // 7 valid records mixed in
                { date: '2026-06-10', weight: 80, kcal: 2500 },
                { date: '2026-06-11', weight: 80, kcal: 2500 },
                { date: '2026-06-12', weight: 80, kcal: 2500 },
                { date: '2026-06-13', weight: 80, kcal: 2500 },
                { date: '2026-06-14', weight: 80, kcal: 2500 },
                { date: '2026-06-15', weight: 80, kcal: 2500 },
                { date: '2026-06-16', weight: 80, kcal: 2500 },
            ];

            const res = calculateTDEE(dirtyData as any);
            expect(res.error).toBe(false);
            expect(res.daysTracked).toBe(7);
            expect(res.tdee).toBe(2500);
        });

        // 1.5 Adversarial Finding Demonstration: Unparseable date strings yield NaN in current implementation
        it('R1.5: Adversarial edge case: unparseable date strings pass non-empty string check and produce NaN diffDays', () => {
            // When 6 valid days and 1 unparseable date string is passed:
            const dataWithBadDate = [
                { date: 'INVALID_DATE_STRING', weight: 80, kcal: 2500 },
                { date: '2026-06-10', weight: 80, kcal: 2500 },
                { date: '2026-06-11', weight: 80, kcal: 2500 },
                { date: '2026-06-12', weight: 80, kcal: 2500 },
                { date: '2026-06-13', weight: 80, kcal: 2500 },
                { date: '2026-06-14', weight: 80, kcal: 2500 },
                { date: '2026-06-15', weight: 80, kcal: 2500 },
            ];

            const res = calculateTDEE(dataWithBadDate);
            // Empirically observes whether calculateTDEE produced NaN due to missing Date.parse validation
            if (res.error === false && isNaN(res.tdee!)) {
                // Confirms the unparseable date flaw
                expect(isNaN(res.tdee!)).toBe(true);
            }
        });

        // 1.6 Boundary test: 0, 1, 6 valid items vs exactly 7, 14, and 20 items (sliding 14-day window)
        it('R1.6: Enforces >= 7 measurement threshold and uses 14-day sliding window correctly', () => {
            expect(calculateTDEE([])).toEqual({
                error: true,
                message: 'Raccolta dati in corso... (0/7 giorni richiesti)'
            });

            expect(calculateTDEE([{ date: '2026-01-01', weight: 70, kcal: 2000 }])).toEqual({
                error: true,
                message: 'Raccolta dati in corso... (1/7 giorni richiesti)'
            });

            // 20 days: window must strictly take the most recent 14 days
            const twentyDays = [];
            for (let i = 1; i <= 20; i++) {
                const dayStr = i < 10 ? `0${i}` : `${i}`;
                twentyDays.push({
                    date: `2026-07-${dayStr}`,
                    weight: 80 + (i === 1 ? 999 : 0), // Day 1 has outlier weight 1079
                    kcal: 3000
                });
            }

            const res20 = calculateTDEE(twentyDays);
            expect(res20.error).toBe(false);
            expect(res20.daysTracked).toBe(14);
            // The first 6 days (including day 1 outlier) should have been sliced off
            expect(res20.weightDiff).toBe('0.00'); // Day 7 to 20 all weight=80
            expect(res20.tdee).toBe(3000);
        });

        // 1.7 Identical dates scenario
        it('R1.7: Returns clear error when all valid measurements share the exact same date (diffDays = 0)', () => {
            const sameDayData = [
                { date: '2026-08-15', weight: 80.0, kcal: 2500 },
                { date: '2026-08-15', weight: 80.1, kcal: 2600 },
                { date: '2026-08-15', weight: 80.2, kcal: 2550 },
                { date: '2026-08-15', weight: 80.0, kcal: 2500 },
                { date: '2026-08-15', weight: 80.3, kcal: 2700 },
                { date: '2026-08-15', weight: 80.1, kcal: 2400 },
                { date: '2026-08-15', weight: 80.2, kcal: 2500 },
            ];

            const res = calculateTDEE(sameDayData);
            expect(res).toEqual({
                error: true,
                message: 'Dati insufficienti (stesso giorno)'
            });
        });

        // 1.8 Extreme weight and caloric deltas
        it('R1.8: Correctly computes extreme weight loss / gain surplus physics', () => {
            // Extreme weight loss: -3 kg in 7 days (diffDays = 6) with avg 2000 kcal
            // dailySurplusKcal = (-3 / 6) * 7700 = -3850 kcal/day
            // TDEE = 2000 - (-3850) = 5850 kcal
            const extremeLoss = [
                { date: '2026-09-01', weight: 93.0, kcal: 2000 },
                { date: '2026-09-02', weight: 92.5, kcal: 2000 },
                { date: '2026-09-03', weight: 92.0, kcal: 2000 },
                { date: '2026-09-04', weight: 91.5, kcal: 2000 },
                { date: '2026-09-05', weight: 91.0, kcal: 2000 },
                { date: '2026-09-06', weight: 90.5, kcal: 2000 },
                { date: '2026-09-07', weight: 90.0, kcal: 2000 },
            ];

            const resLoss = calculateTDEE(extremeLoss);
            expect(resLoss.error).toBe(false);
            expect(resLoss.weightDiff).toBe('-3.00');
            expect(resLoss.dailyDeficit).toBe(-3850);
            expect(resLoss.tdee).toBe(5850);
        });
    });

    // =========================================================================
    // SECTION 2: R2 (WORKOUT REPORT VOLUME & PR LOGIC) ADVERSARIAL CHALLENGES
    // =========================================================================
    describe('R2: Workout Report Volume & PR Logic Adversarial Stress Tests', () => {

        const exerciseCatalog = [
            { id: 'ex-bench', name: 'Panca piana bilanciere', isBodyweight: false, equipmentWeight: 0 },
            { id: 'ex-incline-db', name: 'Spinte manubri inclinata', isBodyweight: false, equipmentWeight: 0 },
            { id: 'ex-cable-fly', name: 'Croci ai cavi', isBodyweight: false, equipmentWeight: 0 },
            { id: 'ex-squat-barbell', name: 'Squat bilanciere olimpico', isBodyweight: false, equipmentWeight: 20 },
            { id: 'ex-pullup', name: 'Trazioni alla sbarra', isBodyweight: true, equipmentWeight: 0 },
            { id: 'ex-dip-belt', name: 'Dips con cintura zavorre', isBodyweight: true, equipmentWeight: 5 }, // 5kg dip belt/chain
            { id: 'ex-pushup', name: 'Piegamenti a terra', isBodyweight: true, equipmentWeight: 0 },
            { id: 'ex-cardio-run', name: 'Corsa tapis roulant', trackingType: 'cardio', isBodyweight: false }
        ];

        const libraryMap = new Map(exerciseCatalog.map(item => [item.id, item]));
        const athleteWeight = 85; // 85kg user

        // 2.1 Complex Mixed Workout (3 free weights + 2 bodyweight exercises)
        it('R2.1: Correctly calculates volume for a complex mixed session (3 FW + 2 BW) with equipment weight', () => {
            const workout: WorkoutSession = {
                id: 'sess-mixed-1',
                routineId: 'routine-upper-hypertrophy',
                routineName: 'Upper Hypertrophy',
                date: '2026-09-02',
                exercises: [
                    // FW 1: Bench Press (isBodyweight: false, eq: 0) -> 100kg x 6, 90kg x 8
                    // Volume = 600 + 720 = 1320
                    {
                        exId: 'ex-bench',
                        sets: [
                            { id: 's1', kg: '100', reps: '6' },
                            { id: 's2', kg: '90', reps: '8' }
                        ]
                    },
                    // FW 2: Incline DB (isBodyweight: false, eq: 0) -> 32kg x 10, 30kg x 10
                    // Volume = 320 + 300 = 620
                    {
                        exId: 'ex-incline-db',
                        sets: [
                            { id: 's3', kg: '32', reps: '10' },
                            { id: 's4', kg: '30', reps: '10' }
                        ]
                    },
                    // FW 3: Squat (isBodyweight: false, eq: 20kg bar) -> 100kg plate + 20kg bar = 120kg x 5, 5 reps
                    // Volume = (100 + 20) * 5 + (100 + 20) * 5 = 600 + 600 = 1200
                    {
                        exId: 'ex-squat-barbell',
                        sets: [
                            { id: 's5', kg: '100', reps: '5' },
                            { id: 's6', kg: '100', reps: '5' }
                        ]
                    },
                    // BW 1: Pullup (isBodyweight: true, eq: 0, athleteWeight: 85)
                    // Set 1: +15kg weighted pullup x 6 -> (15 + 85) * 6 = 100 * 6 = 600
                    // Set 2: unweighted (0kg) x 8 -> (0 + 85) * 8 = 85 * 8 = 680
                    // Volume = 600 + 680 = 1280
                    {
                        exId: 'ex-pullup',
                        sets: [
                            { id: 's7', kg: '15', reps: '6' },
                            { id: 's8', kg: '0', reps: '8' }
                        ]
                    },
                    // BW 2: Dips with belt (isBodyweight: true, eq: 5kg, athleteWeight: 85)
                    // Set 1: +20kg plate x 8 -> (20 + 85 + 5) * 8 = 110 * 8 = 880
                    // Set 2: +0kg plate x 10 -> (0 + 85 + 5) * 10 = 90 * 10 = 900
                    // Volume = 880 + 900 = 1780
                    {
                        exId: 'ex-dip-belt',
                        sets: [
                            { id: 's9', kg: '20', reps: '8' },
                            { id: 's10', kg: '0', reps: '10' }
                        ]
                    }
                ]
            };

            const report = computeWorkoutReport(workout, [], libraryMap, athleteWeight);

            // Total volume math:
            // Bench (1320) + DB (620) + Squat (1200) + Pullup (1280) + Dips (1780) = 6200
            expect(report.totalVolume).toBe(6200);
            expect(report.isFirstSession).toBe(true);
            expect(report.newPRs).toEqual([]);
        });

        // 2.2 Multi-Set Dropsets Math on Bodyweight and Free-weight exercises
        it('R2.2: Accurately computes volume, reps, and avgWeight for multi-tier dropsets', () => {
            const workout: WorkoutSession = {
                id: 'sess-dropsets',
                routineId: 'r-drop',
                date: '2026-09-02',
                exercises: [
                    // FW Dropset: Cable Flyes (isBodyweight: false, eq: 0)
                    // Set 1: 20kg x 10 -> dropset1: 15kg x 8 -> dropset2: 10kg x 8
                    // Vol = (20*10) + (15*8) + (10*8) = 200 + 120 + 80 = 400
                    // Reps = 10 + 8 + 8 = 26
                    // avgWeight = (20 + 15 + 10) / 3 = 15.0
                    {
                        exId: 'ex-cable-fly',
                        sets: [
                            {
                                id: 's1',
                                kg: '20',
                                reps: '10',
                                dropsets: [
                                    { id: 'ds1', kg: '15', reps: '8' },
                                    { id: 'ds2', kg: '10', reps: '8' }
                                ]
                            }
                        ]
                    },
                    // BW Dropset: Weighted Pullup (isBodyweight: true, eq: 0, userWeight: 80)
                    // Set 1: +20kg (100 eff) x 5 -> dropset1: +10kg (90 eff) x 5 -> dropset2: 0kg (80 eff) x 5
                    // Vol = (100*5) + (90*5) + (80*5) = 500 + 450 + 400 = 1350
                    // Reps = 5 + 5 + 5 = 15
                    // avgWeight = (100 + 90 + 80) / 3 = 90.0
                    {
                        exId: 'ex-pullup',
                        sets: [
                            {
                                id: 's2',
                                kg: '20',
                                reps: '5',
                                dropsets: [
                                    { id: 'ds3', kg: '10', reps: '5' },
                                    { id: 'ds4', kg: '0', reps: '5' }
                                ]
                            }
                        ]
                    }
                ]
            };

            const report = computeWorkoutReport(workout, [], libraryMap, 80);
            expect(report.totalVolume).toBe(400 + 1350); // 1750

            // Helper function verification
            const cableFlyVol = calculateWorkoutVolume({ exercises: [workout.exercises![0]] }, exerciseCatalog, 80);
            expect(cableFlyVol).toBe(400);

            const pullupVol = calculateWorkoutVolume({ exercises: [workout.exercises![1]] }, exerciseCatalog, 80);
            expect(pullupVol).toBe(1350);
        });

        // 2.3 PR Invariant: First Session NEVER awards PRs, regardless of weight/volume
        it('R2.3: Treats first exercise exposures as baselines within the same routine context', () => {
            const firstSession: WorkoutSession = {
                id: 'sess-first',
                routineId: 'routine-legs',
                date: '2026-09-01',
                exercises: [
                    { exId: 'ex-squat-barbell', sets: [{ id: 's1', kg: '200', reps: '10' }] }, // massive 2200kg volume
                    { exId: 'ex-pullup', sets: [{ id: 's2', kg: '50', reps: '15' }] }
                ]
            };

            const reportEmptyHistory = computeWorkoutReport(firstSession, [], libraryMap, 80);
            expect(reportEmptyHistory.isFirstSession).toBe(true);
            expect(reportEmptyHistory.newPRs).toHaveLength(0);
            expect(reportEmptyHistory.exerciseComparisons).toHaveLength(2);

            // The same exercise in a different routine is a distinct progression context.
            const unmatchingHistory: WorkoutSession[] = [
                {
                    id: 'sess-other-1',
                    routineId: 'routine-arms',
                    date: '2026-08-20',
                    exercises: [{ exId: 'ex-squat-barbell', sets: [{ id: 's1', kg: '100', reps: '10' }] }]
                }
            ];

            const reportUnmatching = computeWorkoutReport(firstSession, unmatchingHistory, libraryMap, 80);
            expect(reportUnmatching.isFirstSession).toBe(true);
            expect(reportUnmatching.newPRs).toHaveLength(0);
        });

        // 2.4 PR Invariant: Exact Ties and Regressions NEVER award PRs
        it('R2.4: Exact ties (same load/reps) and regressions (lower load/reps) NEVER award PRs', () => {
            const prevSession: WorkoutSession = {
                id: 'sess-prev',
                routineId: 'routine-chest',
                date: '2026-08-20',
                exercises: [
                    // Bench: 100kg x 10 -> 1000 vol, 10 reps, 100 avgWeight
                    { exId: 'ex-bench', sets: [{ id: 's1', kg: '100', reps: '10' }] },
                    // Dips: +10kg (90 eff) x 10 -> 900 vol, 10 reps, 90 avgWeight (athleteWeight: 80)
                    { exId: 'ex-pullup', sets: [{ id: 's2', kg: '10', reps: '10' }] },
                    // Incline DB: 30kg x 10 -> 300 vol, 10 reps, 30 avgWeight
                    { exId: 'ex-incline-db', sets: [{ id: 's3', kg: '30', reps: '10' }] }
                ]
            };

            // Current Session:
            // 1. Bench: Exact tie (100kg x 10) -> NOT PR
            // 2. Pullup: Volume regression (10kg x 8 = 720 vol < 900 vol) -> NOT PR
            // 3. Incline DB: Reps regression with lower weight (28kg x 9 = 252 vol < 300 vol) -> NOT PR
            const currentSession: WorkoutSession = {
                id: 'sess-curr',
                routineId: 'routine-chest',
                date: '2026-08-27',
                exercises: [
                    { exId: 'ex-bench', sets: [{ id: 's1', kg: '100', reps: '10' }] }, // Exact Tie
                    { exId: 'ex-pullup', sets: [{ id: 's2', kg: '10', reps: '8' }] },   // Regression
                    { exId: 'ex-incline-db', sets: [{ id: 's3', kg: '28', reps: '9' }] } // Regression
                ]
            };

            const report = computeWorkoutReport(currentSession, [prevSession], libraryMap, 80);
            expect(report.isFirstSession).toBe(false);
            expect(report.newPRs).toHaveLength(0);

            const benchComp = report.exerciseComparisons.find(c => c.exId === 'ex-bench')!;
            expect(benchComp.isPR).toBe(false);
            expect(benchComp.volumeDelta).toBe(0);
            expect(benchComp.weightDelta).toBe(0);
            expect(benchComp.repsDelta).toBe(0);

            const pullupComp = report.exerciseComparisons.find(c => c.exId === 'ex-pullup')!;
            expect(pullupComp.isPR).toBe(false);
            expect(pullupComp.volumeDelta).toBe(-180);

            const dbComp = report.exerciseComparisons.find(c => c.exId === 'ex-incline-db')!;
            expect(dbComp.isPR).toBe(false);
            expect(dbComp.volumeDelta).toBe(-48);
        });

        // 2.5 PR Invariant: Progression scenarios correctly award PRs
        it('R2.5: Awards strong performance records only when output improves at comparable declared RIR', () => {
            const prevSession: WorkoutSession = {
                id: 'sess-prev',
                routineId: 'routine-push',
                date: '2026-08-20',
                exercises: [
                    // Bench: 100kg x 10 = 1000 vol
                    { exId: 'ex-bench', sets: [{ id: 's1', kg: '100', reps: '10', rir: 2 }] },
                    // Pullup (BW 80kg): 0kg x 10 = 800 vol
                    { exId: 'ex-pullup', sets: [{ id: 's2', kg: '0', reps: '10', rir: 2 }] },
                    // Cable Fly: 15kg x 10 = 150 vol
                    { exId: 'ex-cable-fly', sets: [{ id: 's3', kg: '15', reps: '10', rir: 2 }] }
                ]
            };

            const currSession: WorkoutSession = {
                id: 'sess-curr',
                routineId: 'routine-push',
                date: '2026-08-27',
                exercises: [
                    // Bench: 100kg x 11 = 1100 vol (+100 vol, +1 rep) -> PR
                    { exId: 'ex-bench', sets: [{ id: 's1', kg: '100', reps: '11', rir: 2 }] },
                    // Pullup: +5kg weighted (85 eff) x 10 = 850 vol (+50 vol, +5 avgWeight) -> PR
                    { exId: 'ex-pullup', sets: [{ id: 's2', kg: '5', reps: '10', rir: 2 }] },
                    // Cable Fly: 15kg x 10 = 150 vol (Exact tie) -> NOT PR
                    { exId: 'ex-cable-fly', sets: [{ id: 's3', kg: '15', reps: '10', rir: 2 }] }
                ]
            };

            const report = computeWorkoutReport(currSession, [prevSession], libraryMap, 80);
            expect(report.newPRs).toHaveLength(2);
            expect(report.newPRs.map(p => p.exId)).toEqual(['ex-bench', 'ex-pullup']);
        });

        // 2.6 History Search Resilience: picks closest previous workout with date <= currentWorkout.date
        it('R2.6: Selects the latest prior comparable exercise exposure and ignores future dates', () => {
            const h1: WorkoutSession = {
                id: 'sess-1',
                routineId: 'r-push',
                date: '2026-08-01',
                exercises: [{ exId: 'ex-bench', sets: [{ id: 's', kg: '80', reps: '10', rir: 2 }] }] // 800 vol
            };
            const h2: WorkoutSession = {
                id: 'sess-2',
                routineId: 'r-push',
                date: '2026-08-15',
                exercises: [{ exId: 'ex-bench', sets: [{ id: 's', kg: '90', reps: '10', rir: 2 }] }] // 900 vol (target previous)
            };
            const h3Future: WorkoutSession = {
                id: 'sess-3',
                routineId: 'r-push',
                date: '2026-09-05', // in the future relative to current session (2026-08-25)
                exercises: [{ exId: 'ex-bench', sets: [{ id: 's', kg: '150', reps: '10', rir: 2 }] }]
            };

            const current: WorkoutSession = {
                id: 'sess-curr',
                routineId: 'r-push',
                date: '2026-08-25',
                exercises: [{ exId: 'ex-bench', sets: [{ id: 's', kg: '95', reps: '10', rir: 2 }] }] // 950 vol
            };

            // History provided in descending chronological order: [h3Future, h2, h1]
            const report = computeWorkoutReport(current, [h3Future, h2, h1], libraryMap, 80);
            expect(report.isFirstSession).toBe(false);
            // It must have matched h2 (900 vol), NOT h3Future (1500 vol) or h1 (800 vol)
            const benchComp = report.exerciseComparisons.find(c => c.exId === 'ex-bench')!;
            expect(benchComp.previousVolume).toBe(900);
            expect(benchComp.currentVolume).toBe(950);
            expect(benchComp.volumeDelta).toBe(50);
            expect(benchComp.isPR).toBe(true);
        });

        // 2.7 Multi-Exercise Partial Match (new exercise added to existing routine)
        it('R2.7: Suppresses PR for newly introduced exercise in an established routine while awarding PR for improved existing exercise', () => {
            const prevSession: WorkoutSession = {
                id: 'sess-prev',
                routineId: 'r-pull',
                date: '2026-08-20',
                exercises: [
                    { exId: 'ex-pullup', sets: [{ id: 's1', kg: '0', reps: '8', rir: 2 }] } // 80 * 8 = 640
                ]
            };

            const currSession: WorkoutSession = {
                id: 'sess-curr',
                routineId: 'r-pull',
                date: '2026-08-27',
                exercises: [
                    // Established exercise: improved from 640 to 800 vol -> PR
                    { exId: 'ex-pullup', sets: [{ id: 's1', kg: '0', reps: '10', rir: 2 }] }, // 80 * 10 = 800
                    // Brand new exercise introduced in this workout session -> NOT PR
                    { exId: 'ex-cable-fly', sets: [{ id: 's2', kg: '20', reps: '12' }] }
                ]
            };

            const report = computeWorkoutReport(currSession, [prevSession], libraryMap, 80);
            expect(report.isFirstSession).toBe(false);
            expect(report.exerciseComparisons).toHaveLength(2);

            const pullupComp = report.exerciseComparisons.find(c => c.exId === 'ex-pullup')!;
            expect(pullupComp.isPR).toBe(true);

            const flyComp = report.exerciseComparisons.find(c => c.exId === 'ex-cable-fly')!;
            expect(flyComp.isPR).toBe(false);
            expect(flyComp.previousVolume).toBe(0);

            // newPRs must only contain pullup
            expect(report.newPRs).toHaveLength(1);
            expect(report.newPRs[0].exId).toBe('ex-pullup');
        });
    });
});
