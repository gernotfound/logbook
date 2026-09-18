import { describe, it, expect } from 'vitest';
import {
    computeWeeklyVolumeSeries,
    computeWeeklyNutritionSeries,
    computeVolumeCaloriesCorrelation,
    calculatePearsonCorrelation,
    generateWeekIntervals,
    getWorkoutDateString
} from './analytics';
import { getLocalDateString } from '../utils/date';
import type { WorkoutSession, Exercise, NutritionDay } from '../../types';

describe('Analytics Engine 4-Tier Test Suite (src/lib/calc/analytics.ts)', () => {

    const mockLibrary: Exercise[] = [
        { id: 'ex_bench', name: 'Panca piana', muscles: ['petto'], trackingType: 'weight_reps', setsCount: 3, sets: [] },
        { id: 'ex_squat', name: 'Squat con bilanciere', muscles: ['quadricipiti'], trackingType: 'weight_reps', equipmentWeight: 20, setsCount: 3, sets: [] },
        { id: 'ex_pullup', name: 'Trazioni alla sbarra', muscles: ['dorso'], trackingType: 'weight_reps', isBodyweight: true, setsCount: 3, sets: [] },
        { id: 'ex_dips', name: 'Dip alle parallele', muscles: ['petto', 'tricipiti'], trackingType: 'weight_reps', isBodyweight: true, equipmentWeight: 0, setsCount: 3, sets: [] },
        { id: 'ex_plank', name: 'Plank addominale', muscles: ['addome'], trackingType: 'time', setsCount: 3, sets: [] },
        { id: 'ex_run', name: 'Corsa tapis roulant', muscles: ['gambe'], trackingType: 'cardio', setsCount: 1, sets: [] }
    ];

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
                expect(stats.correlationInsight).toContain('Forte correlazione positiva');
            });
        });
    });

    describe('Tier 2: Boundary & Corner Cases', () => {
        describe('2.1 Empty & Null Data Handling', () => {
            it('T2.1_empty_history: empty history returns all zeros and hasData: false', () => {
                const { points, stats } = computeWeeklyVolumeSeries([], mockLibrary, 80, 8, '2026-08-22');
                expect(points).toHaveLength(8);
                expect(points.every(p => p.volumeKg === 0 && p.workoutCount === 0)).toBe(true);
                expect(stats.hasData).toBe(false);
                expect(stats.totalVolumeKg).toBe(0);
            });

            it('T2.2_null_history: null or undefined history handled defensively', () => {
                const { points, stats } = computeWeeklyVolumeSeries(null as any, mockLibrary, 80, 4, '2026-08-22');
                expect(points).toHaveLength(4);
                expect(stats.hasData).toBe(false);
            });

            it('T2.3_empty_nutrition: empty nutrition returns zeros and hasData: false', () => {
                const { points, stats } = computeWeeklyNutritionSeries({}, 8, '2026-08-22');
                expect(points).toHaveLength(8);
                expect(points.every(p => p.avgDailyKcal === 0 && p.loggedDaysCount === 0)).toBe(true);
                expect(stats.hasData).toBe(false);
                expect(stats.avgDailyKcalOverall).toBe(0);
            });

            it('T2.4_invalid_num_weeks: falls back to default 8 for numWeeks <= 0 and clamps to 52 for > 52', () => {
                const minIntervals = generateWeekIntervals(0, '2026-08-22');
                expect(minIntervals).toHaveLength(8);
                const maxIntervals = generateWeekIntervals(100, '2026-08-22');
                expect(maxIntervals).toHaveLength(52);
            });

            it('T2.5_invalid_ref_date: handles invalid reference date gracefully', () => {
                const intervals = generateWeekIntervals(4, 'invalid-date-string');
                expect(intervals).toHaveLength(4);
            });
        });

        describe('2.2 Numeric Boundaries, Strings & Negative Values', () => {
            it('T2.6_zero_reps_weight: 0 reps or 0 kg results in 0 volume', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_zero',
                    date: '2026-08-18',
                    exercises: [{
                        exId: 'ex_bench',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '0', reps: '10' }, { id: 's2', kg: '100', reps: '0' }, { id: 's3', kg: '0', reps: '0' }]
                    }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(0);
            });

            it('T2.7_comma_decimal: parses comma decimal notation correctly', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_comma',
                    date: '2026-08-18',
                    exercises: [{
                        exId: 'ex_bench',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '12,5', reps: '10' }]
                    }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(125);
            });

            it('T2.8_negative_values: calculates mechanical volume faithfully even with negative numeric edge inputs', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_neg',
                    date: '2026-08-18',
                    exercises: [{
                        exId: 'ex_bench',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '-50', reps: '10' }]
                    }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(-500);
            });

            it('T2.9_nan_strings: non-numeric strings handled without NaN', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_nan',
                    date: '2026-08-18',
                    exercises: [{
                        exId: 'ex_bench',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: 'abc', reps: 'xyz' }]
                    }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(0);
                expect(isNaN(points[points.length - 1].volumeKg)).toBe(false);
            });
        });

        describe('2.3 Dropsets Accumulation', () => {
            it('T2.10_single_dropset: adds single dropset volume to main set volume', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_ds',
                    date: '2026-08-18',
                    exercises: [{
                        exId: 'ex_bench',
                        sessionNote: '',
                        sets: [{
                            id: 's1',
                            kg: '100',
                            reps: '10',
                            dropsets: [{ id: 'ds1', kg: '70', reps: '8' }]
                        }]
                    }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(1560);
            });

            it('T2.11_multiple_dropsets: aggregates triple dropset within a set', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_triple_ds',
                    date: '2026-08-18',
                    exercises: [{
                        exId: 'ex_bench',
                        sessionNote: '',
                        sets: [{
                            id: 's1',
                            kg: '100',
                            reps: '10',
                            dropsets: [
                                { id: 'ds1', kg: '80', reps: '8' },
                                { id: 'ds2', kg: '60', reps: '8' },
                                { id: 'ds3', kg: '40', reps: '10' }
                            ]
                        }]
                    }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(2520);
            });

            it('T2.12_dropset_bodyweight: factors user weight into dropsets for bodyweight exercises', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_dips_ds',
                    date: '2026-08-18',
                    exercises: [{
                        exId: 'ex_dips',
                        sessionNote: '',
                        sets: [{
                            id: 's1',
                            kg: '20',
                            reps: '10',
                            dropsets: [{ id: 'ds1', kg: '0', reps: '8' }]
                        }]
                    }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(1640);
            });
        });

        describe('2.4 Non-Weight Tracking Types (Cardio & Time)', () => {
            it('T2.13_cardio_zero_tonnage: cardio tracking type produces 0 tonnage volume', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_cardio',
                    date: '2026-08-18',
                    exercises: [{
                        exId: 'ex_run',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '0', reps: '0', time: '1800', distance: '5000', speed: '10', kcal: '350' }]
                    }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(0);
            });

            it('T2.14_time_zero_tonnage: isometric time tracking type produces 0 tonnage volume', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_time',
                    date: '2026-08-18',
                    exercises: [{
                        exId: 'ex_plank',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '0', reps: '0', time: '60' }, { id: 's2', kg: '0', reps: '0', time: '60' }, { id: 's3', kg: '0', reps: '0', time: '60' }]
                    }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(0);
            });

            it('T2.15_mixed_routine_tonnage: accurately separates weight volume from cardio/time in same workout', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_mixed',
                    date: '2026-08-18',
                    exercises: [
                        { exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] },
                        { exId: 'ex_plank', sessionNote: '', sets: [{ id: 's2', kg: '0', reps: '0', time: '60' }] },
                        { exId: 'ex_run', sessionNote: '', sets: [{ id: 's3', kg: '0', reps: '0', time: '1200', distance: '3000' }] }
                    ]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(1000);
            });
        });

        describe('2.5 Calendar Transitions & Leap Years', () => {
            it('T2.16_cross_month_week: handles week spanning month boundary (26 Jan - 1 Feb 2026)', () => {
                const history: WorkoutSession[] = [
                    { id: 'w_jan', date: '2026-01-28', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
                    { id: 'w_feb', date: '2026-02-01', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '100', reps: '10' }] }] }
                ];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-02-01');
                const targetWeek = points.find(p => p.weekStart === '2026-01-26' && p.weekEnd === '2026-02-01');
                expect(targetWeek).toBeDefined();
                expect(targetWeek?.volumeKg).toBe(2000);
                expect(targetWeek?.workoutCount).toBe(2);
            });

            it('T2.17_cross_year_week: handles week spanning year boundary (29 Dec 2025 - 4 Jan 2026)', () => {
                const history: WorkoutSession[] = [
                    { id: 'w_2025', date: '2025-12-30', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
                    { id: 'w_2026', date: '2026-01-02', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '100', reps: '10' }] }] }
                ];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-01-04');
                const targetWeek = points.find(p => p.weekStart === '2025-12-29' && p.weekEnd === '2026-01-04');
                expect(targetWeek).toBeDefined();
                expect(targetWeek?.volumeKg).toBe(2000);
                expect(targetWeek?.workoutCount).toBe(2);
            });

            it('T2.18_leap_year_transition: handles leap year Feb 29 (2024-02-29) smoothly', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_leap',
                    date: '2024-02-29',
                    exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2024-03-01');
                const leapWeek = points.find(p => p.weekStart <= '2024-02-29' && p.weekEnd >= '2024-02-29');
                expect(leapWeek).toBeDefined();
                expect(leapWeek?.volumeKg).toBe(1000);
            });

            it('T2.19_timestamp_fallback: resolves workout date from globalStartTime timestamp if date is missing', () => {
                expect(getWorkoutDateString({ date: '2026-08-18' } as any)).toBe('2026-08-18');
                const workoutTimestamp = new Date('2026-08-18T10:00:00').getTime();
                const history: WorkoutSession[] = [{
                    id: 'w_ts',
                    globalStartTime: workoutTimestamp,
                    exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(1000);
            });
        });
    });

    describe('Tier 3: Cross-Feature Combinations & State Sync', () => {
        it('T3.1_workouts_without_nutrition: handles workouts when no nutrition is logged', () => {
            const history: WorkoutSession[] = [{
                id: 'w1',
                date: '2026-08-18',
                exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }]
            }];
            const nutrition = {};
            const { points, stats } = computeVolumeCaloriesCorrelation(history, nutrition, mockLibrary, 80, 4, '2026-08-22');
            const currWeek = points[points.length - 1];
            expect(currWeek.volumeKg).toBe(1000);
            expect(currWeek.avgDailyKcal).toBe(0);
            expect(stats.validDataPointsCount).toBe(0);
        });

        it('T3.2_nutrition_without_workouts: handles nutrition on rest days without workouts', () => {
            const history: WorkoutSession[] = [];
            const nutrition: Record<string, NutritionDay> = {
                '2026-08-18': { date: '2026-08-18', kcal: 2500, carbs: 0, pro: 0, fat: 0 }
            };
            const { points, stats } = computeVolumeCaloriesCorrelation(history, nutrition, mockLibrary, 80, 4, '2026-08-22');
            const currWeek = points[points.length - 1];
            expect(currWeek.volumeKg).toBe(0);
            expect(currWeek.avgDailyKcal).toBe(2500);
            expect(stats.validDataPointsCount).toBe(0);
        });

        it('T3.3_sparse_synchronized_weeks: synchronizes weeks with mixed training and nutrition density', () => {
            const history: WorkoutSession[] = [
                { id: 'w1', date: '2026-08-04', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
                { id: 'w3', date: '2026-08-18', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '100', reps: '30' }] }] }
            ];
            const nutrition: Record<string, NutritionDay> = {
                '2026-08-11': { date: '2026-08-11', kcal: 2400, carbs: 0, pro: 0, fat: 0 },
                '2026-08-18': { date: '2026-08-18', kcal: 3000, carbs: 0, pro: 0, fat: 0 }
            };
            const { points, stats } = computeVolumeCaloriesCorrelation(history, nutrition, mockLibrary, 80, 4, '2026-08-22');
            expect(points[points.length - 3].volumeKg).toBe(1000);
            expect(points[points.length - 3].avgDailyKcal).toBe(0);
            expect(points[points.length - 2].volumeKg).toBe(0);
            expect(points[points.length - 2].avgDailyKcal).toBe(2400);
            expect(points[points.length - 1].volumeKg).toBe(3000);
            expect(points[points.length - 1].avgDailyKcal).toBe(3000);
            expect(stats.validDataPointsCount).toBe(1);
        });

        it('T3.4_multi_session_same_day: sums volume of multiple sessions on same day', () => {
            const history: WorkoutSession[] = [
                { id: 'w_morning', date: '2026-08-18', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '10' }] }] },
                { id: 'w_evening', date: '2026-08-18', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '80', reps: '10' }] }] }
            ];
            const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
            expect(points[points.length - 1].volumeKg).toBe(1600);
            expect(points[points.length - 1].workoutCount).toBe(2);
        });

        it('T3.5_zero_variance_pearson: returns 0 or null for constant series in Pearson correlation without NaN', () => {
            const x = [2000, 2000, 2000];
            const y = [2500, 2500, 2500];
            const r = calculatePearsonCorrelation(x, y);
            expect(r).toBe(0);
            expect(isNaN(r as any)).toBe(false);
        });
    });

    describe('Tier 4: Real-World Application Workloads', () => {
        it('T4.1_hypertrophy_mesocycle: 12-week progressive overload with caloric surplus', () => {
            const history: WorkoutSession[] = [];
            const nutrition: Record<string, NutritionDay> = {};
            const startDate = new Date(2026, 5, 1, 12);

            for (let week = 0; week < 12; week++) {
                const weekStart = new Date(startDate.getTime() + week * 7 * 24 * 60 * 60 * 1000);
                const baseReps = String(10 + week * 2);
                for (let d = 0; d < 3; d++) {
                    const sessionDate = new Date(weekStart.getTime() + d * 2 * 24 * 60 * 60 * 1000);
                    const dateStr = getLocalDateString(sessionDate);
                    history.push({
                        id: 'w_w' + week + '_d' + d,
                        date: dateStr,
                        routineName: 'Hypertrophy Full Body',
                        exercises: [
                            { exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: baseReps }, { id: 's2', kg: '100', reps: baseReps }] },
                            { exId: 'ex_squat', sessionNote: '', sets: [{ id: 's3', kg: '100', reps: baseReps }, { id: 's4', kg: '100', reps: baseReps }] }
                        ]
                    });
                }
                for (let day = 0; day < 7; day++) {
                    const nutritionDate = new Date(weekStart.getTime() + day * 24 * 60 * 60 * 1000);
                    const dateStr = getLocalDateString(nutritionDate);
                    nutrition[dateStr] = {
                        date: dateStr,
                        kcal: 2800 + week * 50,
                        pro: 180,
                        carbs: 350 + week * 10,
                        fat: 80
                    };
                }
            }
            const { points, stats } = computeVolumeCaloriesCorrelation(history, nutrition, mockLibrary, 80, 12, '2026-08-23');
            expect(points).toHaveLength(12);
            expect(points[0].volumeKg).toBeLessThan(points[11].volumeKg);
            expect(points[0].avgDailyKcal).toBeLessThan(points[11].avgDailyKcal);
            expect(stats.validDataPointsCount).toBe(12);
            expect(stats.correlationCoefficient).toBeGreaterThanOrEqual(0.9);
            expect(stats.correlationInsight).toContain('Forte correlazione positiva');
        });

        it('T4.2_cutting_phase: 8-week cutting phase with dynamic bodyweight decay and caloric deficit', () => {
            const history: WorkoutSession[] = [];
            const nutrition: Record<string, NutritionDay> = {};
            const startDate = new Date(2026, 5, 29, 12);

            for (let week = 0; week < 8; week++) {
                const weekStart = new Date(startDate.getTime() + week * 7 * 24 * 60 * 60 * 1000);
                const currentWeight = 85 - (week * 0.8);
                const sessionDate = new Date(weekStart.getTime() + 24 * 60 * 60 * 1000);
                const dateStr = getLocalDateString(sessionDate);
                history.push({
                    id: 'w_cut_' + week,
                    date: dateStr,
                    exercises: [
                        { exId: 'ex_pullup', sessionNote: '', sets: [{ id: 's1', kg: '0', reps: '10' }, { id: 's2', kg: '0', reps: '10' }] }
                    ]
                });
                for (let d = 0; d < 7; d++) {
                    const nDate = new Date(weekStart.getTime() + d * 24 * 60 * 60 * 1000);
                    const nStr = getLocalDateString(nDate);
                    nutrition[nStr] = {
                        date: nStr,
                        kcal: Math.round(2300 - week * 50),
                        carbs: 0,
                        pro: 0,
                        fat: 0,
                        weight: currentWeight
                    };
                }
            }
            const { points, stats } = computeVolumeCaloriesCorrelation(history, nutrition, mockLibrary, 80, 8, '2026-08-23');
            expect(points).toHaveLength(8);
            expect(stats.validDataPointsCount).toBe(8);
            expect(stats.avgDailyKcal).toBeLessThan(2300);
        });

        it('T4.3_deload_vacation_workload: 2-week deload with 0 volume followed by recovery block', () => {
            const history: WorkoutSession[] = [
                { id: 'w1', date: '2026-08-03', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
                { id: 'w4', date: '2026-08-24', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '80', reps: '10' }] }] }
            ];
            const { points, stats } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-24');
            expect(points).toHaveLength(4);
            expect(points[0].volumeKg).toBe(1000);
            expect(points[1].volumeKg).toBe(0);
            expect(points[2].volumeKg).toBe(0);
            expect(points[3].volumeKg).toBe(800);
            expect(stats.activeWeeksCount).toBe(2);
            expect(stats.totalVolumeKg).toBe(1800);
        });
    });
});