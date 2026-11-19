import { format, subDays } from 'date-fns';
import type { NutritionDay, NutritionPlanning } from '../../types';
import { parseDateInput } from '../utils/date';
import { calculateDailyMacroTarget } from './nutrition';
import { computeWeeklyWeightSeries } from './weeklyHealthMetrics';
import { parsePositiveWeight } from './workout';

export type HomeWeightPeriod = '7d' | '30d' | '180d' | '365d';

const DAYS_BY_PERIOD: Record<HomeWeightPeriod, number> = {
    '7d': 7, '30d': 30, '180d': 180, '365d': 365,
};
const WEEKS_BY_PERIOD: Record<HomeWeightPeriod, number> = {
    '7d': 1, '30d': 5, '180d': 26, '365d': 52,
};

function parseBodyFatPercentage(value: unknown): number | null {
    const parsed = parsePositiveWeight(value);
    return parsed !== null && parsed <= 100 ? parsed : null;
}

export function selectLatestHomeMeasurements(nutrition: Record<string, NutritionDay>) {
    let recentWeight: number | undefined;
    let recentNutritionWithBf: NutritionDay | undefined;
    let weightDate = '';
    let bfDate = '';

    for (const [date, day] of Object.entries(nutrition)) {
        // The stored day key, not a free-form day.date alias, defines recency.
        if (parseDateInput(date) !== date) continue;
        if (date > weightDate) {
            const weight = parsePositiveWeight(day?.weight);
            if (weight !== null) {
                recentWeight = weight;
                weightDate = date;
            }
        }
        if (date > bfDate && parseBodyFatPercentage(day?.bf) !== null) {
            recentNutritionWithBf = day;
            bfDate = date;
        }
    }
    return { recentWeight, recentNutritionWithBf };
}

export function calculateHomeWeightSeries(
    nutrition: Record<string, NutritionDay>,
    period: HomeWeightPeriod,
    referenceDay: string,
) {
    const numDays = DAYS_BY_PERIOD[period];
    const today = new Date(`${referenceDay}T12:00:00`);
    const dates = Array.from(
        { length: numDays },
        (_, index) => format(subDays(today, numDays - 1 - index), 'yyyy-MM-dd'),
    );
    const points = dates.map(date => parsePositiveWeight(nutrition[date]?.weight));
    const validWeights = points.filter((weight): weight is number => weight !== null);

    const hasDataInPeriod = validWeights.length > 0;
    const latestWeight = hasDataInPeriod ? validWeights[validWeights.length - 1] : null;
    const firstWeight = hasDataInPeriod ? validWeights[0] : null;
    const weightDelta = validWeights.length >= 2 && latestWeight !== null && firstWeight !== null
        ? latestWeight - firstWeight
        : null;
    const weekly = computeWeeklyWeightSeries(nutrition, WEEKS_BY_PERIOD[period], today);
    const recentWeeklyAverages = weekly.points
        .filter((point): point is typeof point & { averageWeightKg: number } => point.averageWeightKg !== null)
        .slice(-4);

    return {
        dates,
        points,
        stats: {
            hasDataInPeriod,
            latestWeight,
            firstWeight,
            weightDelta,
            minWeight: hasDataInPeriod ? Math.min(...validWeights) : null,
            maxWeight: hasDataInPeriod ? Math.max(...validWeights) : null,
            latestWeeklyAverage: weekly.stats.latestAverageWeightKg,
            latestWeeklyCoverage: {
                recordedDays: weekly.stats.latestRecordedDaysCount,
                daysConsidered: weekly.stats.latestDaysConsidered,
            },
            recentWeeklyAverages,
        },
    };
}

export type HomeWeightStats = ReturnType<typeof calculateHomeWeightSeries>['stats'];

export function summarizeHomeNutrition(
    today: NutritionDay | undefined,
    planning: NutritionPlanning | undefined,
    latest: ReturnType<typeof selectLatestHomeMeasurements>,
) {
    const plannedKcal = planning?.normocalorica?.kcal;
    let kcalTarget = typeof plannedKcal === 'number' && Number.isFinite(plannedKcal) && plannedKcal > 0
        ? plannedKcal
        : 0;
    const dayTarget = calculateDailyMacroTarget(planning, today?.isDayOn, latest.recentWeight ?? 80);
    if (dayTarget) kcalTarget = dayTarget.kcal;

    const userWeight = parsePositiveWeight(today?.weight)
        ?? latest.recentWeight
        ?? parsePositiveWeight(planning?.weight)
        ?? 80;
    const bfDay = parseBodyFatPercentage(today?.bf) !== null ? today : latest.recentNutritionWithBf;
    const bfValue = parseBodyFatPercentage(bfDay?.bf);
    return {
        kcalEaten: today?.kcal || 0,
        carbs: today?.carbs || 0,
        pro: today?.pro || 0,
        fat: today?.fat || 0,
        kcalTarget,
        bf: bfValue === null ? '--' : bfValue.toFixed(1),
        bfSource: bfValue === null ? null
            : bfDay?.bfProvenance?.method === 'us_navy' ? 'US Navy' : 'Origine non disponibile',
        userWeight,
    };
}
