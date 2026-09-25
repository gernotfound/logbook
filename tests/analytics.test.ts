import { describe, it, expect } from 'vitest';
import {
    computeWeeklyVolumeSeries,
    computeWeeklyNutritionSeries,
    computeVolumeCaloriesCorrelation,
    calculatePearsonCorrelation,
    generateWeekIntervals,
    getWorkoutDateString
} from '../src/lib/calc/analytics';
import type { WorkoutSession, Exercise, NutritionDay } from '../src/types';

describe('Analytics Engine: src/lib/calc/analytics.ts', () => {
    const mockLibrary: Exercise[] = [
        {
            id: 'ex-bench',
            name: 'Panca piana',
            setsCount: 3,
            sets: [],
            isBodyweight: false,
            equipmentWeight: 20
        },
        {
            id: 'ex-pullup',
            name: 'Trazioni',
            setsCount: 3,
            sets: [],
            isBodyweight: true,
            equipmentWeight: 0
        },
        {
            id: 'ex-run',
            name: 'Corsa',
            setsCount: 1,
            sets: [],
            trackingType: 'cardio'
        }
    ];

    describe('getWorkoutDateString', () => {
        it('extracts date from string format YYYY-MM-DD', () => {
            const w: WorkoutSession = { exercises: [], date: '2026-08-15' };
            expect(getWorkoutDateString(w)).toBe('2026-08-15');
        });

        it('extracts date from ISO string with time', () => {
            const w: WorkoutSession = { exercises: [], date: '2026-08-15T10:30:00.000Z' };
            expect(getWorkoutDateString(w)).toBe('2026-08-15');
        });

        it('extracts date from globalStartTime timestamp', () => {
            const date = new Date(2026, 7, 15, 14, 0, 0); // 15 Aug 2026
            const w: WorkoutSession = { exercises: [], globalStartTime: date.getTime() };
            const res = getWorkoutDateString(w);
            expect(res).toBe('2026-08-15');
        });

        it('returns null for empty or invalid session', () => {
            expect(getWorkoutDateString(null)).toBeNull();
            expect(getWorkoutDateString({})).toBeNull();
        });
    });

    describe('generateWeekIntervals', () => {
        it('generates exact number of weeks requested', () => {
            const refDate = new Date(2026, 7, 22); // Saturday 22 Aug 2026
            const intervals4 = generateWeekIntervals(4, refDate);
            expect(intervals4).toHaveLength(4);

            const intervals12 = generateWeekIntervals(12, refDate);
            expect(intervals12).toHaveLength(12);

            // Last interval should contain the reference date week
            const last = intervals4[intervals4.length - 1];
            expect(last.weekStart).toBe('2026-08-17'); // Monday
            expect(last.weekEnd).toBe('2026-08-23');   // Sunday
        });
    });

    describe('computeWeeklyVolumeSeries', () => {
        it('does not inspect exercise sets outside the requested window', () => {
            const old = { id: 'old', date: '2016-01-01', get exercises() { throw new Error('Old sets must not be traversed'); } };
            const future = { id: 'future', date: '2027-01-01', get exercises() { throw new Error('Future sets must not be traversed'); } };
            const result = computeWeeklyVolumeSeries([old, future] as WorkoutSession[], mockLibrary, 80, 8, '2026-09-11');
            expect(result.stats.totalWorkouts).toBe(0);
        });
        it('calculates weekly training volume correctly including equipment and bodyweight', () => {
            const refDate = '2026-08-22';
            const history: WorkoutSession[] = [
                {
                    id: 'w1',
                    date: '2026-08-18', // In current week (2026-08-17 to 2026-08-23)
                    exercises: [
                        {
                            exId: 'ex-bench', // eq: 20kg
                            sessionNote: '',
                            sets: [
                                { id: 's1', kg: '80', reps: '10', done: true }, // (80 + 20) * 10 = 1000 kg
                                {
                                    id: 's2',
                                    kg: '80',
                                    reps: '8',
                                    done: true,
                                    dropsets: [{ id: 'ds1', kg: '60', reps: '5' }] // (80+20)*8 + (60+20)*5 = 800 + 400 = 1200 kg
                                }
                            ]
                        },
                        {
                            exId: 'ex-pullup', // isBodyweight: true (userWeight = 75)
                            sessionNote: '',
                            sets: [
                                { id: 's3', kg: '10', reps: '6', done: true } // (10 + 75) * 6 = 510 kg
                            ]
                        },
                        {
                            exId: 'ex-run', // cardio -> 0 kg volume
                            sessionNote: '',
                            sets: [
                                { id: 's4', kg: '0', reps: '0', time: '1800', done: true }
                            ]
                        }
                    ]
                },
                {
                    id: 'w2',
                    date: '2026-08-12', // In previous week (2026-08-10 to 2026-08-16)
                    exercises: [
                        {
                            exId: 'ex-bench',
                            sessionNote: '',
                            sets: [
                                { id: 's1', kg: '80', reps: '10', done: true } // (80 + 20) * 10 = 1000 kg
                            ]
                        }
                    ]
                }
            ];

            const result = computeWeeklyVolumeSeries(history, mockLibrary, 75, 4, refDate);
            expect(result.points).toHaveLength(4);
            expect(result.stats.hasData).toBe(true);

            // Previous week: 1000 kg
            const prevWeek = result.points[result.points.length - 2];
            expect(prevWeek.volumeKg).toBe(1000);
            expect(prevWeek.workoutCount).toBe(1);

            // Current week: 1000 + 1200 + 510 = 2710 kg
            const curWeek = result.points[result.points.length - 1];
            expect(curWeek.volumeKg).toBe(2710);
            expect(curWeek.volumeTon).toBe(2.71);
            expect(curWeek.workoutCount).toBe(1);

            // Percentage change: (2710 - 1000) / 1000 = +171%
            expect(result.stats.percentageChange).toBe(171);
            expect(result.stats.peakWeekVolumeKg).toBe(2710);
            expect(result.stats.totalVolumeKg).toBe(3710);
        });

        it('handles empty workout history gracefully', () => {
            const result = computeWeeklyVolumeSeries([], mockLibrary, 80, 8);
            expect(result.points).toHaveLength(8);
            expect(result.stats.hasData).toBe(false);
            expect(result.stats.totalVolumeKg).toBe(0);
            expect(result.stats.avgWeeklyVolumeKg).toBe(0);
            expect(result.stats.percentageChange).toBeNull();
        });
    });

    describe('computeWeeklyNutritionSeries', () => {
        it('aggregates daily calories into weekly averages correctly', () => {
            const refDate = '2026-08-22';
            const nutrition: Record<string, NutritionDay> = {
                '2026-08-17': { date: '2026-08-17', kcal: 2400, carbs: 250, pro: 160, fat: 60 },
                '2026-08-18': { date: '2026-08-18', kcal: 2600, carbs: 280, pro: 170, fat: 65 },
                '2026-08-19': { date: '2026-08-19', kcal: 2500, carbs: 270, pro: 165, fat: 62 },
                '2026-08-10': { date: '2026-08-10', kcal: 2200, carbs: 230, pro: 150, fat: 55 }
            };

            const result = computeWeeklyNutritionSeries(nutrition, 4, refDate);
            expect(result.points).toHaveLength(4);
            expect(result.stats.hasData).toBe(true);

            // Current week: (2400 + 2600 + 2500) / 3 = 2500 kcal
            const curWeek = result.points[result.points.length - 1];
            expect(curWeek.loggedDaysCount).toBe(3);
            expect(curWeek.avgDailyKcal).toBe(2500);
            expect(curWeek.totalKcal).toBe(7500);

            // Previous week: 2200 kcal across 1 day
            const prevWeek = result.points[result.points.length - 2];
            expect(prevWeek.loggedDaysCount).toBe(1);
            expect(prevWeek.avgDailyKcal).toBe(2200);
        });

        it('handles empty nutrition records gracefully', () => {
            const result = computeWeeklyNutritionSeries({}, 8);
            expect(result.points).toHaveLength(8);
            expect(result.stats.hasData).toBe(false);
            expect(result.stats.avgDailyKcalOverall).toBe(0);
        });
    });

    describe('calculatePearsonCorrelation', () => {
        it('computes exact correlation for positive linear relationship', () => {
            const x = [1000, 2000, 3000, 4000];
            const y = [2000, 2400, 2800, 3200];
            const r = calculatePearsonCorrelation(x, y);
            expect(r).toBe(1);
        });

        it('computes exact correlation for negative linear relationship', () => {
            const x = [1000, 2000, 3000, 4000];
            const y = [3200, 2800, 2400, 2000];
            const r = calculatePearsonCorrelation(x, y);
            expect(r).toBe(-1);
        });

        it('returns null if fewer than 3 points provided', () => {
            expect(calculatePearsonCorrelation([10, 20], [100, 200])).toBeNull();
        });

        it('returns 0 for zero variance', () => {
            expect(calculatePearsonCorrelation([1000, 1000, 1000], [2000, 2500, 3000])).toBe(0);
        });
    });

    describe('computeVolumeCaloriesCorrelation', () => {
        it('aligns volume and nutrition series and produces meaningful insight in Italian sentence case', () => {
            const refDate = '2026-08-22';
            const history: WorkoutSession[] = [
                {
                    id: 'w1',
                    date: '2026-08-01',
                    exercises: [{ exId: 'ex-bench', sets: [{ id: 's1', kg: '50', reps: '10' }], sessionNote: '' }]
                },
                {
                    id: 'w2',
                    date: '2026-08-08',
                    exercises: [{ exId: 'ex-bench', sets: [{ id: 's2', kg: '70', reps: '10' }], sessionNote: '' }]
                },
                {
                    id: 'w3',
                    date: '2026-08-15',
                    exercises: [{ exId: 'ex-bench', sets: [{ id: 's3', kg: '90', reps: '10' }], sessionNote: '' }]
                }
            ];

            const nutrition: Record<string, NutritionDay> = {
                '2026-08-01': { date: '2026-08-01', kcal: 2200, carbs: 200, pro: 140, fat: 50 },
                '2026-08-08': { date: '2026-08-08', kcal: 2500, carbs: 250, pro: 160, fat: 60 },
                '2026-08-15': { date: '2026-08-15', kcal: 2800, carbs: 300, pro: 180, fat: 70 }
            };

            const result = computeVolumeCaloriesCorrelation(history, nutrition, mockLibrary, 80, 4, refDate);
            expect(result.points).toHaveLength(4);
            expect(result.stats.hasData).toBe(true);
            expect(result.stats.correlationCoefficient).not.toBeNull();
            expect(result.stats.correlationInsight).toMatch(/associazione/i);
        });
    });
});
