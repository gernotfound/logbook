import type { WorkoutSession } from '../../types';
import { parseManualDuration } from '../utils/date';

/** The explicitly edited duration takes precedence over stale session timestamps. */
export function getWorkoutDurationSeconds(
    workout: Pick<WorkoutSession, 'manualDurationStr' | 'globalDurationStr' | 'globalStartTime' | 'globalEndTime'>,
): number | undefined {
    for (const raw of [workout.manualDurationStr, workout.globalDurationStr]) {
        if (!raw?.trim()) continue;
        const normalized = parseManualDuration(raw);
        if (normalized === null) continue;
        const [hours, minutes, seconds] = normalized.split(':').map(Number);
        return hours * 3600 + minutes * 60 + seconds;
    }

    const { globalStartTime: start, globalEndTime: end } = workout;
    if (typeof start === 'number' && Number.isFinite(start)
        && typeof end === 'number' && Number.isFinite(end) && end >= start) {
        return Math.floor((end - start) / 1000);
    }
    return undefined;
}
