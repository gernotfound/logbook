import { format, subDays } from 'date-fns';
import { GROUP_MAP } from '../constants/muscles';
import { getLocalDateString } from '../utils/date';
import type { Exercise, WorkoutSession } from '../../types';

function getHomeWorkoutTimestamp(workout: WorkoutSession | null | undefined): number | null {
    if (!workout) return null;
    if (typeof workout.globalStartTime === 'number' && !isNaN(workout.globalStartTime)) {
        return workout.globalStartTime;
    }
    if (typeof workout.globalEndTime === 'number' && !isNaN(workout.globalEndTime)) {
        return workout.globalEndTime;
    }
    if (workout.date) {
        const parsed = new Date(
            workout.date.includes('T') ? workout.date : `${workout.date}T12:00:00`,
        ).getTime();
        if (!isNaN(parsed)) return parsed;
    }
    return null;
}

export function getHomeWorkoutDate(workout: WorkoutSession | null | undefined): string | null {
    if (!workout) return null;
    if (workout.date) return workout.date;
    const timestamp = getHomeWorkoutTimestamp(workout);
    return timestamp ? getLocalDateString(timestamp) : null;
}

export function calculateHomeWorkoutStreak(history: WorkoutSession[], nowMs: number): number {
    if (history.length === 0) return 0;
    const workoutDates = new Set(history.map(getHomeWorkoutDate).filter((date): date is string => Boolean(date)));
    const today = new Date(nowMs);
    const todayStr = format(today, 'yyyy-MM-dd');
    const yesterdayStr = format(subDays(today, 1), 'yyyy-MM-dd');
    let current = workoutDates.has(todayStr)
        ? today
        : workoutDates.has(yesterdayStr) ? subDays(today, 1) : null;
    if (!current) return 0;

    let streak = 0;
    while (workoutDates.has(format(current, 'yyyy-MM-dd'))) {
        streak++;
        current = subDays(current, 1);
    }
    return streak;
}

export interface HomeMuscleExposure {
    time: number;
    muscles: string[];
}

/** The index is built only when workouts or the exercise library change. */
export function buildHomeMuscleExposureIndex(
    history: WorkoutSession[],
    library: ReadonlyMap<string, Exercise>,
): HomeMuscleExposure[] {
    const entries: HomeMuscleExposure[] = [];
    for (const workout of history) {
        const time = getHomeWorkoutTimestamp(workout);
        if (!time) continue;
        const muscles = new Set<string>();
        for (const exercise of workout.exercises || []) {
            const libraryExercise = library.get(exercise.exId);
            if (!libraryExercise) continue;
            const hasWorkSet = (exercise.sets || []).some(set => {
                const hasValues = (set.kg !== undefined && set.kg !== '')
                    || (set.reps !== undefined && set.reps !== '')
                    || (set.time !== undefined && set.time !== '');
                return set.done === true || hasValues || set.done === undefined;
            });
            if (!hasWorkSet) continue;
            for (const id of [...(libraryExercise.muscles || []), ...(libraryExercise.secondaryMuscles || [])]) {
                if (!id || typeof id !== 'string') continue;
                for (const atomic of GROUP_MAP[id] || [id]) muscles.add(atomic);
                muscles.add(id);
            }
        }
        if (muscles.size) entries.push({ time, muscles: [...muscles] });
    }
    return entries.sort((a, b) => a.time - b.time);
}

/** Includes the exact 72-hour boundary but excludes future-dated sessions. */
export function getRecentHomeMuscles(
    index: readonly HomeMuscleExposure[],
    nowMs: number,
): Set<string> {
    const earliest = nowMs - 72 * 60 * 60 * 1000;
    let low = 0;
    let high = index.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (index[mid].time <= nowMs) low = mid + 1;
        else high = mid;
    }
    const muscles = new Set<string>();
    for (let i = low - 1; i >= 0 && index[i].time >= earliest; i--) {
        for (const id of index[i].muscles) muscles.add(id);
    }
    return muscles;
}
