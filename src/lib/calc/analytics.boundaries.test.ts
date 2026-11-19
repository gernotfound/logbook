import { describe, it, expect } from 'vitest';
import {
    computeWeeklyVolumeSeries,
    computeWeeklyVolumeSeriesCooperative,
    computeWeeklyNutritionSeries,
    computeVolumeCaloriesCorrelation,
    generateWeekIntervals,
    getWorkoutDateString,
} from './analytics';
import { calculateWorkoutVolume } from './workout';
import type { WorkoutSession, NutritionDay } from '../../types';
import { mockLibrary } from './analyticsFixtures';

describe('Analytics Engine 4-Tier Test Suite (src/lib/calc/analytics.ts)', () => {
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

        it('T2.9b: omits overflowing set volume while retaining valid sessions and worker parity', async () => {
            const history: WorkoutSession[] = [
                { id: 'overflow', date: '2026-08-18', exercises: [{
                    exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '1e308', reps: '10' }],
                }] },
                { id: 'valid', date: '2026-08-18', exercises: [{
                    exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '80', reps: '10' }],
                }] },
            ];
            // Do not change the low-level calculator's existing mathematical contract.
            expect(calculateWorkoutVolume(history[0], mockLibrary, 80)).toBe(Infinity);
            const result = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
            expect(result.points.at(-1)).toMatchObject({
                volumeKg: 800, workoutCount: 2, sessionIds: ['overflow', 'valid'],
            });
            expect(result.stats.totalVolumeKg).toBe(800);
            expect(result.stats.avgWeeklyVolumeKg).toBe(200);
            expect(await computeWeeklyVolumeSeriesCooperative(history, mockLibrary, 80, 4, '2026-08-22'))
                .toEqual(result);

            const nutrition: Record<string, NutritionDay> = {
                '2026-08-18': { date: '2026-08-18', kcal: 2400, carbs: 300, pro: 150, fat: 70 },
            };
            const correlation = computeVolumeCaloriesCorrelation(history, nutrition, mockLibrary, 80, 4, '2026-08-22');
            expect(correlation.points.at(-1)?.volumeKg).toBe(800);
            expect(Number.isFinite(correlation.stats.avgWeeklyVolumeKg)).toBe(true);
        });

        it('T2.9c: bounds weekly and cross-week sums when finite inputs would overflow', () => {
            const bigSession = (id: string, date: string): WorkoutSession => ({
                id, date, exercises: [{
                    exId: 'ex_bench', sessionNote: '', sets: [{ id: `set-${id}`, kg: '1e307', reps: '10' }],
                }],
            });
            const sameWeek = computeWeeklyVolumeSeries([
                bigSession('a', '2026-08-18'), bigSession('b', '2026-08-19'),
            ], mockLibrary, 80, 4, '2026-08-22');
            expect(Number.isFinite(sameWeek.points.at(-1)!.volumeKg)).toBe(true);
            expect(sameWeek.points.at(-1)!.workoutCount).toBe(2);
            expect(Number.isFinite(sameWeek.stats.totalVolumeKg)).toBe(true);

            const acrossWeeks = computeWeeklyVolumeSeries([
                bigSession('a', '2026-08-11'), bigSession('b', '2026-08-18'),
            ], mockLibrary, 80, 4, '2026-08-22');
            expect(acrossWeeks.points.every(p => Number.isFinite(p.volumeKg) && Number.isFinite(p.volumeTon)))
                .toBe(true);
            expect(Number.isFinite(acrossWeeks.stats.totalVolumeKg)).toBe(true);
            expect(Number.isFinite(acrossWeeks.stats.avgWeeklyVolumeKg)).toBe(true);
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
                            segments: [{ technique: 'dropset' as const, id: 'ds1', kg: '70', reps: '8' }]
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
                            segments: [
                                { technique: 'dropset' as const, id: 'ds1', kg: '80', reps: '8' },
                                { technique: 'dropset' as const, id: 'ds2', kg: '60', reps: '8' },
                                { technique: 'dropset' as const, id: 'ds3', kg: '40', reps: '10' }
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
                            segments: [{ technique: 'dropset' as const, id: 'ds1', kg: '0', reps: '8' }]
                        }]
                    }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(1640);
            });
        });

        it('excludes future-dated workout history from a current-week snapshot', () => {
            const history: WorkoutSession[] = [
                { id: 'completed', date: '2026-08-17', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
                { id: 'future', date: '2026-08-19', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '200', reps: '10' }] }] },
            ];
            const now = computeWeeklyVolumeSeries(history, mockLibrary, 80, 1, '2026-08-18');
            expect(now.points[0]).toMatchObject({ volumeKg: 1000, workoutCount: 1, sessionIds: ['completed'] });
            const later = computeWeeklyVolumeSeries(history, mockLibrary, 80, 1, '2026-08-20');
            expect(later.points[0]).toMatchObject({ volumeKg: 3000, workoutCount: 2, sessionIds: ['completed', 'future'] });
        });

        describe('2.4 Non-Weight Tracking Types (Cardio & Time)', () => {
            it('T2.13_cardio_zero_tonnage: cardio numeric set fields never produce mechanical tonnage', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_cardio',
                    date: '2026-08-18',
                    exercises: [{
                        exId: 'ex_run',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '120', reps: '12', time: '1800', distance: '5000', speed: '10', kcal: '350' }]
                    }]
                }];
                const { points } = computeWeeklyVolumeSeries(history, mockLibrary, 80, 4, '2026-08-22');
                expect(points[points.length - 1].volumeKg).toBe(0);
            });

            it('T2.14_time_zero_tonnage: timed numeric set fields never produce mechanical tonnage', () => {
                const history: WorkoutSession[] = [{
                    id: 'w_time',
                    date: '2026-08-18',
                    exercises: [{
                        exId: 'ex_plank',
                        sessionNote: '',
                        sets: [{ id: 's1', kg: '25', reps: '3', time: '60' }, { id: 's2', kg: '25', reps: '3', time: '60' }, { id: 's3', kg: '25', reps: '3', time: '60' }]
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
                        { exId: 'ex_plank', sessionNote: '', sets: [{ id: 's2', kg: '60', reps: '10', time: '60' }] },
                        { exId: 'ex_run', sessionNote: '', sets: [{ id: 's3', kg: '100', reps: '10', time: '1200', distance: '3000' }] }
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
});
