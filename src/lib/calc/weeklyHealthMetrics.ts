import { addDays, format, parseISO } from 'date-fns';
import { parsePositiveWeight } from './workout';
import type { NutritionDay } from '../../types';
// Public analytics contracts remain on the facade; this dependency is erased at runtime.
import type { WeeklyNutritionPoint, WeeklyActivityPoint, WeeklyActivityStats, WeeklyWeightPoint, WeeklyWeightStats } from './analytics';
import { finiteSum, addFiniteVolume, roundFinite } from './finiteAnalyticsMath';
import { generateWeekIntervals, referenceDayFor } from './weekIntervals';

export function computeWeeklyNutritionSeries(
    nutrition: Record<string, NutritionDay> | null | undefined = {},
    numWeeks: number = 8,
    referenceDate: Date | string = new Date()
): { points: WeeklyNutritionPoint[]; stats: { avgDailyKcalOverall: number; hasData: boolean } } {
    const safeNutrition = nutrition && typeof nutrition === 'object' ? nutrition : {};
    const intervals = generateWeekIntervals(numWeeks, referenceDate);
    const referenceDay = referenceDayFor(referenceDate);

    let overallKcalSum = 0;
    let overallLoggedDays = 0;

    const points: WeeklyNutritionPoint[] = intervals.map((interval, idx) => {
        let weekKcalSum = 0;
        let weekCarbsSum = 0;
        let weekProSum = 0;
        let weekFatSum = 0;
        let carbsOverflow = false;
        let proOverflow = false;
        let fatOverflow = false;
        let loggedDays = 0;

        let cur = parseISO(interval.weekStart);
        const effectiveEnd = interval.weekEnd < referenceDay ? interval.weekEnd : referenceDay;
        const end = parseISO(effectiveEnd);

        while (cur <= end) {
            const dateStr = format(cur, 'yyyy-MM-dd');
            const dayData = safeNutrition[dateStr];

            if (dayData && Number.isFinite(dayData.kcal) && dayData.kcal > 0) {
                const nextWeeklyKcal = finiteSum(weekKcalSum, dayData.kcal);
                const nextOverallKcal = finiteSum(overallKcalSum, dayData.kcal);
                if (nextWeeklyKcal !== null && nextOverallKcal !== null) {
                    weekKcalSum = nextWeeklyKcal;
                    overallKcalSum = nextOverallKcal;
                    loggedDays++;
                    overallLoggedDays++;

                    const nextCarbs = finiteSum(weekCarbsSum, Number.isFinite(dayData.carbs) ? dayData.carbs : 0);
                    const nextPro = finiteSum(weekProSum, Number.isFinite(dayData.pro) ? dayData.pro : 0);
                    const nextFat = finiteSum(weekFatSum, Number.isFinite(dayData.fat) ? dayData.fat : 0);
                    if (nextCarbs === null) carbsOverflow = true;
                    else if (!carbsOverflow) weekCarbsSum = nextCarbs;
                    if (nextPro === null) proOverflow = true;
                    else if (!proOverflow) weekProSum = nextPro;
                    if (nextFat === null) fatOverflow = true;
                    else if (!fatOverflow) weekFatSum = nextFat;
                }
            }
            cur = addDays(cur, 1);
        }

        const avgDailyKcal = loggedDays > 0 ? Math.round(weekKcalSum / loggedDays) : 0;

        return {
            weekIndex: idx,
            weekStart: interval.weekStart,
            weekEnd: interval.weekEnd,
            label: interval.label,
            avgDailyKcal,
            totalKcal: Math.round(weekKcalSum),
            loggedDaysCount: loggedDays,
            ...(!carbsOverflow ? { avgCarbs: loggedDays > 0 ? roundFinite(weekCarbsSum / loggedDays, 10) : 0 } : {}),
            ...(!proOverflow ? { avgPro: loggedDays > 0 ? roundFinite(weekProSum / loggedDays, 10) : 0 } : {}),
            ...(!fatOverflow ? { avgFat: loggedDays > 0 ? roundFinite(weekFatSum / loggedDays, 10) : 0 } : {})
        };
    });

    const avgDailyKcalOverall = overallLoggedDays > 0 ? Math.round(overallKcalSum / overallLoggedDays) : 0;

    return {
        points,
        stats: {
            avgDailyKcalOverall,
            hasData: overallLoggedDays > 0
        }
    };
}

export function computeWeeklyActivitySeries(
    nutrition: Record<string, NutritionDay> | null | undefined = {},
    numWeeks: number = 8,
    referenceDate: Date | string = new Date()
): { points: WeeklyActivityPoint[]; stats: WeeklyActivityStats } {
    const safeNutrition = nutrition && typeof nutrition === 'object' ? nutrition : {};
    const intervals = generateWeekIntervals(numWeeks, referenceDate);
    const referenceDateStr = referenceDayFor(referenceDate);

    const points = intervals.map((interval, weekIndex): WeeklyActivityPoint => {
        const effectiveEnd = interval.weekEnd < referenceDateStr ? interval.weekEnd : referenceDateStr;
        let totalSteps = 0;
        let stepDaysCount = 0;
        let daysConsidered = 0;
        let cardioMinutes = 0;
        let cardioSessionsCount = 0;
        const cardioMinutesByIntensity = { low: 0, moderate: 0, high: 0, unclassified: 0 };

        if (effectiveEnd >= interval.weekStart) {
            let cur = parseISO(interval.weekStart);
            const end = parseISO(effectiveEnd);
            while (cur <= end) {
                daysConsidered++;
                const dateStr = format(cur, 'yyyy-MM-dd');
                const day = safeNutrition[dateStr];
                if (day && typeof day.steps === 'number' && Number.isFinite(day.steps) && day.steps >= 0) {
                    const nextSteps = finiteSum(totalSteps, day.steps);
                    if (nextSteps !== null) {
                        totalSteps = nextSteps;
                        stepDaysCount++;
                    }
                }
                for (const session of Array.isArray(day?.cardioSessions) ? day.cardioSessions : []) {
                    const duration = Number(session?.durationMinutes);
                    if (!Number.isFinite(duration) || duration <= 0) continue;
                    const nextMinutes = finiteSum(cardioMinutes, duration);
                    if (nextMinutes === null) continue;
                    cardioMinutes = nextMinutes;
                    cardioSessionsCount++;
                    if (session.intensity === 'low' || session.intensity === 'moderate' || session.intensity === 'high') {
                        cardioMinutesByIntensity[session.intensity] += duration;
                    } else {
                        cardioMinutesByIntensity.unclassified += duration;
                    }
                }
                cur = addDays(cur, 1);
            }
        }

        return {
            weekIndex,
            weekStart: interval.weekStart,
            weekEnd: interval.weekEnd,
            label: interval.label,
            averageSteps: stepDaysCount > 0 ? Math.round(totalSteps / stepDaysCount) : null,
            totalSteps,
            stepDaysCount,
            daysConsidered,
            cardioMinutes: roundFinite(cardioMinutes, 10),
            cardioSessionsCount,
            cardioMinutesByIntensity,
        };
    });

    const stats = points.reduce<WeeklyActivityStats>((acc, point) => ({
        hasData: acc.hasData || point.stepDaysCount > 0 || point.cardioSessionsCount > 0,
        totalSteps: addFiniteVolume(acc.totalSteps, point.totalSteps),
        stepDaysCount: acc.stepDaysCount + point.stepDaysCount,
        cardioMinutes: roundFinite(addFiniteVolume(acc.cardioMinutes, point.cardioMinutes), 10),
        cardioSessionsCount: acc.cardioSessionsCount + point.cardioSessionsCount,
    }), { hasData: false, totalSteps: 0, stepDaysCount: 0, cardioMinutes: 0, cardioSessionsCount: 0 });

    return { points, stats };
}

export function computeWeeklyWeightSeries(
    nutrition: Record<string, NutritionDay> | null | undefined = {},
    numWeeks: number = 8,
    referenceDate: Date | string = new Date()
): { points: WeeklyWeightPoint[]; stats: WeeklyWeightStats } {
    const safeNutrition = nutrition && typeof nutrition === 'object' ? nutrition : {};
    const intervals = generateWeekIntervals(numWeeks, referenceDate);
    const referenceDateStr = referenceDayFor(referenceDate);

    const points = intervals.map((interval, weekIndex): WeeklyWeightPoint => {
        const effectiveEnd = interval.weekEnd < referenceDateStr ? interval.weekEnd : referenceDateStr;
        let sumWeight = 0;
        let recordedDaysCount = 0;
        let daysConsidered = 0;

        if (effectiveEnd >= interval.weekStart) {
            let cur = parseISO(interval.weekStart);
            const end = parseISO(effectiveEnd);
            while (cur <= end) {
                daysConsidered++;
                const dateStr = format(cur, 'yyyy-MM-dd');
                const raw = safeNutrition[dateStr]?.weight;
                const weight = parsePositiveWeight(raw);
                if (weight !== null) {
                    const nextWeight = finiteSum(sumWeight, weight);
                    if (nextWeight !== null) {
                        sumWeight = nextWeight;
                        recordedDaysCount++;
                    }
                }
                cur = addDays(cur, 1);
            }
        }

        return {
            weekIndex,
            weekStart: interval.weekStart,
            weekEnd: interval.weekEnd,
            label: interval.label,
            averageWeightKg: recordedDaysCount > 0 ? roundFinite(sumWeight / recordedDaysCount, 100) : null,
            recordedDaysCount,
            daysConsidered,
        };
    });

    const latest = [...points].reverse().find(point => point.recordedDaysCount > 0);
    return {
        points,
        stats: {
            hasData: Boolean(latest),
            latestAverageWeightKg: latest?.averageWeightKg ?? null,
            latestRecordedDaysCount: latest?.recordedDaysCount ?? 0,
            latestDaysConsidered: latest?.daysConsidered ?? 0,
        },
    };
}
