import type { WorkoutSession, Exercise, NutritionDay } from '../../types';
import { addFiniteVolume } from './finiteAnalyticsMath';
import { computeWeeklyNutritionSeries } from './weeklyHealthMetrics';
import { computeWeeklyVolumeSeries, computeWeeklyVolumeSeriesCooperative } from './analyticsWeeklyVolume';
import type { WeeklyVolumePoint, VolumeCaloriesPoint, VolumeCaloriesCorrelationStats } from './analytics';

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
