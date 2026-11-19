import { describe, it, expect } from 'vitest';
import {
    computeWeeklyVolumeSeries,
    computeVolumeCaloriesCorrelation,
    computeWeeklyWeightSeries,
    computeReadinessTrends,
    computeWeeklyTrainingActivityContext,
    calculatePearsonCorrelation,
} from './analytics';
import { getLocalDateString } from '../utils/date';
import { getLatestUserWeight } from './workout';
import type { WorkoutSession, NutritionDay } from '../../types';
import { mockLibrary } from './analyticsFixtures';

describe('Analytics Engine 4-Tier Test Suite (src/lib/calc/analytics.ts)', () => {
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
            expect(stats.correlationInsight).toContain('Associazione positiva forte');
        });

        it('T4.2_cutting_phase: historical weigh-ins do not change tonnage based on the selected current bodyweight', () => {
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
            // Each week: 20 repetitions at the supplied 80 kg, regardless of weigh-ins.
            expect(points.map(point => point.volumeKg)).toEqual(Array(8).fill(1600));
            expect(points.map(point => point.avgDailyKcal)).toEqual([2300, 2250, 2200, 2150, 2100, 2050, 2000, 1950]);
            expect(stats.validDataPointsCount).toBe(8);
            expect(stats.correlationCoefficient).toBe(0);
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
        it('T4.4_weekly_weight_mean: averages only recorded days and exposes coverage', () => {
            const nutrition: Record<string, NutritionDay> = {
                '2026-08-17': { date: '2026-08-17', weight: 80, kcal: 0, carbs: 0, pro: 0, fat: 0 },
                '2026-08-19': { date: '2026-08-19', weight: 81, kcal: 0, carbs: 0, pro: 0, fat: 0 },
                '2026-08-21': { date: '2026-08-21', weight: 82, kcal: 0, carbs: 0, pro: 0, fat: 0 },
            };
            const result = computeWeeklyWeightSeries(nutrition, 1, '2026-08-23');
            expect(result.points[0].averageWeightKg).toBe(81);
            expect(result.points[0].recordedDaysCount).toBe(3);
            expect(result.points[0].daysConsidered).toBe(7);
            expect(result.stats.latestAverageWeightKg).toBe(81);
            expect(result.stats.latestRecordedDaysCount).toBe(3);
        });

        it('T4.5_readiness_dimensions: keeps readiness dimensions separate instead of producing one score', () => {
            const history: WorkoutSession[] = [
                { id: 'r1', date: '2026-08-20', readiness: { capturedAt: 1, energy: 2, stress: 5, motivation: 4, muscleRecovery: 3 }, exercises: [] },
                { id: 'r2', date: '2026-08-21', readiness: { capturedAt: 2, energy: 4, stress: 3, motivation: 2, muscleRecovery: 5 }, exercises: [] },
            ];
            const result = computeReadinessTrends(history, 12);
            expect(result.energy).toEqual({ average: 3, latest: 4, previous: 2, deltaFromPrevious: 2, count: 2 });
            expect(result.stress).toEqual({ average: 4, latest: 3, previous: 5, deltaFromPrevious: -2, count: 2 });
            expect(result.motivation).toEqual({ average: 3, latest: 2, previous: 4, deltaFromPrevious: -2, count: 2 });
            expect(result.muscleRecovery).toEqual({ average: 4, latest: 5, previous: 3, deltaFromPrevious: 2, count: 2 });
            expect(result).not.toHaveProperty('score');
        });

        it('orders same-day readiness by actual session time even when archive input is reversed', () => {
            const day = '2026-08-20';
            const early: WorkoutSession = { id: 'early', date: day, globalStartTime: new Date(2026, 7, 20, 8).getTime(), readiness: { capturedAt: 1, energy: 1 }, exercises: [] };
            const late: WorkoutSession = { id: 'late', date: day, globalStartTime: new Date(2026, 7, 20, 18).getTime(), readiness: { capturedAt: 2, energy: 5 }, exercises: [] };
            for (const history of [[early, late], [late, early]]) {
                expect(computeReadinessTrends(history, 2).energy).toEqual({
                    average: 3, latest: 5, previous: 1, deltaFromPrevious: 4, count: 2,
                });
            }
        });

        it('uses capturedAt when same-day sessions have no workout start time', () => {
            const older: WorkoutSession = { id: 'older', date: '2026-08-20', readiness: { capturedAt: 1000, energy: 2 }, exercises: [] };
            const newer: WorkoutSession = { id: 'newer', date: '2026-08-20', readiness: { capturedAt: 2000, energy: 5 }, exercises: [] };
            for (const history of [[older, newer], [newer, older]]) {
                expect(computeReadinessTrends(history, 2).energy).toEqual({
                    average: 3.5, latest: 5, previous: 2, deltaFromPrevious: 3, count: 2,
                });
            }
        });

        it('uses a valid workout timestamp to order entries whose date is missing', () => {
            const dated: WorkoutSession = { id: 'dated', date: '2026-08-19', readiness: { capturedAt: 1000, energy: 1 }, exercises: [] };
            const undated: WorkoutSession = { id: 'undated', globalStartTime: new Date(2026, 7, 20, 10).getTime(), readiness: { capturedAt: 2000, energy: 5 }, exercises: [] };
            expect(computeReadinessTrends([dated, undated], 2).energy.latest).toBe(5);
        });

        it('T4.6_training_activity_context: co-visualizes independent weekly metrics without collapsing them into fatigue', () => {
            const history: WorkoutSession[] = [{
                id: 'ctx-w1',
                date: '2026-08-18',
                exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }],
            }];
            const nutrition: Record<string, NutritionDay> = {
                '2026-08-18': { date: '2026-08-18', steps: 9000, cardioSessions: [{ id: 'c1', modality: 'bike', durationMinutes: 30, intensity: 'moderate', source: 'manual' }], kcal: 0, carbs: 0, pro: 0, fat: 0 },
            };
            const points = computeWeeklyTrainingActivityContext(history, nutrition, mockLibrary, 80, 1, '2026-08-23');
            expect(points[0]).toMatchObject({ workoutCount: 1, volumeKg: 1000, averageSteps: 9000, cardioMinutes: 30 });
            expect(points[0]).not.toHaveProperty('fatigue');
        });

        it('parses Italian decimal weights and rejects trailing units in weekly averages', () => {
            const nutrition = {
                '2026-08-17': { date: '2026-08-17', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: '79,5' },
                '2026-08-18': { date: '2026-08-18', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: '80.5' },
                '2026-08-19': { date: '2026-08-19', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: '82kg' },
            } as Record<string, NutritionDay>;
            const result = computeWeeklyWeightSeries(nutrition, 1, '2026-08-23');
            expect(result.points[0].averageWeightKg).toBe(80);
            expect(result.points[0].recordedDaysCount).toBe(2);
            expect(getLatestUserWeight(nutrition)).toBe(80.5);
            // A newer malformed entry must not override the planned-weight fallback.
            expect(getLatestUserWeight({
                '2026-08-20': { weight: '82kg' },
                '2026-08-21': { weight: '-3' },
            }, { weight: '79,5' })).toBe(79.5);
        });
    });
});
