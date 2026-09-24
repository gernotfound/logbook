import { describe, it, expect } from 'vitest';
import { computeWorkoutReport } from './workoutReport';
import type { WorkoutSession } from '../../types';

describe('R2: Workout Report Volume & PR Calculation (FNC-REPORT-01)', () => {
    const mockLibrary = [
        { id: 'ex-bench', name: 'Panca piana', isBodyweight: false, equipmentWeight: 0 },
        { id: 'ex-pullup', name: 'Trazioni', isBodyweight: true, equipmentWeight: 0 },
        { id: 'ex-dips', name: 'Dips alle parallele', isBodyweight: true, equipmentWeight: 0 },
        { id: 'ex-squat', name: 'Squat con bilanciere', isBodyweight: false, equipmentWeight: 20 },
    ];

    const libraryMap = new Map(mockLibrary.map(item => [item.id, item]));
    const userWeight = 80;

    describe('Bodyweight vs Free-weight Volume Math', () => {
        it('includes bodyweight for bodyweight exercises (isBodyweight: true)', () => {
            const workout: WorkoutSession = {
                id: 'w-1',
                routineId: 'r-upper',
                date: '2026-09-01',
                exercises: [
                    {
                        exId: 'ex-pullup',
                        sessionNote: '',
                        sets: [
                            { id: 's1', kg: '0', reps: '10' }, // (80 + 0) * 10 = 800
                            { id: 's2', kg: '10', reps: '6' }  // (80 + 10) * 6 = 540
                        ]
                    }
                ]
            };

            const report = computeWorkoutReport(workout, [], libraryMap, userWeight);
            expect(report.totalVolume).toBe(1340); // 800 + 540 = 1340
        });

        it('does NOT add bodyweight for free-weight exercises (isBodyweight: false / undefined)', () => {
            const workout: WorkoutSession = {
                id: 'w-1',
                routineId: 'r-upper',
                date: '2026-09-01',
                exercises: [
                    {
                        exId: 'ex-bench',
                        sessionNote: '',
                        sets: [
                            { id: 's1', kg: '80', reps: '10' }, // 80 * 10 = 800 (not 160 * 10)
                            { id: 's2', kg: '90', reps: '8' }   // 90 * 8 = 720
                        ]
                    }
                ]
            };

            const report = computeWorkoutReport(workout, [], libraryMap, userWeight);
            expect(report.totalVolume).toBe(1520); // 800 + 720 = 1520
        });

        it('correctly calculates mixed workouts with both bodyweight and free-weight exercises', () => {
            const workout: WorkoutSession = {
                id: 'w-1',
                routineId: 'r-upper',
                date: '2026-09-01',
                exercises: [
                    {
                        exId: 'ex-bench',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '100', reps: '5' }] // 100 * 5 = 500
                    },
                    {
                        exId: 'ex-pullup',
                        sessionNote: '',
                        sets: [{ id: 's2', kg: '0', reps: '8' }] // (80 + 0) * 8 = 640
                    },
                    {
                        exId: 'ex-dips',
                        sessionNote: '',
                        sets: [{ id: 's3', kg: '15', reps: '6' }] // (80 + 15) * 6 = 570
                    }
                ]
            };

            const report = computeWorkoutReport(workout, [], libraryMap, userWeight);
            expect(report.totalVolume).toBe(500 + 640 + 570); // 1710
        });
    });

    describe('PR (Personal Record) Baseline Suppression & Award Logic', () => {
        it('suppresses all PRs on first session of a routine (no previous baseline)', () => {
            const firstWorkout: WorkoutSession = {
                id: 'w-1',
                routineId: 'r-chest',
                date: '2026-09-01',
                exercises: [
                    {
                        exId: 'ex-bench',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '100', reps: '10' }]
                    }
                ]
            };

            const report = computeWorkoutReport(firstWorkout, [], libraryMap, userWeight);
            expect(report.isFirstSession).toBe(true);
            expect(report.newPRs).toEqual([]);
        });

        it('suppresses PR badge for a new exercise introduced to an existing routine', () => {
            const prevWorkout: WorkoutSession = {
                id: 'w-1',
                routineId: 'r-upper',
                date: '2026-08-25',
                exercises: [
                    {
                        exId: 'ex-bench',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '80', reps: '10' }]
                    }
                ]
            };

            const currentWorkout: WorkoutSession = {
                id: 'w-2',
                routineId: 'r-upper',
                date: '2026-09-01',
                exercises: [
                    {
                        exId: 'ex-bench',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '80', reps: '10' }]
                    },
                    {
                        // New exercise not present in prevWorkout
                        exId: 'ex-pullup',
                        sessionNote: '',
                        sets: [{ id: 's2', kg: '0', reps: '10' }]
                    }
                ]
            };

            const report = computeWorkoutReport(currentWorkout, [prevWorkout], libraryMap, userWeight);
            expect(report.isFirstSession).toBe(false);

            const pullupComp = report.exerciseComparisons.find(c => c.exId === 'ex-pullup');
            expect(pullupComp).toBeDefined();
            expect(pullupComp?.isPR).toBe(false);

            // newPRs must not contain the first-execution exercise
            expect(report.newPRs.some(pr => pr.exId === 'ex-pullup')).toBe(false);
        });

        it('awards a strong PR when output improves at comparable declared RIR', () => {
            const prevWorkout: WorkoutSession = {
                id: 'w-1',
                routineId: 'r-upper',
                date: '2026-08-25',
                exercises: [
                    {
                        exId: 'ex-bench',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '80', reps: '10', rir: 2 }] // 800 volume
                    }
                ]
            };

            const currentWorkout: WorkoutSession = {
                id: 'w-2',
                routineId: 'r-upper',
                date: '2026-09-01',
                exercises: [
                    {
                        exId: 'ex-bench',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '80', reps: '12', rir: 2 }] // 960 volume (+160)
                    }
                ]
            };

            const report = computeWorkoutReport(currentWorkout, [prevWorkout], libraryMap, userWeight);
            expect(report.isFirstSession).toBe(false);

            const benchComp = report.exerciseComparisons.find(c => c.exId === 'ex-bench');
            expect(benchComp?.isPR).toBe(true);
            expect(report.newPRs).toHaveLength(1);
            expect(report.newPRs[0].exId).toBe('ex-bench');
            expect(report.newPRs[0].volumeDelta).toBe(160);
        });

        it('does NOT award PR when volume and weight are lower than or equal to previous', () => {
            const prevWorkout: WorkoutSession = {
                id: 'w-1',
                routineId: 'r-upper',
                date: '2026-08-25',
                exercises: [
                    {
                        exId: 'ex-bench',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '100', reps: '10' }] // 1000 volume
                    }
                ]
            };

            const currentWorkout: WorkoutSession = {
                id: 'w-2',
                routineId: 'r-upper',
                date: '2026-09-01',
                exercises: [
                    {
                        exId: 'ex-bench',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '90', reps: '8' }] // 720 volume (-280)
                    }
                ]
            };

            const report = computeWorkoutReport(currentWorkout, [prevWorkout], libraryMap, userWeight);
            expect(report.isFirstSession).toBe(false);

            const benchComp = report.exerciseComparisons.find(c => c.exId === 'ex-bench');
            expect(benchComp?.isPR).toBe(false);
            expect(report.newPRs).toHaveLength(0);
        });
    });
});
