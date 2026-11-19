import { describe, it, expect } from 'vitest';
import {
    computeWeeklyVolumeSeries,
    computeWeeklyVolumeSeriesCooperative,
    computeVolumeCaloriesCorrelationCooperative,
    computeWeeklyNutritionSeries,
    computeVolumeCaloriesCorrelation,
    computeWeeklyWeightSeries,
    computeWeeklyActivitySeries,
    computeReadinessTrends,
    calculatePearsonCorrelation,
    generateWeekIntervals,
    getWorkoutDateString,
} from './analytics';
import { getLocalDateString } from '../utils/date';
import { calculateWorkoutVolume } from './workout';
import { format, subDays } from 'date-fns';
import type { WorkoutSession, Exercise, NutritionDay } from '../../types';

describe('Home analytics weekly bucketing regression', () => {
    it('matches the historical per-week filter on a large unordered archive, including session order and DST', () => {
        const referenceDate = '2026-04-12';
        const library: Exercise[] = [{
            id: 'ex-1', name: 'Test exercise', muscles: ['petto'],
            trackingType: 'weight_reps', setsCount: 1, sets: [],
        }];
        const date = new Date('2026-04-12T12:00:00');
        const history: WorkoutSession[] = Array.from({ length: 1500 }, (_, i) => ({
            id: `s-${i}`,
            date: format(subDays(date, (i * 37) % 382), 'yyyy-MM-dd'),
            exercises: [{
                exId: 'ex-1', sessionNote: '',
                sets: [{ id: `set-${i}`, kg: '1.25', reps: String((i % 9) + 1) }],
            }],
        }));
        const intervals = generateWeekIntervals(52, referenceDate);
        const expected = intervals.map(interval => {
            const matching = history.filter(session => {
                const d = getWorkoutDateString(session);
                return d !== null && d >= interval.weekStart && d <= interval.weekEnd;
            });
            return {
                workoutCount: matching.length,
                sessionIds: matching.map(session => session.id).filter(Boolean),
                volumeKg: Math.round(matching.reduce(
                    (sum, session) => sum + 1.25 * ((Number(session.id?.slice(2)) % 9) + 1), 0,
                )),
            };
        });
        const { points } = computeWeeklyVolumeSeries(history, library, 80, 52, referenceDate);
        expect(points.map(point => ({
            workoutCount: point.workoutCount,
            sessionIds: point.sessionIds,
            volumeKg: point.volumeKg,
        }))).toEqual(expected);
        expect(points).toHaveLength(52);
    });
});

describe('Weekly catalog lookup compatibility', () => {
    it('uses the last catalog entry for duplicate exercise IDs, for arrays and prebuilt maps', () => {
        const catalog: Exercise[] = [
            { id: 'same', name: 'Old', equipmentWeight: 10, muscles: [], setsCount: 1, sets: [] },
            { id: 'same', name: 'New', equipmentWeight: 20, muscles: [], setsCount: 1, sets: [] },
        ];
        const workout: WorkoutSession = {
            id: 'w', date: '2026-08-18',
            exercises: [{ exId: 'same', sessionNote: '', sets: [{ id: 's1', kg: '10', reps: '10' }] }],
        };
        const map = new Map(catalog.map(exercise => [exercise.id, exercise]));
        expect(calculateWorkoutVolume(workout, catalog, 80)).toBe(300);
        expect(calculateWorkoutVolume(workout, map, 80)).toBe(300);
        expect(computeWeeklyVolumeSeries([workout], catalog, 80, 4, '2026-08-22').stats.totalVolumeKg).toBe(300);
    });
});

describe('Large archive cooperative analytics fallback', () => {
    const reference = new Date(2026, 7, 22);
    const library: Exercise[] = [{
        id: 'archive_ex', name: 'Archivio', muscles: ['petto'], trackingType: 'weight_reps', setsCount: 1, sets: []
    }];
    const sessions: WorkoutSession[] = Array.from({ length: 6_000 }, (_, i) => ({
        id: `large_${i}`,
        date: format(subDays(reference, i % 330), 'yyyy-MM-dd'),
        routineName: 'Test archivio',
        exercises: [{ exId: 'archive_ex', sessionNote: '', sets: [{ id: `set_${i}`, kg: String(40 + i % 40), reps: '8' }] }]
    }));
    const nutrition: Record<string, NutritionDay> = Object.fromEntries(Array.from({ length: 200 }, (_, i) => {
        const date = format(subDays(reference, i), 'yyyy-MM-dd');
        return [date, { date, kcal: 2200 + i % 200, carbs: 220, pro: 130, fat: 60 }];
    }));

    it('produces exactly the synchronous result and yields to the event loop for a large volume series', async () => {
        const expected = computeWeeklyVolumeSeries(sessions, library, 80, 52, reference);
        let inputProcessed = false;
        setTimeout(() => { inputProcessed = true; }, 0);
        const actual = await computeWeeklyVolumeSeriesCooperative(sessions, library, 80, 52, reference);
        expect(actual).toEqual(expected);
        // The synchronous path alone is not an independent oracle: both paths can agree on a wrong total.
        expect(actual.points[51].workoutCount).toBe(114);
        expect(actual.points[51].volumeKg).toBe(51_720);
        expect(inputProcessed).toBe(true);
    });

    it('preserves correlation and cancels long computations when the view closes', async () => {
        const expected = computeVolumeCaloriesCorrelation(sessions, nutrition, library, 80, 52, reference);
        const actual = await computeVolumeCaloriesCorrelationCooperative(sessions, nutrition, library, 80, 52, reference);
        expect(actual).toEqual(expected);
        const abort = new AbortController();
        const pending = computeWeeklyVolumeSeriesCooperative(sessions, library, 80, 52, reference, abort.signal);
        abort.abort();
        await expect(pending).rejects.toThrow('annullato');
    });
});


describe('weekly analytics tolerate invalid non-finite records without contaminating charts', () => {
    it('excludes infinite calories instead of treating them as a logged nutrition day', () => {
        const nutrition = {
            '2026-08-17': { date: '2026-08-17', kcal: Infinity, carbs: 200, pro: 100, fat: 50 },
            '2026-08-18': { date: '2026-08-18', kcal: 2500, carbs: Infinity, pro: NaN, fat: 70 },
        } as Record<string, NutritionDay>;
        const { points, stats } = computeWeeklyNutritionSeries(nutrition, 1, '2026-08-18');
        expect(points[0]).toMatchObject({
            totalKcal: 2500, loggedDaysCount: 1, avgDailyKcal: 2500,
            avgCarbs: 0, avgPro: 0, avgFat: 70,
        });
        expect(stats).toMatchObject({ hasData: true, avgDailyKcalOverall: 2500 });
    });

    it('ignores invalid workout timestamps instead of interpreting them as today', () => {
        expect(getWorkoutDateString({ globalStartTime: Infinity, globalEndTime: NaN } as WorkoutSession)).toBeNull();
        expect(getWorkoutDateString({ globalStartTime: Infinity, globalEndTime: Date.parse('2026-08-18T12:00:00Z') } as WorkoutSession))
            .toBe(getLocalDateString(new Date('2026-08-18T12:00:00Z')));
    });
});

describe('analytics: representable aggregates and reliable numerical comparisons', () => {
    it('normalizes fractional and non-finite week counts before iterating', () => {
        expect(generateWeekIntervals(2.9, '2026-08-23')).toHaveLength(2);
        expect(generateWeekIntervals(Infinity, '2026-08-23')).toHaveLength(8);
        expect(generateWeekIntervals(NaN, '2026-08-23')).toHaveLength(8);
        expect(generateWeekIntervals(-Infinity, '2026-08-23')).toHaveLength(8);
    });

    it('does not invent a Pearson coefficient from non-finite inputs', () => {
        expect(calculatePearsonCorrelation([1, 1, 1], [Infinity, 2, 3])).toBeNull();
        expect(calculatePearsonCorrelation([1, 2, 3], [1, NaN, 3])).toBeNull();
        expect(calculatePearsonCorrelation([1, 2, 3], [1, -Infinity, 3])).toBeNull();
    });

    it('computes Pearson reliably for perfectly correlated tiny and huge magnitudes', () => {
        expect(calculatePearsonCorrelation([1e-6, 2e-6, 3e-6], [10, 20, 30])).toBe(1);
        expect(calculatePearsonCorrelation([1e200, 2e200, 3e200], [10, 20, 30])).toBe(1);
        expect(calculatePearsonCorrelation([1e200, 2e200, 3e200], [30, 20, 10])).toBe(-1);
        expect(calculatePearsonCorrelation([10, 10, 10], [30, 20, 10])).toBe(0);
    });

    it('does not publish overflowing calorie sums or count discarded records as logged', () => {
        const nutrition = {
            '2026-08-17': { date: '2026-08-17', kcal: 1e308, carbs: 0, pro: 0, fat: 0 },
            '2026-08-18': { date: '2026-08-18', kcal: 1e308, carbs: 0, pro: 0, fat: 0 },
        } as Record<string, NutritionDay>;

        const { points, stats } = computeWeeklyNutritionSeries(nutrition, 1, '2026-08-19');
        expect(points[0].loggedDaysCount).toBe(1);
        expect(points[0].totalKcal).toBe(1e308);
        expect(points[0].avgDailyKcal).toBe(1e308);
        expect(stats.avgDailyKcalOverall).toBe(1e308);
        expect(Number.isFinite(points[0].totalKcal)).toBe(true);
        expect(Number.isFinite(stats.avgDailyKcalOverall)).toBe(true);
    });

    it('omits macro averages when finite values overflow together instead of publishing infinity', () => {
        const nutrition = {
            '2026-08-17': { date: '2026-08-17', kcal: 2000, carbs: 1e308, pro: 20, fat: 10 },
            '2026-08-18': { date: '2026-08-18', kcal: 2000, carbs: 1e308, pro: 20, fat: 10 },
        } as Record<string, NutritionDay>;

        const point = computeWeeklyNutritionSeries(nutrition, 1, '2026-08-19').points[0];
        expect(point).toMatchObject({ loggedDaysCount: 2, totalKcal: 4000, avgPro: 20, avgFat: 10 });
        expect(point).not.toHaveProperty('avgCarbs');
        const single = computeWeeklyNutritionSeries({
            '2026-08-17': nutrition['2026-08-17'],
        }, 1, '2026-08-19').points[0];
        expect(single.avgCarbs).toBe(1e308);
    });

    it('keeps weekly and cross-week activity totals finite when observations overflow in combination', () => {
        const cardio = (id: string) => ({
            id, modality: 'bike', durationMinutes: 1e308, intensity: 'moderate' as const, source: 'manual' as const,
        });
        const nutrition = {
            '2026-08-17': { date: '2026-08-17', kcal: 0, carbs: 0, pro: 0, fat: 0, steps: 1e308, cardioSessions: [cardio('one'), cardio('two')] },
            '2026-08-18': { date: '2026-08-18', kcal: 0, carbs: 0, pro: 0, fat: 0, steps: 1e308 },
            '2026-08-10': { date: '2026-08-10', kcal: 0, carbs: 0, pro: 0, fat: 0, steps: 1e308, cardioSessions: [cardio('three')] },
        } as Record<string, NutritionDay>;

        const { points, stats } = computeWeeklyActivitySeries(nutrition, 2, '2026-08-19');
        expect(points[1]).toMatchObject({
            totalSteps: 1e308, stepDaysCount: 1, cardioMinutes: 1e308, cardioSessionsCount: 1,
        });
        expect(points[1].cardioMinutesByIntensity.moderate).toBe(1e308);
        expect(Number.isFinite(stats.totalSteps)).toBe(true);
        expect(Number.isFinite(stats.cardioMinutes)).toBe(true);
        expect(stats.stepDaysCount).toBe(2);
        expect(stats.cardioSessionsCount).toBe(2);
    });

    it('keeps a weekly weight mean finite when individually valid measurements overflow in sum', () => {
        const nutrition = {
            '2026-08-17': { date: '2026-08-17', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 1e308 },
            '2026-08-18': { date: '2026-08-18', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 1e308 },
        } as Record<string, NutritionDay>;
        const { points, stats } = computeWeeklyWeightSeries(nutrition, 1, '2026-08-19');
        expect(points[0]).toMatchObject({ averageWeightKg: 1e308, recordedDaysCount: 1 });
        expect(stats.latestAverageWeightKg).toBe(1e308);
        expect(Number.isFinite(points[0].averageWeightKg)).toBe(true);
    });
});

describe('Weekly volume bounded accumulation', () => {
    it('preserves input-order IDs, duplicate sessions, skipped overflow and cooperative parity', async () => {
        const catalog: Exercise[] = [{
            id: 'bench', name: 'Panca', muscles: [], setsCount: 1, sets: [],
            trackingType: 'weight_reps',
        }];
        const session = (id: string, date: string, kg: string, reps: string): WorkoutSession => ({
            id, date, exercises: [{
                exId: 'bench', sessionNote: '',
                sets: [{ id: `set-${id}-${date}`, kg, reps }],
            }],
        });
        const history = [
            session('late', '2026-08-18', '80', '2'),
            session('duplicate', '2026-08-11', '10', '3'),
            session('overflow', '2026-08-19', '1e308', '10'),
            session('duplicate', '2026-08-20', '100', '4'),
            session('', '2026-08-20', '-50', '2'),
            session('future', '2026-08-23', '100', '10'),
            session('invalid-day', 'not-a-day', '100', '10'),
        ];
        const result = computeWeeklyVolumeSeries(history, catalog, 80, 4, '2026-08-22');

        expect(result.points.map(({ workoutCount, volumeKg, sessionIds }) => ({
            workoutCount, volumeKg, sessionIds,
        }))).toEqual([
            { workoutCount: 0, volumeKg: 0, sessionIds: [] },
            { workoutCount: 0, volumeKg: 0, sessionIds: [] },
            { workoutCount: 1, volumeKg: 30, sessionIds: ['duplicate'] },
            { workoutCount: 4, volumeKg: 460, sessionIds: ['late', 'overflow', 'duplicate'] },
        ]);
        expect(result.stats.totalWorkouts).toBe(5);
        expect(result.stats.totalVolumeKg).toBe(490);
        expect(await computeWeeklyVolumeSeriesCooperative(history, catalog, 80, 4, '2026-08-22'))
            .toEqual(result);
    });
});

describe('Readiness chronology precomputation', () => {
    it('evaluates workout dates once per session while selecting the same newest check-ins', () => {
        let dateReads = 0;
        const history: WorkoutSession[] = Array.from({ length: 48 }, (_, index) => ({
            id: `readiness-${index}`,
            get date() {
                dateReads++;
                return '2026-08-20';
            },
            globalStartTime: index + 1,
            readiness: { capturedAt: index + 1, energy: index === 47 ? 5 : 2 },
            exercises: [],
        }));

        const result = computeReadinessTrends(history, 2);
        expect(result.sessionsWithReadiness).toBe(2);
        expect(result.energy).toMatchObject({ latest: 5, previous: 2, average: 3.5 });
        // Each normalized date is read a bounded number of times, not per sort comparison.
        expect(dateReads).toBeLessThanOrEqual(3 * history.length);
    });

    it('preserves the original history order when date and timestamps tie exactly', () => {
        const makeSession = (id: string, energy: number): WorkoutSession => ({
            id, date: '2026-08-20', globalStartTime: 1_000,
            readiness: { capturedAt: 1_000, energy },
            exercises: [],
        });
        const result = computeReadinessTrends([
            makeSession('first', 1), makeSession('second', 4),
        ], 2);

        expect(result.energy).toMatchObject({ latest: 1, previous: 4 });
    });
});
