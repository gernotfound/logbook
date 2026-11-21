import { describe, it, expect } from 'vitest';
import { computeWorkoutReport } from '../../src/lib/calc/workoutReport';
import type { ProgressionExerciseRef } from '../../src/lib/calc/progression';
import { calculateWorkoutVolume } from '../../src/lib/calc/workout';
import type { WorkoutSession } from '../../src/types';

describe('R2: Workout Report Volume & PR Logic Adversarial Stress Tests', () => {

    const exerciseCatalog: ProgressionExerciseRef[] = [
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

    // Historical bodyweight must come from a dated measurement, never the current-session fallback.
    const measuredBodyweightContext = {
        nutrition: {
            '2026-08-20': {
                date: '2026-08-20', weight: 80, kcal: 0, carbs: 0, pro: 0, fat: 0,
            },
        },
    };

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
                    exId: 'ex-bench', sessionNote: '',
                    sets: [
                        { id: 's1', kg: '100', reps: '6' },
                        { id: 's2', kg: '90', reps: '8' }
                    ]
                },
                // FW 2: Incline DB (isBodyweight: false, eq: 0) -> 32kg x 10, 30kg x 10
                // Volume = 320 + 300 = 620
                {
                    exId: 'ex-incline-db', sessionNote: '',
                    sets: [
                        { id: 's3', kg: '32', reps: '10' },
                        { id: 's4', kg: '30', reps: '10' }
                    ]
                },
                // FW 3: Squat (isBodyweight: false, eq: 20kg bar) -> 100kg plate + 20kg bar = 120kg x 5, 5 reps
                // Volume = (100 + 20) * 5 + (100 + 20) * 5 = 600 + 600 = 1200
                {
                    exId: 'ex-squat-barbell', sessionNote: '',
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
                    exId: 'ex-pullup', sessionNote: '',
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
                    exId: 'ex-dip-belt', sessionNote: '',
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
                    exId: 'ex-cable-fly', sessionNote: '',
                    sets: [
                        {
                            id: 's1',
                            kg: '20',
                            reps: '10',
                            segments: [
                                { technique: 'dropset' as const, id: 'ds1', kg: '15', reps: '8' },
                                { technique: 'dropset' as const, id: 'ds2', kg: '10', reps: '8' }
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
                    exId: 'ex-pullup', sessionNote: '',
                    sets: [
                        {
                            id: 's2',
                            kg: '20',
                            reps: '5',
                            segments: [
                                { technique: 'dropset' as const, id: 'ds3', kg: '10', reps: '5' },
                                { technique: 'dropset' as const, id: 'ds4', kg: '0', reps: '5' }
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
                { exId: 'ex-squat-barbell', sessionNote: '', sets: [{ id: 's1', kg: '200', reps: '10' }] }, // massive 2200kg volume
                { exId: 'ex-pullup', sessionNote: '', sets: [{ id: 's2', kg: '50', reps: '15' }] }
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
                exercises: [{ exId: 'ex-squat-barbell', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }]
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
                { exId: 'ex-bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] },
                // Dips: +10kg (90 eff) x 10 -> 900 vol, 10 reps, 90 avgWeight (athleteWeight: 80)
                { exId: 'ex-pullup', sessionNote: '', sets: [{ id: 's2', kg: '10', reps: '10' }] },
                // Incline DB: 30kg x 10 -> 300 vol, 10 reps, 30 avgWeight
                { exId: 'ex-incline-db', sessionNote: '', sets: [{ id: 's3', kg: '30', reps: '10' }] }
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
                { exId: 'ex-bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }, // Exact Tie
                { exId: 'ex-pullup', sessionNote: '', sets: [{ id: 's2', kg: '10', reps: '8' }] },   // Regression
                { exId: 'ex-incline-db', sessionNote: '', sets: [{ id: 's3', kg: '28', reps: '9' }] } // Regression
            ]
        };

        const report = computeWorkoutReport(currentSession, [prevSession], libraryMap, 80, measuredBodyweightContext);
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
                { exId: 'ex-bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10', rir: 2 }] },
                // Pullup (BW 80kg): 0kg x 10 = 800 vol
                { exId: 'ex-pullup', sessionNote: '', sets: [{ id: 's2', kg: '0', reps: '10', rir: 2 }] },
                // Cable Fly: 15kg x 10 = 150 vol
                { exId: 'ex-cable-fly', sessionNote: '', sets: [{ id: 's3', kg: '15', reps: '10', rir: 2 }] }
            ]
        };

        const currSession: WorkoutSession = {
            id: 'sess-curr',
            routineId: 'routine-push',
            date: '2026-08-27',
            exercises: [
                // Bench: 100kg x 11 = 1100 vol (+100 vol, +1 rep) -> PR
                { exId: 'ex-bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '11', rir: 2 }] },
                // Pullup: +5kg weighted (85 eff) x 10 = 850 vol (+50 vol, +5 avgWeight) -> PR
                { exId: 'ex-pullup', sessionNote: '', sets: [{ id: 's2', kg: '5', reps: '10', rir: 2 }] },
                // Cable Fly: 15kg x 10 = 150 vol (Exact tie) -> NOT PR
                { exId: 'ex-cable-fly', sessionNote: '', sets: [{ id: 's3', kg: '15', reps: '10', rir: 2 }] }
            ]
        };

        const report = computeWorkoutReport(currSession, [prevSession], libraryMap, 80, measuredBodyweightContext);
        expect(report.newPRs).toHaveLength(2);
        expect(report.newPRs.map(p => p.exId)).toEqual(['ex-bench', 'ex-pullup']);
    });

    // 2.6 History Search Resilience: picks closest previous workout with date <= currentWorkout.date
    it('R2.6: Selects the latest prior comparable exercise exposure and ignores future dates', () => {
        const h1: WorkoutSession = {
            id: 'sess-1',
            routineId: 'r-push',
            date: '2026-08-01',
            exercises: [{ exId: 'ex-bench', sessionNote: '', sets: [{ id: 's', kg: '80', reps: '10', rir: 2 }] }] // 800 vol
        };
        const h2: WorkoutSession = {
            id: 'sess-2',
            routineId: 'r-push',
            date: '2026-08-15',
            exercises: [{ exId: 'ex-bench', sessionNote: '', sets: [{ id: 's', kg: '90', reps: '10', rir: 2 }] }] // 900 vol (target previous)
        };
        const h3Future: WorkoutSession = {
            id: 'sess-3',
            routineId: 'r-push',
            date: '2026-09-05', // in the future relative to current session (2026-08-25)
            exercises: [{ exId: 'ex-bench', sessionNote: '', sets: [{ id: 's', kg: '150', reps: '10', rir: 2 }] }]
        };

        const current: WorkoutSession = {
            id: 'sess-curr',
            routineId: 'r-push',
            date: '2026-08-25',
            exercises: [{ exId: 'ex-bench', sessionNote: '', sets: [{ id: 's', kg: '95', reps: '10', rir: 2 }] }] // 950 vol
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
                { exId: 'ex-pullup', sessionNote: '', sets: [{ id: 's1', kg: '0', reps: '8', rir: 2 }] } // 80 * 8 = 640
            ]
        };

        const currSession: WorkoutSession = {
            id: 'sess-curr',
            routineId: 'r-pull',
            date: '2026-08-27',
            exercises: [
                // Established exercise: improved from 640 to 800 vol -> PR
                { exId: 'ex-pullup', sessionNote: '', sets: [{ id: 's1', kg: '0', reps: '10', rir: 2 }] }, // 80 * 10 = 800
                // Brand new exercise introduced in this workout session -> NOT PR
                { exId: 'ex-cable-fly', sessionNote: '', sets: [{ id: 's2', kg: '20', reps: '12' }] }
            ]
        };

        const report = computeWorkoutReport(currSession, [prevSession], libraryMap, 80, measuredBodyweightContext);
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
