import { describe, expect, it } from 'vitest';
import type { NutritionDay } from '../../types';
import { calculateHomeWeightSeries, selectLatestHomeMeasurements, summarizeHomeNutrition } from './homeHealthMetrics';

const day = (date: string, weight?: string, bf?: string): NutritionDay => ({
    date, kcal: 0, carbs: 0, pro: 0, fat: 0, weight, bf,
    bfProvenance: { method: 'us_navy' },
});

describe('Home health metrics selectors', () => {
    it('selects valid stored readings independently, ignoring malformed day keys and later partial values', () => {
        const data: Record<string, NutritionDay> = {
            '2026-10-10': day('2026-10-10', '82kg', '19%'),
            '2026-10-09': day('2026-10-09', '79,5', '18,5'),
            '2026-10-08': day('2026-10-08', '81', '18'),
            '10/10/2026': day('10/10/2026', '100', '30'),
        };
        const original = structuredClone(data);
        const latest = selectLatestHomeMeasurements(data);
        expect(latest.recentWeight).toBe(79.5);
        expect(latest.recentNutritionWithBf).toBe(data['2026-10-09']);
        expect(data).toEqual(original);
    });

    it('calculates the bounded weight range and recent weekly coverage from a fixed local day', () => {
        const nutrition: Record<string, NutritionDay> = {
            '2026-10-03': day('2026-10-03', '90'),
            '2026-10-08': day('2026-10-08', '79'),
            '2026-10-10': day('2026-10-10', '80'),
        };
        const result = calculateHomeWeightSeries(nutrition, '7d', '2026-10-10');
        expect(result.dates).toEqual([
            '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
            '2026-10-08', '2026-10-09', '2026-10-10',
        ]);
        expect(result.points).toEqual([null, null, null, null, 79, null, 80]);
        expect(result.stats).toMatchObject({
            hasDataInPeriod: true, firstWeight: 79, latestWeight: 80,
            minWeight: 79, maxWeight: 80, weightDelta: 1,
        });
    });

    it('keeps Home calorie and BF semantics without inventing targets or adopting invalid current readings', () => {
        const previous = day('2026-10-09', '79,5', '18,5');
        const today = { ...day('2026-10-10', '80kg', '19%'), isDayOn: true, kcal: 2100 };
        const latest = selectLatestHomeMeasurements({
            '2026-10-09': previous, '2026-10-10': today,
        });
        const planning = {
            weight: 80,
            normocalorica: { kcal: 2000 },
            onMacros: { carbsPerKg: 3.5, proPerKg: 2, fatPerKg: 1 },
        };
        expect(summarizeHomeNutrition(today, planning, latest)).toMatchObject({
            kcalEaten: 2100, kcalTarget: 2480, userWeight: 79.5,
            bf: '18.5', bfSource: 'US Navy',
        });
        expect(summarizeHomeNutrition(undefined, undefined, latest)).toMatchObject({
            kcalTarget: 0, userWeight: 79.5, bf: '18.5',
        });
        expect(summarizeHomeNutrition(today, { normocalorica: { kcal: Number.POSITIVE_INFINITY } }, latest).kcalTarget).toBe(0);
    });
});
