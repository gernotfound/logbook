import { describe, it, expect } from 'vitest';
import {
    computeWeeklyVolumeSeries,

    computeVolumeCaloriesCorrelation,
    calculatePearsonCorrelation,
    generateWeekIntervals,
    getWorkoutDateString
} from '../src/lib/calc/analytics';
import { calculateSetVolume } from '../src/lib/calc/workout';
import { getLocalDateString } from '../src/lib/utils/date';
import type { WorkoutSession, Exercise, NutritionDay } from '../src/types';

describe('Challenger 1: Algorithmic & Mathematical Stress Test Suite', () => {

    const testLibrary: Exercise[] = [
        { id: 'ex_bench', name: 'Panca piana', muscles: ['petto'], trackingType: 'weight_reps', setsCount: 3, sets: [] },
        { id: 'ex_squat', name: 'Squat con bilanciere', muscles: ['quadricipiti'], trackingType: 'weight_reps', equipmentWeight: 20, setsCount: 3, sets: [] },
        { id: 'ex_pullup', name: 'Trazioni alla sbarra', muscles: ['dorso'], trackingType: 'weight_reps', isBodyweight: true, setsCount: 3, sets: [] },
        { id: 'ex_dip', name: 'Dip alle parallele', muscles: ['petto', 'tricipiti'], trackingType: 'weight_reps', isBodyweight: true, equipmentWeight: 5, setsCount: 3, sets: [] },
        { id: 'ex_plank', name: 'Plank', muscles: ['addome'], trackingType: 'time', setsCount: 3, sets: [] },
        { id: 'ex_run', name: 'Corsa', muscles: ['gambe'], trackingType: 'cardio', setsCount: 1, sets: [] }
    ];

    describe('1. Extreme Data Loads & Performance Scaling', () => {
        it('handles 1,000 workouts and 20,000 sets under 350ms without memory or CPU bottleneck', () => {
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
                            dropsets: [
                                { id: 'ds_' + i + '_' + e + '_' + s + '_1', kg: '40', reps: '6' },
                                { id: 'ds_' + i + '_' + e + '_' + s + '_2', kg: '30', reps: '6' }
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

            const t0 = performance.now();
            const { points: volPoints, stats: volStats } = computeWeeklyVolumeSeries(history, testLibrary, 80, 52, '2026-09-01');
            const t1 = performance.now();

            const { points: corrPoints, stats: corrStats } = computeVolumeCaloriesCorrelation(history, nutrition, testLibrary, 80, 52, '2026-09-01');
            const t2 = performance.now();

            expect(t1 - t0).toBeLessThan(350);
            expect(t2 - t1).toBeLessThan(350);
            expect(volPoints).toHaveLength(52);
            expect(corrPoints).toHaveLength(52);
            expect(volStats.hasData).toBe(true);
            expect(corrStats.hasData).toBe(true);
            expect(volStats.totalVolumeKg).toBeGreaterThan(0);
        });

        it('handles sparse data distribution (1 workout every 6 weeks) cleanly', () => {
            const history: WorkoutSession[] = [
                { id: 'w1', date: '2026-01-15', exercises: [{ exId: 'ex_bench', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
                { id: 'w2', date: '2026-04-20', exercises: [{ exId: 'ex_bench', sets: [{ id: 's2', kg: '100', reps: '10' }] }] },
                { id: 'w3', date: '2026-08-10', exercises: [{ exId: 'ex_bench', sets: [{ id: 's3', kg: '100', reps: '10' }] }] }
            ];
            const { points, stats } = computeWeeklyVolumeSeries(history, testLibrary, 80, 36, '2026-08-22');
            expect(points).toHaveLength(36);
            expect(stats.activeWeeksCount).toBeGreaterThanOrEqual(1);
            expect(stats.avgWeeklyVolumeKg).toBe(Math.round(stats.totalVolumeKg / 36));
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
                { id: 'w_ancient', date: '1999-12-31', exercises: [{ exId: 'ex_bench', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
                { id: 'w_future', date: '2050-01-01', exercises: [{ exId: 'ex_bench', sets: [{ id: 's2', kg: '100', reps: '10' }] }] },
                { id: 'w_shuffled1', date: '2026-08-19', exercises: [{ exId: 'ex_bench', sets: [{ id: 's3', kg: '100', reps: '10' }] }] },
                { id: 'w_shuffled2', date: '2026-08-17', exercises: [{ exId: 'ex_bench', sets: [{ id: 's4', kg: '100', reps: '10' }] }] }
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
            expect(getWorkoutDateString({ date: 'invalid-date' } as any)).toBe('invalid-da');
            expect(getWorkoutDateString({ globalStartTime: NaN } as any)).toBeNull();
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

    describe('4. Dropset Volume Calculation & Mechanical Invariants', () => {
        it('satisfies Volume Invariant: SetVolume = MainSetVolume + sum(DropsetVolumes)', () => {
            const mainKg = 100;
            const mainReps = 8;
            const drop1Kg = 80;
            const drop1Reps = 8;
            const drop2Kg = 60;
            const drop2Reps = 10;
            const drop3Kg = 40;
            const drop3Reps = 12;

            const set = {
                kg: mainKg,
                reps: mainReps,
                dropsets: [
                    { kg: drop1Kg, reps: drop1Reps },
                    { kg: drop2Kg, reps: drop2Reps },
                    { kg: drop3Kg, reps: drop3Reps }
                ]
            };

            const expectedMain = mainKg * mainReps;
            const expectedDrop1 = drop1Kg * drop1Reps;
            const expectedDrop2 = drop2Kg * drop2Reps;
            const expectedDrop3 = drop3Kg * drop3Reps;
            const expectedTotal = expectedMain + expectedDrop1 + expectedDrop2 + expectedDrop3;

            const actualTotal = calculateSetVolume(set, null, 80);
            expect(actualTotal).toBe(expectedTotal);
            expect(actualTotal).toBe(2520);
        });

        it('calculates dropsets on Bodyweight exercises factoring user weight in each drop stage', () => {
            const userWeight = 75;
            const bwEx: Exercise = {
                id: 'ex_pullup',
                name: 'Trazioni',
                isBodyweight: true,
                trackingType: 'weight_reps',
                setsCount: 1,
                sets: []
            };

            const set = {
                kg: '20',
                reps: '6',
                dropsets: [
                    { kg: '10', reps: '6' },
                    { kg: '0', reps: '6' }
                ]
            };

            const total = calculateSetVolume(set, bwEx, userWeight);
            expect(total).toBe(570 + 510 + 450);
        });

        it('calculates dropsets on Equipment Tare exercises factoring equipment tare in each drop stage', () => {
            const eqEx: Exercise = {
                id: 'ex_squat',
                name: 'Squat',
                equipmentWeight: 20,
                trackingType: 'weight_reps',
                setsCount: 1,
                sets: []
            };

            const set = {
                kg: '100',
                reps: '5',
                dropsets: [
                    { kg: '60', reps: '8' }
                ]
            };

            const total = calculateSetVolume(set, eqEx, 80);
            expect(total).toBe(600 + 640);
        });

        it('combines Bodyweight AND Equipment Tare on dropsets safely', () => {
            const comboEx: Exercise = {
                id: 'ex_dip',
                name: 'Dip',
                isBodyweight: true,
                equipmentWeight: 5,
                trackingType: 'weight_reps',
                setsCount: 1,
                sets: []
            };
            const userWeight = 80;

            const set = {
                kg: '15',
                reps: '10',
                dropsets: [
                    { kg: '0', reps: '10' }
                ]
            };

            const total = calculateSetVolume(set, comboEx, userWeight);
            expect(total).toBe(1850);
        });

        it('defends against malformed dropset objects with string decimals and missing fields', () => {
            const setWithFormats = {
                kg: '100',
                reps: '10',
                dropsets: [
                    { kg: '50,5', reps: '8' },
                    { kg: 'invalid', reps: 'invalid' },
                    { kg: '', reps: '' }
                ]
            };

            const total = calculateSetVolume(setWithFormats, null, 80);
            expect(total).toBe(1404);
            expect(Number.isNaN(total)).toBe(false);
        });
    });

    describe('5. Pearson Correlation Mathematical Edge Cases & Numerical Stability', () => {
        it('returns 0 for zero variance in x (all volume points identical) without NaN', () => {
            const x = [5000, 5000, 5000, 5000];
            const y = [2000, 2500, 3000, 3500];
            const r = calculatePearsonCorrelation(x, y);
            expect(r).toBe(0);
            expect(Number.isNaN(r)).toBe(false);
        });

        it('returns 0 for zero variance in y (all kcal points identical) without NaN', () => {
            const x = [1000, 2000, 3000, 4000];
            const y = [2500, 2500, 2500, 2500];
            const r = calculatePearsonCorrelation(x, y);
            expect(r).toBe(0);
            expect(Number.isNaN(r)).toBe(false);
        });

        it('returns 0 for zero variance in both x and y without NaN', () => {
            const x = [3000, 3000, 3000];
            const y = [2500, 2500, 2500];
            const r = calculatePearsonCorrelation(x, y);
            expect(r).toBe(0);
            expect(Number.isNaN(r)).toBe(false);
        });

        it('returns exact +1.0 for perfect positive linear correlation and -1.0 for perfect inverse correlation', () => {
            const x1 = [100, 200, 300, 400, 500];
            const y1 = [1000, 2000, 3000, 4000, 5000];
            expect(calculatePearsonCorrelation(x1, y1)).toBe(1.0);

            const x2 = [100, 200, 300, 400, 500];
            const y2 = [5000, 4000, 3000, 2000, 1000];
            expect(calculatePearsonCorrelation(x2, y2)).toBe(-1.0);
        });

        it('handles micro-variance (1e-9 differences) without divide-by-zero or NaN', () => {
            const x = [1000.000000001, 1000.000000002, 1000.000000003];
            const y = [2000, 2500, 3000];
            const r = calculatePearsonCorrelation(x, y);
            expect(typeof r === 'number' || r === null).toBe(true);
            expect(Number.isNaN(r as any)).toBe(false);
        });

        it('handles massive numbers (1e9) without precision loss or overflow', () => {
            const x = [1e9, 2e9, 3e9, 4e9];
            const y = [1e6, 2e6, 3e6, 4e6];
            const r = calculatePearsonCorrelation(x, y);
            expect(r).toBe(1.0);
        });

        it('returns null for insufficient data points (< 3 pairs)', () => {
            expect(calculatePearsonCorrelation([], [])).toBeNull();
            expect(calculatePearsonCorrelation([100], [200])).toBeNull();
            expect(calculatePearsonCorrelation([100, 200], [1000, 2000])).toBeNull();
        });

        it('returns null for mismatched array lengths or invalid array inputs', () => {
            expect(calculatePearsonCorrelation([1, 2, 3], [1, 2])).toBeNull();
            expect(calculatePearsonCorrelation(null as any, [1, 2, 3])).toBeNull();
            expect(calculatePearsonCorrelation([1, 2, 3], undefined as any)).toBeNull();
            expect(calculatePearsonCorrelation('abc' as any, [1, 2, 3] as any)).toBeNull();
        });

        it('produces proper sentence case insight strings across positive, neutral, and inverse r intervals', () => {
            const history: WorkoutSession[] = [
                { id: 'w1', date: '2026-08-04', exercises: [{ exId: 'ex_bench', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
                { id: 'w2', date: '2026-08-11', exercises: [{ exId: 'ex_bench', sets: [{ id: 's2', kg: '200', reps: '10' }] }] },
                { id: 'w3', date: '2026-08-18', exercises: [{ exId: 'ex_bench', sets: [{ id: 's3', kg: '300', reps: '10' }] }] }
            ];
            const nutritionPos: Record<string, NutritionDay> = {
                '2026-08-04': { date: '2026-08-04', kcal: 2000, carbs: 0, pro: 0, fat: 0 },
                '2026-08-11': { date: '2026-08-11', kcal: 2500, carbs: 0, pro: 0, fat: 0 },
                '2026-08-18': { date: '2026-08-18', kcal: 3000, carbs: 0, pro: 0, fat: 0 }
            };
            const resPos = computeVolumeCaloriesCorrelation(history, nutritionPos, testLibrary, 80, 4, '2026-08-22');
            expect(resPos.stats.correlationCoefficient).toBe(1.0);
            expect(resPos.stats.correlationInsight).toContain('Forte correlazione positiva');

            const nutritionInv: Record<string, NutritionDay> = {
                '2026-08-04': { date: '2026-08-04', kcal: 3000, carbs: 0, pro: 0, fat: 0 },
                '2026-08-11': { date: '2026-08-11', kcal: 2500, carbs: 0, pro: 0, fat: 0 },
                '2026-08-18': { date: '2026-08-18', kcal: 2000, carbs: 0, pro: 0, fat: 0 }
            };
            const resInv = computeVolumeCaloriesCorrelation(history, nutritionInv, testLibrary, 80, 4, '2026-08-22');
            expect(resInv.stats.correlationCoefficient).toBe(-1.0);
            expect(resInv.stats.correlationInsight).toContain('Forte correlazione inversa');
        });
    });
});