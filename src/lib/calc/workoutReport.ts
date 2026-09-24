import type { NutritionDay, WorkoutSession } from '../../types';
import {
    computeProgressionEngine,
    type DensityProgressionAnalysis,
    type ExerciseProgressionAnalysis,
    type ProgressionBodyweightContext,
    type ProgressionExerciseRef,
} from './progression';

export interface SetEffortComparison {
    setNumber: number;
    currentKg: string;
    previousKg: string;
    currentReps: string;
    previousReps: string;
    currentRir?: number;
    previousRir?: number;
}

export interface ExerciseComparison {
    exId: string;
    exName: string;
    currentVolume: number;
    previousVolume: number;
    volumeDelta: number;
    volumeDeltaPercent: number;
    currentReps: number;
    previousReps: number;
    repsDelta: number;
    currentAvgWeight: number;
    previousAvgWeight: number;
    weightDelta: number;
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

function durationSeconds(workout: WorkoutSession): number {
    const durationStr = workout.globalDurationStr || workout.manualDurationStr;
    if (durationStr) {
        const parts = durationStr.split(':').map(part => Number.parseInt(part, 10));
        if (parts.length === 3 && parts.every(part => Number.isFinite(part))) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
    }
    if (workout.globalStartTime && workout.globalEndTime && workout.globalEndTime >= workout.globalStartTime) {
        return Math.floor((workout.globalEndTime - workout.globalStartTime) / 1000);
    }
    return 0;
}

function averageObservedWeight(exposure: ExerciseProgressionAnalysis['current']): number {
    const weights: number[] = [];
    for (const set of exposure.sets) {
        if (set.effectiveKg !== undefined && set.reps) weights.push(set.effectiveKg);
        for (const segment of set.segments) {
            if (segment.effectiveKg !== undefined && segment.reps) weights.push(segment.effectiveKg);
        }
    }
    if (!weights.length) return 0;
    return Math.round((weights.reduce((sum, value) => sum + value, 0) / weights.length) * 10) / 10;
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
        const volumeDelta = currentVolume - previousVolume;
        const volumeDeltaPercent = previousVolume > 0
            ? (volumeDelta / previousVolume) * 100
            : currentVolume > 0 && progression.previousComparable
                ? 100
                : 0;
        const currentReps = progression.current.totalReps;
        const previousReps = progression.previousComparable?.totalReps ?? 0;
        const currentAvgWeight = averageObservedWeight(progression.current);
        const previousAvgWeight = progression.previousComparable
            ? averageObservedWeight(progression.previousComparable)
            : 0;

        return {
            exId: progression.exId,
            exName: progression.exName,
            currentVolume,
            previousVolume,
            volumeDelta,
            volumeDeltaPercent,
            currentReps,
            previousReps,
            repsDelta: currentReps - previousReps,
            currentAvgWeight,
            previousAvgWeight,
            weightDelta: Math.round((currentAvgWeight - previousAvgWeight) * 10) / 10,
            setEffortComparisons: buildSetEffortComparisons(progression),
            isPR: progression.isRecord,
            progression,
        };
    });

    const totalVolume = exerciseComparisons.reduce((sum, comparison) => sum + comparison.currentVolume, 0);
    const totalVolumeIsComplete = engine.exercises.every(progression => progression.current.tonnageComplete);
    const comparisonsWithPrevious = exerciseComparisons.filter(comparison => comparison.progression.previousComparable);
    const previousTotalVolume = comparisonsWithPrevious.reduce((sum, comparison) => sum + comparison.previousVolume, 0);
    const comparableCurrentVolume = comparisonsWithPrevious.reduce((sum, comparison) => sum + comparison.currentVolume, 0);
    const comparableCurrentVolumeIsComplete = comparisonsWithPrevious.every(comparison => comparison.progression.current.tonnageComplete);
    const previousVolumeIsComplete = comparisonsWithPrevious.every(
        comparison => comparison.progression.previousComparable?.tonnageComplete,
    );

    const report: WorkoutReport = {
        isFirstSession: engine.exercises.every(progression => !progression.previousComparable),
        workoutId: currentWorkout.id || '',
        workoutName: currentWorkout.routineName || 'Sessione',
        date: currentWorkout.date || '',
        durationSeconds: durationSeconds(currentWorkout),
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
            report.volumeDeltaPercent = ((comparableCurrentVolume - previousTotalVolume) / previousTotalVolume) * 100;
        }
    }

    return report;
}
