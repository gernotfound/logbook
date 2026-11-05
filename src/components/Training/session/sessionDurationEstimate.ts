import type { WorkoutSession } from '../../../types';
import { getWorkoutDurationSeconds } from '../../../lib/calc/workoutDuration';

export interface RoutineDurationEstimate {
    minutes: number;
    sampleSize: number;
}

export function getRoutineDurationEstimate(
    routineId: string,
    history: WorkoutSession[],
): RoutineDurationEstimate | null {
    const samples = history
        .filter(workout => workout.routineId === routineId)
        .map(workout => ({
            seconds: getWorkoutDurationSeconds(workout) ?? null,
            timestamp: workout.globalEndTime ?? workout.globalStartTime ?? 0,
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
