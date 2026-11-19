import { parseISO, isValid } from 'date-fns';
import { calculateWorkoutVolume } from './workout';
import { Logic } from '../logic';
import type { WorkoutSession, Exercise, NutritionDay } from '../../types';
import { addFiniteVolume } from './finiteAnalyticsMath';
import { generateWeekIntervals, referenceDayFor } from './weekIntervals';
import { computeWeeklyActivitySeries, computeWeeklyNutritionSeries } from './weeklyHealthMetrics';

export { generateWeekIntervals } from './weekIntervals';
export { computeWeeklyNutritionSeries, computeWeeklyActivitySeries, computeWeeklyWeightSeries } from './weeklyHealthMetrics';

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

export interface WeeklyActivityPoint {
    weekIndex: number;
    weekStart: string;
    weekEnd: string;
    label: string;
    averageSteps: number | null;
    totalSteps: number;
    stepDaysCount: number;
    daysConsidered: number;
    cardioMinutes: number;
    cardioSessionsCount: number;
    cardioMinutesByIntensity: { low: number; moderate: number; high: number; unclassified: number };
}

export interface WeeklyActivityStats {
    hasData: boolean;
    totalSteps: number;
    stepDaysCount: number;
    cardioMinutes: number;
    cardioSessionsCount: number;
}

export interface WeeklyWeightPoint {
    weekIndex: number;
    weekStart: string;
    weekEnd: string;
    label: string;
    averageWeightKg: number | null;
    recordedDaysCount: number;
    daysConsidered: number;
}

export interface WeeklyWeightStats {
    hasData: boolean;
    latestAverageWeightKg: number | null;
    latestRecordedDaysCount: number;
    latestDaysConsidered: number;
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
            // Only calendar-valid ISO day keys/timestamps may enter weekly analytics buckets.
            if (/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(clean) && isValid(parseISO(clean))) {
                return clean.slice(0, 10);
            }
        }
    }
    const validTimestamp = (value: unknown): value is number =>
        typeof value === 'number' && Number.isFinite(value) && isValid(new Date(value));
    const ts = validTimestamp(w.globalStartTime)
        ? w.globalStartTime
        : (validTimestamp(w.globalEndTime) ? w.globalEndTime : null);

    if (ts !== null) {
        return Logic.getLocalDateString(ts);
    }
    return null;
}

type WeeklyVolumeResult = { points: WeeklyVolumePoint[]; stats: WeeklyVolumeStats };

function* computeWeeklyVolumeSteps(
    history: WorkoutSession[] | null | undefined = [],
    library: Exercise[] | null | undefined = [],
    userWeight: number = 80,
    numWeeks: number = 8,
    referenceDate: Date | string = new Date()
): Generator<void, WeeklyVolumeResult, void> {
    const safeHistory = Array.isArray(history) ? history : [];
    const safeLibrary = Array.isArray(library) ? library : [];
    const safeUserWeight = Number.isFinite(userWeight) && userWeight > 0 ? userWeight : 80;

    const intervals = generateWeekIntervals(numWeeks, referenceDate);
    const libraryLookup = new Map<string, Exercise>();
    for (const exercise of safeLibrary) {
        if (exercise?.id) libraryLookup.set(exercise.id, exercise);
    }

    const firstDay = intervals[0].weekStart;
    const lastDay = intervals[intervals.length - 1].weekEnd;
    const referenceDay = referenceDayFor(referenceDate);
    // Aggregate in history order: session IDs and guarded finite sums keep their original semantics.
    const weeks = intervals.map(() => ({ volume: 0, workoutCount: 0, sessionIds: [] as string[] }));
    let scanned = 0;
    for (const session of safeHistory) {
        // Keep the main thread responsive when the Worker is unavailable.
        if (++scanned % 128 === 0) yield;
        const dateStr = getWorkoutDateString(session);
        if (!dateStr || dateStr < firstDay || dateStr > lastDay || dateStr > referenceDay) continue;
        let low = 0;
        let high = intervals.length - 1;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const interval = intervals[mid];
            if (dateStr < interval.weekStart) high = mid - 1;
            else if (dateStr > interval.weekEnd) low = mid + 1;
            else {
                const volume = calculateWorkoutVolume(session, libraryLookup, safeUserWeight);
                const bucket = weeks[mid];
                bucket.volume = addFiniteVolume(bucket.volume, Number.isFinite(volume) ? volume : 0);
                bucket.workoutCount++;
                if (session.id) bucket.sessionIds.push(session.id);
                break;
            }
        }
    }

    const points: WeeklyVolumePoint[] = intervals.map((interval, idx) => {
        const bucket = weeks[idx];
        const volumeKg = Math.round(bucket.volume);
        const volumeTon = Math.round((volumeKg / 1000) * 100) / 100;

        return {
            weekIndex: idx,
            weekStart: interval.weekStart,
            weekEnd: interval.weekEnd,
            label: interval.label,
            volumeKg,
            volumeTon,
            workoutCount: bucket.workoutCount,
            sessionIds: bucket.sessionIds
        };
    });

    const activePoints = points.filter(p => p.volumeKg > 0);
    const totalVolumeKg = points.reduce((sum, p) => addFiniteVolume(sum, p.volumeKg), 0);
    const totalWorkouts = points.reduce((sum, p) => sum + p.workoutCount, 0);
    const avgWeeklyVolumeKg = points.length > 0 ? Math.round(totalVolumeKg / points.length) : 0;
    const peakWeekVolumeKg = points.reduce((max, p) => Math.max(max, p.volumeKg), 0);

    const currentWeekVolumeKg = points.length > 0 ? points[points.length - 1].volumeKg : 0;
    const previousWeekVolumeKg = points.length > 1 ? points[points.length - 2].volumeKg : 0;

    let percentageChange: number | null = null;
    if (previousWeekVolumeKg > 0) {
        const change = Math.round(((currentWeekVolumeKg - previousWeekVolumeKg) / previousWeekVolumeKg) * 1000) / 10;
        percentageChange = Number.isFinite(change) ? change : null;
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

function finishWeeklyVolumeSteps(steps: Generator<void, WeeklyVolumeResult, void>): WeeklyVolumeResult {
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
}

export function computeWeeklyVolumeSeries(
    history: WorkoutSession[] | null | undefined = [],
    library: Exercise[] | null | undefined = [],
    userWeight: number = 80,
    numWeeks: number = 8,
    referenceDate: Date | string = new Date()
): { points: WeeklyVolumePoint[]; stats: WeeklyVolumeStats } {
    return finishWeeklyVolumeSteps(computeWeeklyVolumeSteps(history, library, userWeight, numWeeks, referenceDate));
}

export async function computeWeeklyVolumeSeriesCooperative(
    history: WorkoutSession[] | null | undefined = [],
    library: Exercise[] | null | undefined = [],
    userWeight: number = 80,
    numWeeks: number = 8,
    referenceDate: Date | string = new Date(),
    signal?: AbortSignal
): Promise<{ points: WeeklyVolumePoint[]; stats: WeeklyVolumeStats }> {
    if (signal?.aborted) throw new Error('Calcolo annullato: vista chiusa');
    const steps = computeWeeklyVolumeSteps(history, library, userWeight, numWeeks, referenceDate);
    let step = steps.next();
    while (!step.done) {
        // A real timer task gives the browser a chance to process input/paint.
        await new Promise<void>(resolve => { setTimeout(resolve, 0); });
        if (signal?.aborted) throw new Error('Calcolo annullato: vista chiusa');
        step = steps.next();
    }
    if (signal?.aborted) throw new Error('Calcolo annullato: vista chiusa');
    return step.value;
}

interface ReadinessTrendDimension {
    average: number | null;
    latest: number | null;
    previous: number | null;
    deltaFromPrevious: number | null;
    count: number;
}

export interface ReadinessTrendStats {
    energy: ReadinessTrendDimension;
    stress: ReadinessTrendDimension;
    motivation: ReadinessTrendDimension;
    muscleRecovery: ReadinessTrendDimension;
    sessionsWithReadiness: number;
}

/** Uses the recorded check-in time when an imported session lacks workout timestamps. */
function readinessChronologyTimestamp(session: WorkoutSession): number {
    const values = [session.globalStartTime, session.globalEndTime, session.readiness?.capturedAt];
    return values.find(value => typeof value === 'number' && Number.isFinite(value)) ?? 0;
}

export function computeReadinessTrends(
    history: WorkoutSession[] | null | undefined = [],
    maxSessions: number = 12
): ReadinessTrendStats {
    const sessions = (Array.isArray(history) ? history : [])
        .filter(session => session?.readiness)
        .map(session => ({
            session,
            day: getWorkoutDateString(session) ?? '',
            time: readinessChronologyTimestamp(session),
        }))
        .sort((a, b) => b.day.localeCompare(a.day) || b.time - a.time)
        .slice(0, Math.max(1, maxSessions))
        .map(({ session }) => session);

    const dimension = (key: 'energy' | 'stress' | 'motivation' | 'muscleRecovery'): ReadinessTrendDimension => {
        const values = sessions
            .map(session => session.readiness?.[key])
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5);
        const latest = values[0] ?? null;
        const previous = values[1] ?? null;
        return {
            average: values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null,
            latest,
            previous,
            deltaFromPrevious: latest !== null && previous !== null ? Math.round((latest - previous) * 10) / 10 : null,
            count: values.length,
        };
    };

    return {
        energy: dimension('energy'),
        stress: dimension('stress'),
        motivation: dimension('motivation'),
        muscleRecovery: dimension('muscleRecovery'),
        sessionsWithReadiness: sessions.length,
    };
}

export interface WeeklyTrainingActivityPoint extends WeeklyActivityPoint {
    workoutCount: number;
    volumeKg: number;
}

export function computeWeeklyTrainingActivityContext(
    history: WorkoutSession[] | null | undefined,
    nutrition: Record<string, NutritionDay> | null | undefined,
    library: Exercise[] | null | undefined,
    userWeight: number,
    numWeeks: number = 8,
    referenceDate: Date | string = new Date()
): WeeklyTrainingActivityPoint[] {
    const volume = computeWeeklyVolumeSeries(history, library, userWeight, numWeeks, referenceDate).points;
    const activity = computeWeeklyActivitySeries(nutrition, numWeeks, referenceDate).points;
    return activity.map((point, index) => ({
        ...point,
        workoutCount: volume[index]?.workoutCount ?? 0,
        volumeKg: volume[index]?.volumeKg ?? 0,
    }));
}

export function calculatePearsonCorrelation(x: number[], y: number[]): number | null {
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length || x.length < 3) {
        return null;
    }

    const n = x.length;
    let scaleX = 0;
    let scaleY = 0;
    for (let i = 0; i < n; i++) {
        if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) return null;
        scaleX = Math.max(scaleX, Math.abs(x[i]));
        scaleY = Math.max(scaleY, Math.abs(y[i]));
    }
    if (scaleX === 0 || scaleY === 0) return 0;

    // Normalizing before computing means and variance avoids overflow and keeps
    // genuinely small changes measurable instead of applying an absolute cutoff.
    let meanX = 0;
    let meanY = 0;
    for (let i = 0; i < n; i++) {
        meanX += (x[i] / scaleX - meanX) / (i + 1);
        meanY += (y[i] / scaleY - meanY) / (i + 1);
    }

    let cov = 0;
    let varX = 0;
    let varY = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] / scaleX - meanX;
        const dy = y[i] / scaleY - meanY;
        cov += dx * dy;
        varX += dx * dx;
        varY += dy * dy;
    }
    if (varX === 0 || varY === 0) return 0;

    const r = cov / Math.sqrt(varX * varY);
    if (!Number.isFinite(r)) return null;
    return Math.round(Math.max(-1, Math.min(1, r)) * 100) / 100;
}

function correlateVolumeAndNutrition(
    volumePoints: WeeklyVolumePoint[],
    nutrition: Record<string, NutritionDay> | null | undefined,
    numWeeks: number,
    referenceDate: Date | string
): { points: VolumeCaloriesPoint[]; stats: VolumeCaloriesCorrelationStats } {
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
            correlationInsight = 'Associazione positiva forte osservata nelle settimane disponibili. Non indica un rapporto di causa-effetto.';
        } else if (correlation >= 0.2) {
            correlationInsight = 'Associazione positiva moderata osservata nelle settimane disponibili. Non indica un rapporto di causa-effetto.';
        } else if (correlation > -0.2) {
            correlationInsight = 'Nessuna associazione lineare evidente nelle settimane disponibili.';
        } else if (correlation > -0.6) {
            correlationInsight = 'Associazione inversa moderata osservata nelle settimane disponibili. Non indica un rapporto di causa-effetto.';
        } else {
            correlationInsight = 'Associazione inversa forte osservata nelle settimane disponibili. Non indica un rapporto di causa-effetto.';
        }
    } else if (hasData) {
        correlationInsight = 'Servono almeno 3 settimane confrontabili con allenamento e nutrizione registrati per stimare l\'associazione lineare.';
    }

    const totalVol = points.reduce((sum, p) => addFiniteVolume(sum, p.volumeKg), 0);
    const avgWeeklyVolumeKg = points.length > 0 ? Math.round(totalVol / points.length) : 0;

    const loggedKcalPoints = points.filter(p => p.avgDailyKcal > 0);
    let averageKcal = 0;
    for (let index = 0; index < loggedKcalPoints.length; index++) {
        averageKcal += (loggedKcalPoints[index].avgDailyKcal - averageKcal) / (index + 1);
    }
    const avgDailyKcal = loggedKcalPoints.length > 0 ? Math.round(averageKcal) : 0;

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

/** Reuse a computed volume series without scanning the workout history twice. */
export function computeVolumeCaloriesCorrelationFromVolume(
    volumePoints: WeeklyVolumePoint[],
    nutrition: Record<string, NutritionDay> | null | undefined = {},
    numWeeks = 8,
    referenceDate: Date | string = new Date(),
): { points: VolumeCaloriesPoint[]; stats: VolumeCaloriesCorrelationStats } {
    return correlateVolumeAndNutrition(volumePoints, nutrition, numWeeks, referenceDate);
}

export function computeVolumeCaloriesCorrelation(
    history: WorkoutSession[] | null | undefined = [],
    nutrition: Record<string, NutritionDay> | null | undefined = {},
    library: Exercise[] | null | undefined = [],
    userWeight: number = 80,
    numWeeks: number = 8,
    referenceDate: Date | string = new Date()
): { points: VolumeCaloriesPoint[]; stats: VolumeCaloriesCorrelationStats } {
    const { points } = computeWeeklyVolumeSeries(history, library, userWeight, numWeeks, referenceDate);
    return correlateVolumeAndNutrition(points, nutrition, numWeeks, referenceDate);
}

export async function computeVolumeCaloriesCorrelationCooperative(
    history: WorkoutSession[] | null | undefined = [],
    nutrition: Record<string, NutritionDay> | null | undefined = {},
    library: Exercise[] | null | undefined = [],
    userWeight: number = 80,
    numWeeks: number = 8,
    referenceDate: Date | string = new Date(),
    signal?: AbortSignal
): Promise<{ points: VolumeCaloriesPoint[]; stats: VolumeCaloriesCorrelationStats }> {
    const { points } = await computeWeeklyVolumeSeriesCooperative(history, library, userWeight, numWeeks, referenceDate, signal);
    if (signal?.aborted) throw new Error('Calcolo annullato: vista chiusa');
    return correlateVolumeAndNutrition(points, nutrition, numWeeks, referenceDate);
}
