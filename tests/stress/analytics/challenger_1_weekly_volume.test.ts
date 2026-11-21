import { describe, it, expect } from 'vitest';
import {
    computeWeeklyVolumeSeries,
    computeVolumeCaloriesCorrelation,
    generateWeekIntervals,
    getWorkoutDateString,
} from '../../../src/lib/calc/analytics';
import { calculateSetVolume } from '../../../src/lib/calc/workout';
import { getLocalDateString } from '../../../src/lib/utils/date';
import type { WorkoutSession, NutritionDay } from '../../../src/types';
import { testLibrary } from './analyticsStressFixture';

describe('Analytics stress: weekly volume, date boundaries and malformed inputs', () => {
    describe('1. High-volume weekly aggregation correctness', () => {
        it('aggregates 1,000 workouts and 20,000 sets into 52 weekly buckets', () => {
            const history: WorkoutSession[] = [];
            const baseTime = new Date(2024, 0, 1, 12).getTime();

            for (let i = 0; i < 1000; i++) {
                const sessionDate = getLocalDateString(baseTime + i * 24 * 60 * 60 * 1000);
                const exercises = [];
                for (let e = 0; e < 4; e++) {
                    const sets = [];
                    for (let s = 0; s < 5; s++) {
                        sets.push({
                            id: 's_' + i + '_' + e + '_' + s,
                            kg: String(60 + (s * 5)),
                            reps: String(8 + s),
                            segments: [
                                { technique: 'dropset' as const, id: 'ds_' + i + '_' + e + '_' + s + '_1', kg: '40', reps: '6' },
                                { technique: 'dropset' as const, id: 'ds_' + i + '_' + e + '_' + s + '_2', kg: '30', reps: '6' }
                            ]
                        });
                    }
                    exercises.push({
                        exId: e % 2 === 0 ? 'ex_bench' : 'ex_squat',
                        sessionNote: '',
                        sets
                    });
                }
                history.push({
                    id: 'w_stress_' + i,
                    date: sessionDate,
                    routineName: 'Routine ' + i,
                    exercises
                });
            }

            const nutrition: Record<string, NutritionDay> = {};
            for (let i = 0; i < 1000; i++) {
                const dayDate = getLocalDateString(baseTime + i * 24 * 60 * 60 * 1000);
                nutrition[dayDate] = {
                    date: dayDate,
                    kcal: 2400 + (i % 500),
                    carbs: 300,
                    pro: 160,
                    fat: 70
                };
            }

            const { points: volPoints, stats: volStats } = computeWeeklyVolumeSeries(history, testLibrary, 80, 52, '2026-09-01');

            const { points: corrPoints, stats: corrStats } = computeVolumeCaloriesCorrelation(history, nutrition, testLibrary, 80, 52, '2026-09-01');

            expect(volPoints).toHaveLength(52);
            expect(corrPoints).toHaveLength(52);
            expect(volStats.hasData).toBe(true);
            expect(corrStats.hasData).toBe(true);

            // Independently calculate the fixed fixture: two bench exercises,
            // two 20-kg-tare squats, five main sets and two drops per set.
            const bench = [480, 585, 700, 825, 960].reduce((a, b) => a + b, 0) + 5 * (40 * 6 + 30 * 6);
            const squat = [640, 765, 900, 1045, 1200].reduce((a, b) => a + b, 0) + 5 * (60 * 6 + 50 * 6);
            const workoutKg = 2 * (bench + squat);
            expect(workoutKg).toBe(27000);
            // 52 Monday-based weeks begin 2025-09-08; no session later
            // than the requested 2026-09-01 reference day may be included.
            const included = history.filter(w =>
                typeof w.date === 'string' && w.date >= '2025-09-08' && w.date <= '2026-09-01');
            expect(included).toHaveLength(359);
            expect(volStats.totalWorkouts).toBe(359);
            expect(volStats.totalVolumeKg).toBe(359 * workoutKg);
            expect(volStats.totalVolumeKg).toBe(9693000);
            expect(volPoints[0]).toMatchObject({ weekStart: '2025-09-08', workoutCount: 7, volumeKg: 189000 });
            expect(volPoints[51]).toMatchObject({ weekStart: '2026-08-31', workoutCount: 2, volumeKg: 54000 });
            expect(volStats.currentWeekVolumeKg).toBe(54000);
            expect(corrPoints.map(p => [p.weekStart, p.workoutCount, p.volumeKg]))
                .toEqual(volPoints.map(p => [p.weekStart, p.workoutCount, p.volumeKg]));
            expect(corrStats.validDataPointsCount).toBe(52);
        });

        it('handles sparse data distribution (1 workout every 6 weeks) cleanly', () => {
            const history: WorkoutSession[] = [
                { id: 'w1', date: '2026-01-15', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
                { id: 'w2', date: '2026-04-20', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '100', reps: '10' }] }] },
                { id: 'w3', date: '2026-08-10', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's3', kg: '100', reps: '10' }] }] }
            ];
            const { points, stats } = computeWeeklyVolumeSeries(history, testLibrary, 80, 36, '2026-08-22');
            expect(points).toHaveLength(36);
            expect(stats.totalWorkouts).toBe(3);
            expect(stats.totalVolumeKg).toBe(3000);
            expect(stats.activeWeeksCount).toBe(3);
            expect(stats.avgWeeklyVolumeKg).toBe(83);
            expect(points.filter(point => point.workoutCount > 0).map(point => [
                point.weekStart, point.workoutCount, point.volumeKg,
            ])).toEqual([
                ['2026-01-12', 1, 1000],
                ['2026-04-20', 1, 1000],
                ['2026-08-10', 1, 1000],
            ]);
        });
    });

    describe('2. Boundary Inputs & Numeric Anomalies', () => {
        it('handles 0 reps, 0 kg, negative loads and inverted sets safely', () => {
            const set0 = { kg: 0, reps: 0 };
            expect(calculateSetVolume(set0, null, 80)).toBe(0);

            const set0Reps = { kg: 100, reps: 0 };
            expect(calculateSetVolume(set0Reps, null, 80)).toBe(0);

            const set0Kg = { kg: 0, reps: 10 };
            expect(calculateSetVolume(set0Kg, null, 80)).toBe(0);

            const setNeg = { kg: -50, reps: 10 };
            expect(calculateSetVolume(setNeg, null, 80)).toBe(-500);

            const setNegReps = { kg: 100, reps: -5 };
            expect(calculateSetVolume(setNegReps, null, 80)).toBe(-500);
        });

        it('handles enormous numbers without floating point overflow or Infinity', () => {
            const history: WorkoutSession[] = [{
                id: 'w_giant',
                date: '2026-08-18',
                exercises: [{
                    exId: 'ex_bench',
                    sessionNote: '',
                    sets: [{ id: 's1', kg: '1000000', reps: '1000' }]
                }]
            }];
            const { points, stats } = computeWeeklyVolumeSeries(history, testLibrary, 80, 4, '2026-08-22');
            const curr = points[points.length - 1];
            expect(curr.volumeKg).toBe(1000000000);
            expect(curr.volumeTon).toBe(1000000);
            expect(Number.isFinite(stats.totalVolumeKg)).toBe(true);
            expect(Number.isNaN(stats.totalVolumeKg)).toBe(false);
        });

        it('handles non-sequential, future, and ancient workout dates seamlessly', () => {
            const history: WorkoutSession[] = [
                { id: 'w_ancient', date: '1999-12-31', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
                { id: 'w_future', date: '2050-01-01', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '100', reps: '10' }] }] },
                { id: 'w_shuffled1', date: '2026-08-19', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's3', kg: '100', reps: '10' }] }] },
                { id: 'w_shuffled2', date: '2026-08-17', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's4', kg: '100', reps: '10' }] }] }
            ];
            const { points, stats } = computeWeeklyVolumeSeries(history, testLibrary, 80, 4, '2026-08-22');
            expect(points[points.length - 1].volumeKg).toBe(2000);
            expect(points[points.length - 1].workoutCount).toBe(2);
            expect(stats.totalVolumeKg).toBe(2000);
        });

        it('handles corrupted date formats and invalid timestamp properties gracefully', () => {
            expect(getWorkoutDateString(null)).toBeNull();
            expect(getWorkoutDateString(undefined)).toBeNull();
            expect(getWorkoutDateString({})).toBeNull();
            expect(getWorkoutDateString({ date: '' } as any)).toBeNull();
            expect(getWorkoutDateString({ date: 'invalid-date' } as any)).toBeNull();
            expect(getWorkoutDateString({ date: '2026-02-30' } as any)).toBeNull();
            expect(getWorkoutDateString({ date: '2026-09-15-garbage' } as any)).toBeNull();
            expect(getWorkoutDateString({ date: '2026-09-15T20:15:00.000Z' } as any)).toBe('2026-09-15');
            expect(getWorkoutDateString({ globalStartTime: NaN } as any)).toBeNull();
            expect(getWorkoutDateString({ globalStartTime: Infinity } as any)).toBeNull();
            expect(getWorkoutDateString({ globalEndTime: -Infinity } as any)).toBeNull();
            expect(getWorkoutDateString({ globalStartTime: Number.MAX_VALUE } as any)).toBeNull();
            expect(getWorkoutDateString({ globalEndTime: 'abc' as any } as any)).toBeNull();
            expect(getWorkoutDateString({ globalStartTime: 1770000000000 } as any)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    describe('3. Calendar Week Boundaries, Leap Years & DST', () => {
        it('handles leap years (2024-02-29 and 2028-02-29) and non-leap years correctly', () => {
            const intervals2024 = generateWeekIntervals(8, '2024-03-05');
            const leapWeek = intervals2024.find(w => w.weekStart <= '2024-02-29' && w.weekEnd >= '2024-02-29');
            expect(leapWeek).toBeDefined();
            expect(leapWeek?.weekStart).toBe('2024-02-26');
            expect(leapWeek?.weekEnd).toBe('2024-03-03');

            const intervals2028 = generateWeekIntervals(8, '2028-03-05');
            const leapWeek2028 = intervals2028.find(w => w.weekStart <= '2028-02-29' && w.weekEnd >= '2028-02-29');
            expect(leapWeek2028).toBeDefined();
            expect(leapWeek2028?.weekStart).toBe('2028-02-28');
            expect(leapWeek2028?.weekEnd).toBe('2028-03-05');
        });

        it('handles daylight saving transitions (March 23h and October 25h days) without interval shifting', () => {
            const intervalsMarch = generateWeekIntervals(4, '2026-03-31');
            expect(intervalsMarch).toHaveLength(4);
            const dstMarchWeek = intervalsMarch[intervalsMarch.length - 1];
            expect(dstMarchWeek.weekStart).toBe('2026-03-30');
            expect(dstMarchWeek.weekEnd).toBe('2026-04-05');

            const intervalsOct = generateWeekIntervals(4, '2026-10-27');
            expect(intervalsOct).toHaveLength(4);
            const dstOctWeek = intervalsOct[intervalsOct.length - 1];
            expect(dstOctWeek.weekStart).toBe('2026-10-26');
            expect(dstOctWeek.weekEnd).toBe('2026-11-01');
        });

        it('handles 1-week and 52-week generation boundaries', () => {
            const w1 = generateWeekIntervals(1, '2026-08-22');
            expect(w1).toHaveLength(1);
            expect(w1[0].weekIndex).toBe(0);

            const w52 = generateWeekIntervals(52, '2026-08-22');
            expect(w52).toHaveLength(52);
            expect(w52[0].weekIndex).toBe(0);
            expect(w52[51].weekIndex).toBe(51);
        });
    });
});
