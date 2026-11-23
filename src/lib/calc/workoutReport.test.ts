import { describe, it, expect } from 'vitest';
import { computeWorkoutReport } from './workoutReport';
import type { WorkoutSession } from '../../types';
import type { ProgressionExerciseRef } from './progression';

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

    it('computes overall volume delta only across exercises that have a comparable previous exposure', () => {
        const previous: WorkoutSession = {
            id: 'delta-prev', date: '2026-09-01', exercises: [
                { exId: 'ex-bench', sessionNote: '', sets: [{ id: 'b1', kg: '80', reps: '10', rir: 2 }] },
            ],
        };
        const current: WorkoutSession = {
            id: 'delta-current', date: '2026-09-08', exercises: [
                { exId: 'ex-bench', sessionNote: '', sets: [{ id: 'b2', kg: '80', reps: '10', rir: 2 }] },
                { exId: 'ex-pullup', sessionNote: '', sets: [{ id: 'p1', kg: '0', reps: '10', rir: 2 }] },
            ],
        };
        const report = computeWorkoutReport(current, [previous], libraryMap, userWeight);
        expect(report.totalVolume).toBe(1600);
        expect(report.previousTotalVolume).toBe(800);
        expect(report.volumeDeltaPercent).toBe(0);
    });

    it('uses the same edited historical duration as the density progression input', () => {
        const workout: WorkoutSession = {
            id: 'duration-1', date: '2026-09-24', routineId: 'r-duration',
            globalStartTime: 1000, globalEndTime: 2401000,
            globalDurationStr: '00:40:00', manualDurationStr: '00:45:00',
            exercises: [],
        };
        expect(computeWorkoutReport(workout, [], libraryMap, userWeight).durationSeconds).toBe(2700);
    });


    it('does not mark overflowing totals across individually complete exercises as reliable', () => {
        const workout: WorkoutSession = {
            id: 'overflow-aggregate', date: '2026-09-08', exercises: [
                { exId: 'ex-bench', sessionNote: '', sets: [{ id: 'a', kg: '1e308', reps: '1' }] },
                { exId: 'ex-squat', sessionNote: '', sets: [{ id: 'b', kg: '1e308', reps: '1' }] },
            ],
        };
        const report = computeWorkoutReport(workout, [], libraryMap);
        expect(report.exerciseComparisons.every(item => item.progression.current.tonnageComplete)).toBe(true);
        expect(report.totalVolumeIsComplete).toBe(false);
        expect(Number.isFinite(report.totalVolume)).toBe(true);
        expect(report.volumeDeltaPercent).toBeUndefined();
    });

    it('keeps the mean observed load finite even when adding valid loads would overflow', () => {
        const workout: WorkoutSession = {
            id: 'overflow-mean', date: '2026-09-08', exercises: [{
                exId: 'ex-bench', sessionNote: '', sets: [
                    { id: 'a', kg: '1e308', reps: '1' },
                    { id: 'b', kg: '1e308', reps: '1' },
                ],
            }],
        };
        const report = computeWorkoutReport(workout, [], libraryMap);
        expect(report.exerciseComparisons[0].currentAvgWeight).toBe(1e308);
        expect(report.exerciseComparisons[0].weightDelta).toBe(1e308);
        expect(report.totalVolumeIsComplete).toBe(false);
        expect(Number.isFinite(report.exerciseComparisons[0].currentAvgWeight)).toBe(true);
    });

    it('omits unrepresentable percentage changes rather than reporting Infinity', () => {
        const previous: WorkoutSession = {
            id: 'percent-prev', date: '2026-09-01', exercises: [
                { exId: 'ex-bench', sessionNote: '', sets: [{ id: 'a', kg: '1', reps: '1', rir: 2 }] },
            ],
        };
        const workout: WorkoutSession = {
            id: 'percent-now', date: '2026-09-08', exercises: [
                { exId: 'ex-bench', sessionNote: '', sets: [{ id: 'b', kg: '1e308', reps: '1', rir: 2 }] },
            ],
        };
        const report = computeWorkoutReport(workout, [previous], libraryMap);
        expect(report.totalVolumeIsComplete).toBe(true);
        expect(report.previousVolumeIsComplete).toBe(true);
        expect(report.exerciseComparisons[0].volumeDeltaPercent).toBeNull();
        expect(report.volumeDeltaPercent).toBeUndefined();
    });

    it('keeps mixed cardio and timed work from invalidating strength tonnage', () => {
        const mixedLibrary = new Map<string, ProgressionExerciseRef>(libraryMap);
        mixedLibrary.set('ex-cardio', {
            id: 'ex-cardio', name: 'Corsa', trackingType: 'cardio',
            isBodyweight: false, equipmentWeight: 0,
        });
        mixedLibrary.set('ex-plank', {
            id: 'ex-plank', name: 'Plank', trackingType: 'time',
            isBodyweight: false, equipmentWeight: 0,
        });
        const workoutWithMixedSets = (id: string, date: string, kg: string, cardioMinutes: string): WorkoutSession => ({
            id, date, routineId: 'mixed-workout',
            exercises: [
                { exId: 'ex-bench', sessionNote: '', sets: [{ id: id + '-bench', kg, reps: '10', rir: 2 }] },
                { exId: 'ex-cardio', sessionNote: '', sets: [{ id: id + '-cardio', kg: '', reps: '', time: cardioMinutes }] },
                { exId: 'ex-plank', sessionNote: '', sets: [{ id: id + '-plank', kg: '', reps: '', time: '40' }] },
            ],
        });
        const previous = workoutWithMixedSets('prev-mixed', '2026-09-01', '80', '20');
        const current = workoutWithMixedSets('current-mixed', '2026-09-08', '90', '30');
        const report = computeWorkoutReport(current, [previous], mixedLibrary, userWeight);

        expect(report.exerciseComparisons).toHaveLength(3);
        expect(report.exerciseComparisons.find(item => item.exId === 'ex-cardio')?.progression.current.tonnageComplete).toBe(false);
        expect(report.exerciseComparisons.find(item => item.exId === 'ex-plank')?.progression.current.tonnageComplete).toBe(false);
        expect(report.totalVolume).toBe(900);
        expect(report.totalVolumeIsComplete).toBe(true);
        expect(report.previousTotalVolume).toBe(800);
        expect(report.previousVolumeIsComplete).toBe(true);
        expect(report.volumeDeltaPercent).toBe(12.5);
    });

    it('still marks an invalid strength load incomplete beside valid cardio work', () => {
        const mixedLibrary = new Map<string, ProgressionExerciseRef>(libraryMap);
        mixedLibrary.set('ex-cardio', {
            id: 'ex-cardio', name: 'Corsa', trackingType: 'cardio',
            isBodyweight: false, equipmentWeight: 0,
        });
        const previous: WorkoutSession = {
            id: 'prev-unsafe-load', date: '2026-09-01', routineId: 'mixed-workout',
            exercises: [
                { exId: 'ex-bench', sessionNote: '', sets: [{ id: 'old-bench', kg: '80', reps: '10', rir: 2 }] },
                { exId: 'ex-cardio', sessionNote: '', sets: [{ id: 'old-run', kg: '', reps: '', time: '20' }] },
            ],
        };
        const current: WorkoutSession = {
            id: 'now-unsafe-load', date: '2026-09-08', routineId: 'mixed-workout',
            exercises: [
                { exId: 'ex-bench', sessionNote: '', sets: [{ id: 'invalid-bench', kg: 'invalid', reps: '10', rir: 2 }] },
                { exId: 'ex-cardio', sessionNote: '', sets: [{ id: 'new-run', kg: '', reps: '', time: '30' }] },
            ],
        };
        const report = computeWorkoutReport(current, [previous], mixedLibrary, userWeight);

        expect(report.totalVolumeIsComplete).toBe(false);
        expect(report.previousTotalVolume).toBe(800);
        expect(report.previousVolumeIsComplete).toBe(true);
        expect(report.volumeDeltaPercent).toBeUndefined();
        expect(report.exerciseComparisons.find(item => item.exId === 'ex-bench')?.progression.current.tonnageComplete).toBe(false);
    });

    it('reports zero mechanical tonnage for a cardio-only session without inventing kilograms', () => {
        const cardioLibrary = new Map<string, ProgressionExerciseRef>(libraryMap);
        cardioLibrary.set('ex-cardio', {
            id: 'ex-cardio', name: 'Corsa', trackingType: 'cardio',
            isBodyweight: false, equipmentWeight: 0,
        });
        const workout: WorkoutSession = {
            id: 'cardio-only', date: '2026-09-08', routineId: 'cardio-session',
            exercises: [
                { exId: 'ex-cardio', sessionNote: '', sets: [{ id: 'run', kg: '', reps: '', time: '30' }] },
            ],
        };
        const report = computeWorkoutReport(workout, [], cardioLibrary, userWeight);

        expect(report.totalVolume).toBe(0);
        expect(report.totalVolumeIsComplete).toBe(true);
        expect(report.exerciseComparisons).toHaveLength(1);
        expect(report.exerciseComparisons[0].progression.current.tonnageComplete).toBe(false);
        expect(report.exerciseComparisons[0].progression.current.tonnageKg).toBeUndefined();
        expect(report.newPRs).toEqual([]);
    });


});
