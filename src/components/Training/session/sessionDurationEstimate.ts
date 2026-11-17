import type { WorkoutSession } from '../../../types';
import { getWorkoutDurationSeconds } from '../../../lib/calc/workoutDuration';

export interface RoutineDurationEstimate {
    minutes: number;
    sampleSize: number;
}

type DurationSample = { seconds: number; timestamp: number };

function estimateFromSamples(samples: DurationSample[]): RoutineDurationEstimate | null {
    const recent = samples.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
    if (recent.length < 3) return null;

    const ordered = recent.map(sample => sample.seconds).sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    const medianSeconds = ordered.length % 2 === 0
        ? (ordered[middle - 1] + ordered[middle]) / 2
        : ordered[middle];

    return {
        minutes: Math.max(1, Math.round(medianSeconds / 60)),
        sampleSize: recent.length,
    };
}

/** Group once: the session setup must not re-scan history for each routine. */
export function getRoutineDurationEstimates(
    routineIds: readonly string[],
    history: WorkoutSession[],
): Map<string, RoutineDurationEstimate> {
    const requested = new Set(routineIds);
    const grouped = new Map<string, DurationSample[]>();
    for (const workout of history) {
        const id = workout.routineId;
        if (id === undefined || !requested.has(id)) continue;
        const seconds = getWorkoutDurationSeconds(workout);
        if (seconds === undefined || seconds === null || seconds <= 0) continue;
        const samples = grouped.get(id) ?? [];
        samples.push({
            seconds,
            timestamp: workout.globalEndTime ?? workout.globalStartTime ?? 0,
        });
        // A stable descending order retains the original input order on equal timestamps.
        samples.sort((a, b) => b.timestamp - a.timestamp);
        if (samples.length > 5) samples.length = 5;
        grouped.set(id, samples);
    }

    const result = new Map<string, RoutineDurationEstimate>();
    for (const [id, samples] of grouped) {
        const estimate = estimateFromSamples(samples);
        if (estimate) result.set(id, estimate);
    }
    return result;
}

export function getRoutineDurationEstimate(
    routineId: string,
    history: WorkoutSession[],
): RoutineDurationEstimate | null {
    return getRoutineDurationEstimates([routineId], history).get(routineId) ?? null;
}
