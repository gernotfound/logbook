import { describe, it, expect } from 'vitest';
import { calculatePearsonCorrelation, computeVolumeCaloriesCorrelation } from '../../../src/lib/calc/analytics';
import type { WorkoutSession, NutritionDay } from '../../../src/types';
import { testLibrary } from './analyticsStressFixture';

describe('Analytics stress: Pearson stability and correlation insights', () => {
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

        it('retains a perfect positive correlation with micro-variance (1e-9 differences)', () => {
            const x = [1000.000000001, 1000.000000002, 1000.000000003];
            const y = [2000, 2500, 3000];
            expect(calculatePearsonCorrelation(x, y)).toBe(1);
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
                { id: 'w1', date: '2026-08-04', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }] },
                { id: 'w2', date: '2026-08-11', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's2', kg: '200', reps: '10' }] }] },
                { id: 'w3', date: '2026-08-18', exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's3', kg: '300', reps: '10' }] }] }
            ];
            const nutritionPos: Record<string, NutritionDay> = {
                '2026-08-04': { date: '2026-08-04', kcal: 2000, carbs: 0, pro: 0, fat: 0 },
                '2026-08-11': { date: '2026-08-11', kcal: 2500, carbs: 0, pro: 0, fat: 0 },
                '2026-08-18': { date: '2026-08-18', kcal: 3000, carbs: 0, pro: 0, fat: 0 }
            };
            const resPos = computeVolumeCaloriesCorrelation(history, nutritionPos, testLibrary, 80, 4, '2026-08-22');
            expect(resPos.stats.correlationCoefficient).toBe(1.0);
            expect(resPos.stats.correlationInsight).toContain('Associazione positiva forte');

            const nutritionNeutral: Record<string, NutritionDay> = {
                '2026-08-04': { date: '2026-08-04', kcal: 2000, carbs: 0, pro: 0, fat: 0 },
                '2026-08-11': { date: '2026-08-11', kcal: 3000, carbs: 0, pro: 0, fat: 0 },
                '2026-08-18': { date: '2026-08-18', kcal: 2000, carbs: 0, pro: 0, fat: 0 }
            };
            const resNeutral = computeVolumeCaloriesCorrelation(history, nutritionNeutral, testLibrary, 80, 4, '2026-08-22');
            expect(resNeutral.stats.validDataPointsCount).toBe(3);
            expect(resNeutral.stats.correlationCoefficient).toBeCloseTo(0, 12);
            expect(resNeutral.stats.correlationInsight).toBe('Nessuna associazione lineare evidente nelle settimane disponibili.');

            const nutritionInv: Record<string, NutritionDay> = {
                '2026-08-04': { date: '2026-08-04', kcal: 3000, carbs: 0, pro: 0, fat: 0 },
                '2026-08-11': { date: '2026-08-11', kcal: 2500, carbs: 0, pro: 0, fat: 0 },
                '2026-08-18': { date: '2026-08-18', kcal: 2000, carbs: 0, pro: 0, fat: 0 }
            };
            const resInv = computeVolumeCaloriesCorrelation(history, nutritionInv, testLibrary, 80, 4, '2026-08-22');
            expect(resInv.stats.correlationCoefficient).toBe(-1.0);
            expect(resInv.stats.correlationInsight).toContain('Associazione inversa forte');
        });
    });
});
