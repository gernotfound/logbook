import type { NutritionDay, WorkoutSession } from '../../types';
import { getWorkoutDurationSeconds } from './workoutDuration';
import { finiteSum, roundFinite } from './finiteAnalyticsMath';
import {
    computeProgressionEngine,
    type DensityProgressionAnalysis,
    type ExerciseProgressionAnalysis,
    type ProgressionBodyweightContext,
    type ProgressionExerciseRef,
} from './progression';

interface SetEffortComparison {
    setNumber: number;
    currentKg: string;
    previousKg: string;
    currentReps: string;
    previousReps: string;
    currentRir?: number;
    previousRir?: number;
}

interface ExerciseComparison {
    exId: string;
    exName: string;
    currentVolume: number;
    previousVolume: number;
    volumeDelta: number | null;
    volumeDeltaPercent: number | null;
    currentReps: number;
    previousReps: number;
    repsDelta: number | null;
    currentAvgWeight: number;
    previousAvgWeight: number;
    weightDelta: number | null;
    setEffortComparisons: SetEffortComparison[];
    isPR: boolean;
    progression: ExerciseProgressionAnalysis;
}

export interface WorkoutReport {
    isFirstSession: boolean;
    workoutId: string;
    workoutName: string;
    date: string;
    durationSeconds: number;
    totalVolume: number;
    totalVolumeIsComplete: boolean;
    previousTotalVolume?: number;
    previousVolumeIsComplete?: boolean;
    volumeDeltaPercent?: number;
    exerciseComparisons: ExerciseComparison[];
    newPRs: ExerciseComparison[];
    density?: DensityProgressionAnalysis;
}

export interface WorkoutReportContext extends ProgressionBodyweightContext {
    nutrition?: Record<string, NutritionDay>;
}

function averageObservedWeight(exposure: ExerciseProgressionAnalysis['current']): number {
    let count = 0;
    let average = 0;
    const includeObserved = (weight: number | undefined, reps: number | undefined): void => {
        if (weight === undefined || !reps) return;
        count++;
        // A rolling weighted mean avoids overflowing the sum of finite loads.
        average = average * ((count - 1) / count) + weight / count;
    };
    for (const set of exposure.sets) {
        includeObserved(set.effectiveKg, set.reps);
        for (const segment of set.segments) includeObserved(segment.effectiveKg, segment.reps);
    }
    return count > 0 ? roundFinite(average, 10) : 0;
}

function sumExerciseVolumes(
    exposures: ExerciseProgressionAnalysis['current'][],
): { total: number; complete: boolean } {
    let total = 0;
    let complete = true;
    for (const exposure of exposures) {
        // Cardio and timed sets have no mechanical tonnage to complete.
        if (exposure.trackingType === 'cardio' || exposure.trackingType === 'time') continue;
        if (!exposure.tonnageComplete || exposure.tonnageKg === undefined) {
            complete = false;
            continue;
        }
        const next = finiteSum(total, exposure.tonnageKg);
        if (next === null) {
            complete = false;
            continue;
        }
        total = next;
    }
    return { total, complete };
}

function stringifyMetric(value: number | undefined): string {
    return value === undefined ? '' : String(value);
}

function buildSetEffortComparisons(progression: ExerciseProgressionAnalysis): SetEffortComparison[] {
    const currentSets = progression.current.sets;
    const previousSets = progression.previousComparable?.sets || [];
    const length = Math.max(currentSets.length, previousSets.length);
    const comparisons: SetEffortComparison[] = [];

    for (let index = 0; index < length; index++) {
        const current = currentSets[index];
        const previous = previousSets[index];
        if (current?.rir === undefined && previous?.rir === undefined) continue;
        comparisons.push({
            setNumber: index + 1,
            currentKg: stringifyMetric(current?.kg),
            previousKg: stringifyMetric(previous?.kg),
            currentReps: stringifyMetric(current?.reps),
            previousReps: stringifyMetric(previous?.reps),
            ...(current?.rir !== undefined ? { currentRir: current.rir } : {}),
            ...(previous?.rir !== undefined ? { previousRir: previous.rir } : {}),
        });
    }
    return comparisons;
}

export function computeWorkoutReport(
    currentWorkout: WorkoutSession,
    history: WorkoutSession[] = [],
    libraryMap?: Map<string, ProgressionExerciseRef> | null,
    userWeight?: number,
    context: WorkoutReportContext = {},
): WorkoutReport {
    const progressionContext: ProgressionBodyweightContext = {
        ...context,
        ...(userWeight !== undefined ? { explicitBodyweightKg: userWeight } : {}),
    };
    const engine = computeProgressionEngine(
        currentWorkout,
        history,
        libraryMap ?? new Map<string, ProgressionExerciseRef>(),
        progressionContext,
    );

    const exerciseComparisons: ExerciseComparison[] = engine.exercises.map(progression => {
        const currentVolume = progression.current.tonnageKg ?? 0;
        const previousVolume = progression.previousComparable?.tonnageKg ?? 0;
        const volumeIsComparable = progression.current.tonnageComplete
            && (!progression.previousComparable || progression.previousComparable.tonnageComplete);
        const volumeDelta = volumeIsComparable ? finiteSum(currentVolume, -previousVolume) : null;
        const rawVolumeDeltaPercent = volumeDelta === null
            ? null
            : previousVolume > 0
                ? (volumeDelta / previousVolume) * 100
                : currentVolume > 0 && progression.previousComparable
                    ? 100
                    : 0;
        const volumeDeltaPercent = rawVolumeDeltaPercent !== null && Number.isFinite(rawVolumeDeltaPercent)
            ? rawVolumeDeltaPercent
            : null;
        const currentReps = progression.current.totalReps;
        const previousReps = progression.previousComparable?.totalReps ?? 0;
        const currentAvgWeight = averageObservedWeight(progression.current);
        const previousAvgWeight = progression.previousComparable
            ? averageObservedWeight(progression.previousComparable)
            : 0;
        const rawWeightDelta = finiteSum(currentAvgWeight, -previousAvgWeight);

        return {
            exId: progression.exId,
            exName: progression.exName,
            currentVolume,
            previousVolume,
            volumeDelta,
            volumeDeltaPercent,
            currentReps,
            previousReps,
            repsDelta: finiteSum(currentReps, -previousReps),
            currentAvgWeight,
            previousAvgWeight,
            weightDelta: rawWeightDelta === null ? null : roundFinite(rawWeightDelta, 10),
            setEffortComparisons: buildSetEffortComparisons(progression),
            isPR: progression.isRecord,
            progression,
        };
    });

    const { total: totalVolume, complete: totalVolumeIsComplete } = sumExerciseVolumes(
        engine.exercises.map(progression => progression.current),
    );
    const comparisonsWithPrevious = exerciseComparisons.filter(comparison => comparison.progression.previousComparable);
    const { total: previousTotalVolume, complete: previousVolumeIsComplete } = sumExerciseVolumes(
        comparisonsWithPrevious.map(comparison => comparison.progression.previousComparable!),
    );
    const { total: comparableCurrentVolume, complete: comparableCurrentVolumeIsComplete } = sumExerciseVolumes(
        comparisonsWithPrevious.map(comparison => comparison.progression.current),
    );

    const report: WorkoutReport = {
        isFirstSession: engine.exercises.every(progression => !progression.previousComparable),
        workoutId: currentWorkout.id || '',
        workoutName: currentWorkout.routineName || 'Sessione',
        date: currentWorkout.date || '',
        durationSeconds: getWorkoutDurationSeconds(currentWorkout) ?? 0,
        totalVolume,
        totalVolumeIsComplete,
        exerciseComparisons,
        newPRs: exerciseComparisons.filter(comparison => comparison.isPR),
        ...(engine.density ? { density: engine.density } : {}),
    };

    if (comparisonsWithPrevious.length > 0) {
        report.previousTotalVolume = previousTotalVolume;
        report.previousVolumeIsComplete = previousVolumeIsComplete;
        if (comparableCurrentVolumeIsComplete && previousVolumeIsComplete && previousTotalVolume > 0) {
            const delta = finiteSum(comparableCurrentVolume, -previousTotalVolume);
            const percent = delta === null ? NaN : (delta / previousTotalVolume) * 100;
            if (Number.isFinite(percent)) report.volumeDeltaPercent = percent;
        }
    }

    return report;
}
