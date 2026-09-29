import type { WorkoutSession } from '../../../types';

export interface RoutineDurationEstimate {
    minutes: number;
    sampleSize: number;
}

function workoutDurationSeconds(workout: WorkoutSession): number | null {
    if (
        typeof workout.globalStartTime === 'number'
        && typeof workout.globalEndTime === 'number'
        && workout.globalEndTime > workout.globalStartTime
    ) {
        return Math.round((workout.globalEndTime - workout.globalStartTime) / 1000);
    }

    const duration = workout.globalDurationStr || workout.manualDurationStr;
    if (!duration) return null;

    const parts = duration.split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part) || part < 0)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
}

export function getRoutineDurationEstimate(
    routineId: string,
    history: WorkoutSession[],
): RoutineDurationEstimate | null {
    const samples = history
        .filter(workout => workout.routineId === routineId)
        .map(workout => ({
            seconds: workoutDurationSeconds(workout),
            timestamp: workout.globalEndTime ?? workout.endTime ?? workout.globalStartTime ?? 0,
        }))
        .filter((sample): sample is { seconds: number; timestamp: number } => (
            sample.seconds !== null && sample.seconds > 0
        ))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5);

    if (samples.length < 3) return null;

    const ordered = samples.map(sample => sample.seconds).sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    const medianSeconds = ordered.length % 2 === 0
        ? (ordered[middle - 1] + ordered[middle]) / 2
        : ordered[middle];

    return {
        minutes: Math.max(1, Math.round(medianSeconds / 60)),
        sampleSize: samples.length,
    };
}
