import type { WorkoutSession } from '../../../types';
import { Logic } from '../../../lib/logic';

export function workoutDateKey(workout: WorkoutSession): string | null {
    const explicitDate = workout.date ? Logic.parseDateInput(workout.date) : null;
    if (explicitDate && explicitDate === workout.date) return explicitDate;
    if (typeof workout.globalStartTime === 'number' && Number.isFinite(workout.globalStartTime)) {
        const startedAt = new Date(workout.globalStartTime);
        if (Number.isFinite(startedAt.getTime())) return Logic.getLocalDateString(startedAt);
    }
    return null;
}

export function formatCompactDuration(seconds: number): string {
    const totalMinutes = Math.max(0, Math.round(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours} h${minutes ? ` ${minutes} min` : ''}`;
    return `${totalMinutes} min`;
}

const TIME_FORMATTER = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });

export function workoutStartTime(workout: WorkoutSession): string {
    if (typeof workout.globalStartTime !== 'number' || !Number.isFinite(workout.globalStartTime)) {
        return 'Orario n.d.';
    }
    const startedAt = new Date(workout.globalStartTime);
    if (!Number.isFinite(startedAt.getTime())) return 'Orario n.d.';
    return TIME_FORMATTER.format(startedAt);
}

