import { startOfWeek, endOfWeek, subWeeks, addDays, format, parseISO, isValid } from 'date-fns';
import { it } from 'date-fns/locale';
import { calculateWorkoutVolume } from './workout';
import { Logic } from '../logic';
import type { WorkoutSession, Exercise, NutritionDay } from '../../types';

export interface WeeklyVolumePoint {
    weekIndex: number;
    weekStart: string;
    weekEnd: string;
    label: string;
    volumeKg: number;
    volumeTon: number;
    workoutCount: number;
    sessionIds: string[];
}

export interface WeeklyVolumeStats {
    totalVolumeKg: number;
    avgWeeklyVolumeKg: number;
    currentWeekVolumeKg: number;
    previousWeekVolumeKg: number;
    percentageChange: number | null;
    peakWeekVolumeKg: number;
    hasData: boolean;
    activeWeeksCount: number;
    totalWorkouts: number;
}

export interface WeeklyNutritionPoint {
    weekIndex: number;
    weekStart: string;
    weekEnd: string;
    label: string;
    avgDailyKcal: number;
    totalKcal: number;
    loggedDaysCount: number;
    avgCarbs?: number;
    avgPro?: number;
    avgFat?: number;
}

export interface VolumeCaloriesPoint {
    weekIndex: number;
    weekStart: string;
    weekEnd: string;
    label: string;
    volumeKg: number;
    volumeTon: number;
    avgDailyKcal: number;
    workoutCount: number;
    loggedNutritionDays: number;
}

export interface VolumeCaloriesCorrelationStats {
    hasData: boolean;
    correlationCoefficient: number | null;
    correlationInsight: string;
    avgWeeklyVolumeKg: number;
    avgDailyKcal: number;
    validDataPointsCount: number;
}

export interface WeekInterval {
    weekIndex: number;
    startDate: Date;
    endDate: Date;
    weekStart: string;
    weekEnd: string;
    label: string;
}

export function getWorkoutDateString(w: WorkoutSession | any): string | null {
    if (!w) return null;
    if (w.date && typeof w.date === 'string') {
        const clean = w.date.trim();
        if (clean.length >= 10) {
            return clean.slice(0, 10);
        }
    }
    const ts = typeof w.globalStartTime === 'number' && !isNaN(w.globalStartTime)
        ? w.globalStartTime
        : (typeof w.globalEndTime === 'number' && !isNaN(w.globalEndTime)
            ? w.globalEndTime
            : (typeof w.endTime === 'number' && !isNaN(w.endTime) ? w.endTime : null));

    if (ts !== null) {
        return Logic.getLocalDateString(ts);
    }
    return null;
}

export function generateWeekIntervals(
    numWeeks: number = 8,
    referenceDate: Date | string = new Date()
): WeekInterval[] {
    const validWeeks = Math.max(1, Math.min(52, numWeeks || 8));
    const ref = typeof referenceDate === 'string' ? parseISO(referenceDate) : referenceDate;
    const baseDate = isValid(ref) ? ref : new Date();

    const currentWeekMonday = startOfWeek(baseDate, { weekStartsOn: 1 });
    const intervals: WeekInterval[] = [];

    for (let i = validWeeks - 1; i >= 0; i--) {
        const start = subWeeks(currentWeekMonday, i);
        const end = endOfWeek(start, { weekStartsOn: 1 });
        const weekStartStr = format(start, 'yyyy-MM-dd');
        const weekEndStr = format(end, 'yyyy-MM-dd');

        const label = validWeeks <= 12
            ? format(start, 'd MMM', { locale: it })
            : format(start, 'dd/MM');

        intervals.push({
            weekIndex: validWeeks - 1 - i,
            startDate: start,
            endDate: end,
            weekStart: weekStartStr,
            weekEnd: weekEndStr,
            label
        });
    }

    return intervals;
}

export function computeWeeklyVolumeSeries(
    history: WorkoutSession[] | null | undefined = [],
    library: Exercise[] | null | undefined = [],
    userWeight: number = 80,
    numWeeks: number = 8,
    referenceDate: Date | string = new Date()
): { points: WeeklyVolumePoint[]; stats: WeeklyVolumeStats } {
    const safeHistory = Array.isArray(history) ? history : [];
    const safeLibrary = Array.isArray(library) ? library : [];
    const safeUserWeight = typeof userWeight === 'number' && userWeight > 0 ? userWeight : 80;

    const intervals = generateWeekIntervals(numWeeks, referenceDate);

    const firstDay = intervals[0].weekStart;
    const lastDay = intervals[intervals.length - 1].weekEnd;
    const workoutsWithData = safeHistory.flatMap(w => {
        const dateStr = getWorkoutDateString(w);
        if (!dateStr || dateStr < firstDay || dateStr > lastDay) return [];
        const volume = calculateWorkoutVolume(w, safeLibrary, safeUserWeight);
        return [{
            session: w,
            dateStr,
            volume: isNaN(volume) ? 0 : volume
        }];
    });

    const points: WeeklyVolumePoint[] = intervals.map((interval, idx) => {
        const matching = workoutsWithData.filter(w => {
            if (!w.dateStr) return false;
            return w.dateStr >= interval.weekStart && w.dateStr <= interval.weekEnd;
        });

        const volumeKg = Math.round(matching.reduce((acc, curr) => acc + curr.volume, 0));
        const volumeTon = Math.round((volumeKg / 1000) * 100) / 100;
        const sessionIds = matching.map(m => m.session.id || '').filter(Boolean);

        return {
            weekIndex: idx,
            weekStart: interval.weekStart,
            weekEnd: interval.weekEnd,
            label: interval.label,
            volumeKg,
            volumeTon,
            workoutCount: matching.length,
            sessionIds
        };
    });

    const activePoints = points.filter(p => p.volumeKg > 0);
    const totalVolumeKg = points.reduce((sum, p) => sum + p.volumeKg, 0);
    const totalWorkouts = points.reduce((sum, p) => sum + p.workoutCount, 0);
    const avgWeeklyVolumeKg = points.length > 0 ? Math.round(totalVolumeKg / points.length) : 0;
    const peakWeekVolumeKg = points.reduce((max, p) => Math.max(max, p.volumeKg), 0);

    const currentWeekVolumeKg = points.length > 0 ? points[points.length - 1].volumeKg : 0;
    const previousWeekVolumeKg = points.length > 1 ? points[points.length - 2].volumeKg : 0;

    let percentageChange: number | null = null;
    if (previousWeekVolumeKg > 0) {
        percentageChange = Math.round(((currentWeekVolumeKg - previousWeekVolumeKg) / previousWeekVolumeKg) * 1000) / 10;
    }

    const stats: WeeklyVolumeStats = {
        totalVolumeKg,
        avgWeeklyVolumeKg,
        currentWeekVolumeKg,
        previousWeekVolumeKg,
        percentageChange,
        peakWeekVolumeKg,
        hasData: activePoints.length > 0,
        activeWeeksCount: activePoints.length,
        totalWorkouts
    };

    return { points, stats };
}

export function computeWeeklyNutritionSeries(
    nutrition: Record<string, NutritionDay> | null | undefined = {},
    numWeeks: number = 8,
    referenceDate: Date | string = new Date()
): { points: WeeklyNutritionPoint[]; stats: { avgDailyKcalOverall: number; hasData: boolean } } {
    const safeNutrition = nutrition && typeof nutrition === 'object' ? nutrition : {};
    const intervals = generateWeekIntervals(numWeeks, referenceDate);

    let overallKcalSum = 0;
    let overallLoggedDays = 0;

    const points: WeeklyNutritionPoint[] = intervals.map((interval, idx) => {
        let weekKcalSum = 0;
        let weekCarbsSum = 0;
        let weekProSum = 0;
        let weekFatSum = 0;
        let loggedDays = 0;

        let cur = parseISO(interval.weekStart);
        const end = parseISO(interval.weekEnd);

        while (cur <= end) {
            const dateStr = format(cur, 'yyyy-MM-dd');
            const dayData = safeNutrition[dateStr];

            if (dayData && typeof dayData.kcal === 'number' && !isNaN(dayData.kcal) && dayData.kcal > 0) {
                weekKcalSum += dayData.kcal;
                weekCarbsSum += typeof dayData.carbs === 'number' ? dayData.carbs : 0;
                weekProSum += typeof dayData.pro === 'number' ? dayData.pro : 0;
                weekFatSum += typeof dayData.fat === 'number' ? dayData.fat : 0;
                loggedDays++;
            }
            cur = addDays(cur, 1);
        }

        const avgDailyKcal = loggedDays > 0 ? Math.round(weekKcalSum / loggedDays) : 0;
        const avgCarbs = loggedDays > 0 ? Math.round((weekCarbsSum / loggedDays) * 10) / 10 : 0;
        const avgPro = loggedDays > 0 ? Math.round((weekProSum / loggedDays) * 10) / 10 : 0;
        const avgFat = loggedDays > 0 ? Math.round((weekFatSum / loggedDays) * 10) / 10 : 0;

        overallKcalSum += weekKcalSum;
        overallLoggedDays += loggedDays;

        return {
            weekIndex: idx,
            weekStart: interval.weekStart,
            weekEnd: interval.weekEnd,
            label: interval.label,
            avgDailyKcal,
            totalKcal: Math.round(weekKcalSum),
            loggedDaysCount: loggedDays,
            avgCarbs,
            avgPro,
            avgFat
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

export function calculatePearsonCorrelation(x: number[], y: number[]): number | null {
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length || x.length < 3) {
        return null;
    }

    const n = x.length;
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
    }
    const meanX = sumX / n;
    const meanY = sumY / n;

    let cov = 0;
    let varX = 0;
    let varY = 0;

    for (let i = 0; i < n; i++) {
        const dx = x[i] - meanX;
        const dy = y[i] - meanY;
        cov += dx * dy;
        varX += dx * dx;
        varY += dy * dy;
    }

    if (varX <= 1e-8 || varY <= 1e-8) {
        return 0;
    }

    const r = cov / Math.sqrt(varX * varY);
    if (isNaN(r)) return null;
    return Math.round(Math.max(-1, Math.min(1, r)) * 100) / 100;
}

export function computeVolumeCaloriesCorrelation(
    history: WorkoutSession[] | null | undefined = [],
    nutrition: Record<string, NutritionDay> | null | undefined = {},
    library: Exercise[] | null | undefined = [],
    userWeight: number = 80,
    numWeeks: number = 8,
    referenceDate: Date | string = new Date()
): { points: VolumeCaloriesPoint[]; stats: VolumeCaloriesCorrelationStats } {
    const { points: volumePoints } = computeWeeklyVolumeSeries(history, library, userWeight, numWeeks, referenceDate);
    const { points: nutritionPoints } = computeWeeklyNutritionSeries(nutrition, numWeeks, referenceDate);

    const points: VolumeCaloriesPoint[] = volumePoints.map((vp, idx) => {
        const np = nutritionPoints[idx] || { avgDailyKcal: 0, loggedDaysCount: 0 };
        return {
            weekIndex: idx,
            weekStart: vp.weekStart,
            weekEnd: vp.weekEnd,
            label: vp.label,
            volumeKg: vp.volumeKg,
            volumeTon: vp.volumeTon,
            avgDailyKcal: np.avgDailyKcal,
            workoutCount: vp.workoutCount,
            loggedNutritionDays: np.loggedDaysCount
        };
    });

    const validPairs = points.filter(p => p.volumeKg > 0 && p.avgDailyKcal > 0);
    const hasData = validPairs.length > 0;

    const xVals = validPairs.map(p => p.volumeKg);
    const yVals = validPairs.map(p => p.avgDailyKcal);
    const correlation = calculatePearsonCorrelation(xVals, yVals);

    let correlationInsight = 'Dati insufficienti nelle settimane selezionate per stimare una correlazione affidabile.';

    if (correlation !== null && validPairs.length >= 3) {
        if (correlation >= 0.6) {
            correlationInsight = 'Forte correlazione positiva: l\'apporto energetico supporta l\'aumento dei carichi e del volume di lavoro.';
        } else if (correlation >= 0.2) {
            correlationInsight = 'Moderata correlazione positiva: il volume tende a salire nelle settimane con maggior introito calorico.';
        } else if (correlation > -0.2) {
            correlationInsight = 'Correlazione neutra: il volume di allenamento è indipendente dalle oscillazioni caloriche registrate.';
        } else if (correlation > -0.6) {
            correlationInsight = 'Moderata correlazione inversa: il volume di allenamento si è mantenuto alto anche con apporto calorico contenuto.';
        } else {
            correlationInsight = 'Forte correlazione inversa: marcata discrepanza tra volume di allenamento ed apporto calorico.';
        }
    } else if (hasData) {
        correlationInsight = 'Registra più settimane con allenamenti e nutrizione per sbloccare l\'analisi predittiva della correlazione.';
    }

    const totalVol = points.reduce((sum, p) => sum + p.volumeKg, 0);
    const avgWeeklyVolumeKg = points.length > 0 ? Math.round(totalVol / points.length) : 0;

    const loggedKcalPoints = points.filter(p => p.avgDailyKcal > 0);
    const avgDailyKcal = loggedKcalPoints.length > 0
        ? Math.round(loggedKcalPoints.reduce((sum, p) => sum + p.avgDailyKcal, 0) / loggedKcalPoints.length)
        : 0;

    const stats: VolumeCaloriesCorrelationStats = {
        hasData,
        correlationCoefficient: correlation,
        correlationInsight,
        avgWeeklyVolumeKg,
        avgDailyKcal,
        validDataPointsCount: validPairs.length
    };

    return { points, stats };
}
