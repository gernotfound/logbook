import { parseISO, isValid } from 'date-fns';
import { calculateWorkoutVolume } from './workout';
import { getLocalDateString } from '../utils/date';
import type { WorkoutSession, Exercise, NutritionDay } from '../../types';
import type { WeeklyVolumePoint, WeeklyVolumeStats, WeeklyActivityPoint } from './analytics';
import { addFiniteVolume } from './finiteAnalyticsMath';
import { generateWeekIntervals, referenceDayFor } from './weekIntervals';
import { computeWeeklyActivitySeries } from './weeklyHealthMetrics';

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
        return getLocalDateString(ts);
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
