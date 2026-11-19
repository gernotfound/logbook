import { describe, it, expect } from 'vitest';
import {
    computeWeeklyVolumeSeries,
    computeWeeklyNutritionSeries,
    computeVolumeCaloriesCorrelation,
    calculatePearsonCorrelation,
    generateWeekIntervals,
} from './analytics';
import type { WorkoutSession, NutritionDay } from '../../types';
import { mockLibrary } from './analyticsFixtures';

describe('Analytics Engine 4-Tier Test Suite (src/lib/calc/analytics.ts)', () => {
    describe('Tier 1: Feature Coverage (Core Happy Paths)', () => {

        describe('1.1 generateWeekIntervals', () => {
            it('T1.1_generate_weeks: generates exactly numWeeks intervals (default 8)', () => {
                const intervals = generateWeekIntervals(8, '2026-08-22');
                expect(intervals).toHaveLength(8);
                expect(intervals[0].weekIndex).toBe(0);
                expect(intervals[7].weekIndex).toBe(7);
            });

            it('T1.2_generate_weeks: sets Monday as weekStart and Sunday as weekEnd', () => {
                const intervals = generateWeekIntervals(4, '2026-08-22');
                intervals.forEach(interval => {
                    const startD = new Date(interval.weekStart + 'T12:00:00Z').getUTCDay();
                    const endD = new Date(interval.weekEnd + 'T12:00:00Z').getUTCDay();
                    expect(startD).toBe(1);
                    expect(endD).toBe(0);
                });
            });

            it('T1.3_generate_weeks: produces continuous consecutive weekly intervals without gaps', () => {
                const intervals = generateWeekIntervals(6, '2026-08-22');
                for (let i = 0; i < intervals.length - 1; i++) {
                    const currentEnd = new Date(intervals[i].weekEnd + 'T00:00:00Z').getTime();
                    const nextStart = new Date(intervals[i + 1].weekStart + 'T00:00:00Z').getTime();
                    const diffDays = Math.round((nextStart - currentEnd) / (1000 * 60 * 60 * 24));
                    expect(diffDays).toBe(1);
                }
            });

            it('T1.4_generate_weeks: formats labels in Italian for <=12 weeks', () => {
                const intervals = generateWeekIntervals(8, '2026-08-22');
                expect(intervals[intervals.length - 1].label).toBeDefined();
                expect(typeof intervals[intervals.length - 1].label).toBe('string');
            });

            it('T1.5_generate_weeks: formats labels as dd/MM for >12 weeks', () => {
                const intervals = generateWeekIntervals(24, '2026-08-22');
                expect(intervals).toHaveLength(24);
                expect(intervals[0].label).toMatch(/^\d{2}\/\d{2}$/);
            });
        });

        describe('1.2 computeWeeklyVolumeSeries', () => {
            it('T1.6_volume_single: calculates single workout volume in a single week correctly', () => {
                const history: WorkoutSession[] = [{
                    id: 'w1',
                    date: '2026-08-18',
                    routineName: 'Upper A',
                    exercises: [{
                        exId: 'ex_bench',
                        sessionNote: '',
                        sets: [
                            { id: 's1', kg: '80', reps: '10' },
                            { id: 's2', kg: '80', reps: '10' },
                            { id: 's3', kg: '80', reps: '10' }
                        ]
                    }]
                }];
                const { points, stats } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                const lastWeek = points[points.length - 1];
                expect(lastWeek.volumeKg).toBe(2400);
                expect(lastWeek.volumeTon).toBe(2.4);
                expect(lastWeek.workoutCount).toBe(1);
                expect(lastWeek.sessionIds).toContain('w1');
                expect(stats.totalVolumeKg).toBe(2400);
                expect(stats.currentWeekVolumeKg).toBe(2400);
            });

            it('T1.7_volume_multi_session: aggregates multiple workouts within the same week', () => {
                const history: WorkoutSession[] = [
                    {
                        id: 'w1',
                        date: '2026-08-17',
                        routineName: 'Upper A',
                        exercises: [{
                            exId: 'ex_bench',
                            sessionNote: '',
                            sets: [
                                { id: 's1', kg: '80', reps: '10' },
                                { id: 's2', kg: '80', reps: '10' },
                                { id: 's3', kg: '80', reps: '10' }
                            ]
                        }]
                    },
                    {
                        id: 'w2',
                        date: '2026-08-19',
                        routineName: 'Lower A',
                        exercises: [{
                            exId: 'ex_squat',
                            sessionNote: '',
                            sets: [
                                { id: 's4', kg: '80', reps: '5' },
                                { id: 's5', kg: '80', reps: '5' },
                                { id: 's6', kg: '80', reps: '5' },
                                { id: 's7', kg: '80', reps: '5' },
                                { id: 's8', kg: '80', reps: '5' }
                            ]
                        }]
                    }
                ];
                const { points, stats } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                const lastWeek = points[points.length - 1];
                expect(lastWeek.volumeKg).toBe(4900);
                expect(lastWeek.volumeTon).toBe(4.9);
                expect(lastWeek.workoutCount).toBe(2);
                expect(stats.totalVolumeKg).toBe(4900);
                expect(stats.totalWorkouts).toBe(2);
            });

            it('T1.8_volume_multi_week: aggregates workouts across multiple distinct weeks', () => {
                const history: WorkoutSession[] = [
                    {
                        id: 'w_prev',
                        date: '2026-08-11',
                        routineName: 'Full Body',
                        exercises: [{
                            exId: 'ex_bench',
                            sessionNote: '',
                            sets: [
                                { id: 's1', kg: '100', reps: '10' },
                                { id: 's2', kg: '100', reps: '10' }
                            ]
                        }]
                    },
                    {
                        id: 'w_curr',
                        date: '2026-08-18',
                        routineName: 'Full Body',
                        exercises: [{
                            exId: 'ex_bench',
                            sessionNote: '',
                            sets: [
                                { id: 's3', kg: '100', reps: '10' },
                                { id: 's4', kg: '100', reps: '10' }
                            ]
                        }]
                    }
                ];
                const { points, stats } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 2].volumeKg).toBe(2000);
                expect(points[points.length - 1].volumeKg).toBe(2000);
                expect(stats.currentWeekVolumeKg).toBe(2000);
                expect(stats.previousWeekVolumeKg).toBe(2000);
            });

            it('T1.9_volume_bodyweight: calculates bodyweight exercises with user weight inclusion', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_bw',
                    date: '2026-08-18',
                    routineName: 'Pull',
                    exercises: [{
                        exId: 'ex_pullup',
                        sessionNote: '',
                        sets: [
                            { id: 's1', kg: '10', reps: '8' },
                            { id: 's2', kg: '10', reps: '8' }
                        ]
                    }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 75, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(1360);
            });

            it('T1.10_volume_equipment: calculates equipment tare weight correctly in mechanical volume', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_eq',
                    date: '2026-08-18',
                    routineName: 'Legs',
                    exercises: [{
                        exId: 'ex_squat',
                        sessionNote: '',
                        sets: [
                            { id: 's1', kg: '60', reps: '10' },
                            { id: 's2', kg: '60', reps: '10' }
                        ]
                    }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(1600);
            });
        });

        describe('1.3 computeWeeklyNutritionSeries', () => {
            it('T1.11_nutrition_daily: aggregates daily calories from nutrition days across weeks', () => {
                const nutrition: Record<string, NutritionDay> = {
                    '2026-08-17': { date: '2026-08-17', kcal: 2500, pro: 160, carbs: 300, fat: 70 },
                    '2026-08-18': { date: '2026-08-18', kcal: 2600, pro: 165, carbs: 310, fat: 72 },
                    '2026-08-19': { date: '2026-08-19', kcal: 2400, pro: 155, carbs: 290, fat: 68 }
                };
                const { points, stats } = computeWeeklyNutritionSeries(nutrition, 4, '2026-08-22');
                const currWeek = points[points.length - 1];
                expect(currWeek.totalKcal).toBe(7500);
                expect(currWeek.loggedDaysCount).toBe(3);
                expect(currWeek.avgDailyKcal).toBe(2500);
                expect(stats.avgDailyKcalOverall).toBe(2500);
                expect(stats.hasData).toBe(true);
            });

            it('T1.12_nutrition_avg_kcal: computes weekly average daily calories accurately', () => {
                const nutrition: Record<string, NutritionDay> = {
                    '2026-08-17': { date: '2026-08-17', kcal: 2000, carbs: 0, pro: 0, fat: 0 },
                    '2026-08-18': { date: '2026-08-18', kcal: 3000, carbs: 0, pro: 0, fat: 0 }
                };
                const { points } = computeWeeklyNutritionSeries(nutrition, 4, '2026-08-22');
                expect(points[points.length - 1].avgDailyKcal).toBe(2500);
                expect(points[points.length - 1].loggedDaysCount).toBe(2);
            });

            it('T1.13_nutrition_macros: computes average macronutrients per week', () => {
                const nutrition: Record<string, NutritionDay> = {
                    '2026-08-17': { date: '2026-08-17', kcal: 2400, pro: 160, carbs: 300, fat: 60 },
                    '2026-08-18': { date: '2026-08-18', kcal: 2600, pro: 180, carbs: 320, fat: 70 }
                };
                const { points } = computeWeeklyNutritionSeries(nutrition, 4, '2026-08-22');
                expect(points[points.length - 1].avgPro).toBe(170);
                expect(points[points.length - 1].avgCarbs).toBe(310);
                expect(points[points.length - 1].avgFat).toBe(65);
            });

            it('T1.14_nutrition_empty_week: returns 0 average calories for weeks with 0 logged days', () => {
                const nutrition: Record<string, NutritionDay> = { '2026-08-10': { date: '2026-08-10', kcal: 2500, carbs: 0, pro: 0, fat: 0 } };
                const { points } = computeWeeklyNutritionSeries(nutrition, 4, '2026-08-22');
                expect(points[points.length - 1].avgDailyKcal).toBe(0);
                expect(points[points.length - 1].totalKcal).toBe(0);
                expect(points[points.length - 1].loggedDaysCount).toBe(0);
            });
        });

        it('excludes future meal entries from a current-week snapshot', () => {
            const nutrition: Record<string, NutritionDay> = {
                '2026-08-17': { date: '2026-08-17', kcal: 2000, carbs: 200, pro: 100, fat: 50 },
                '2026-08-19': { date: '2026-08-19', kcal: 5000, carbs: 500, pro: 200, fat: 100 },
            };
            const now = computeWeeklyNutritionSeries(nutrition, 1, '2026-08-18');
            expect(now.points[0]).toMatchObject({
                loggedDaysCount: 1, totalKcal: 2000, avgDailyKcal: 2000, avgCarbs: 200,
            });
            const later = computeWeeklyNutritionSeries(nutrition, 1, '2026-08-20');
            expect(later.points[0]).toMatchObject({ loggedDaysCount: 2, totalKcal: 7000, avgDailyKcal: 3500 });
        });

        describe('1.4 computeVolumeCaloriesCorrelation', () => {
            it('T1.15_correlation_sync: synchronizes volume and calories on identical weekly intervals', () => {
                const history: WorkoutSession[] = [
                    { id: 'w1', date: '2026-08-11', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
                    { id: 'w2', date: '2026-08-18', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '100', reps: '20' }] }] }
                ];
                const nutrition: Record<string, NutritionDay> = {
                    '2026-08-11': { date: '2026-08-11', kcal: 2400, carbs: 0, pro: 0, fat: 0 },
                    '2026-08-18': { date: '2026-08-18', kcal: 2800, carbs: 0, pro: 0, fat: 0 }
                };
                const { points, stats } = computeVolumeCaloriesCorrelation(history, nutrition, mockLibrary, 80, 4, '2026-08-22');
                expect(points).toHaveLength(4);
                expect(points[points.length - 2].volumeKg).toBe(1000);
                expect(points[points.length - 2].avgDailyKcal).toBe(2400);
                expect(points[points.length - 1].volumeKg).toBe(2000);
                expect(points[points.length - 1].avgDailyKcal).toBe(2800);
                expect(stats.hasData).toBe(true);
            });

            it('T1.16_correlation_pearson: computes Pearson correlation coefficient correctly for linear trend', () => {
                const x = [1000, 2000, 3000, 4000];
                const y = [2000, 2500, 3000, 3500];
                const r = calculatePearsonCorrelation(x, y);
                expect(r).toBe(1);
            });

            it('T1.17_correlation_insights: generates Italian sentence case insights based on r thresholds', () => {
                const history: WorkoutSession[] = [
                    { id: 'w1', date: '2026-08-04', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
                    { id: 'w2', date: '2026-08-11', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '100', reps: '20' }] }] },
                    { id: 'w3', date: '2026-08-18', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's3', kg: '100', reps: '30' }] }] }
                ];
                const nutrition: Record<string, NutritionDay> = {
                    '2026-08-04': { date: '2026-08-04', kcal: 2000, carbs: 0, pro: 0, fat: 0 },
                    '2026-08-11': { date: '2026-08-11', kcal: 2500, carbs: 0, pro: 0, fat: 0 },
                    '2026-08-18': { date: '2026-08-18', kcal: 3000, carbs: 0, pro: 0, fat: 0 }
                };
                const { stats } = computeVolumeCaloriesCorrelation(history, nutrition, mockLibrary, 80, 4, '2026-08-22');
                expect(stats.correlationCoefficient).toBe(1);
                expect(stats.correlationInsight).toContain('Associazione positiva forte');
            });
        });
    });
});
