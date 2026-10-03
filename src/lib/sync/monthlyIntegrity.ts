import type { NutritionDay, WorkoutSession } from '../../types';
import { normalizeBusinessId } from '../businessIdentity';
import { getLocalDateString } from '../utils/date';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isCanonicalLocalDate(date: unknown): date is string {
    return typeof date === 'string'
        && DATE_RE.test(date)
        && getLocalDateString(new Date(`${date}T12:00:00`)) === date;
}

export function requireCanonicalWorkoutDate(workout: Pick<WorkoutSession, 'date' | 'globalStartTime'>, label = 'Allenamento'): string {
    if (isCanonicalLocalDate(workout.date)) return workout.date;
    if (typeof workout.globalStartTime === 'number' && Number.isFinite(workout.globalStartTime)) {
        return getLocalDateString(workout.globalStartTime);
    }
    throw new Error(`${label}: identità temporale non valida`);
}

export function assertHistoryMonthDocument(month: string, data: Record<string, unknown>): void {
    if (!MONTH_RE.test(month)) throw new Error(`Shard storico non valido: ${month}`);
    for (const [key, raw] of Object.entries(data)) {
        const id = normalizeBusinessId(key);
        if (!id || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error(`Shard storico ${month}: entità non valida`);
        }
        const workout = raw as WorkoutSession;
        const embeddedId = normalizeBusinessId(workout.id);
        if (!embeddedId || embeddedId !== id) {
            throw new Error(`Shard storico ${month}: identità ${key} incoerente`);
        }
        const date = requireCanonicalWorkoutDate(workout, `Shard storico ${month}/${key}`);
        if (date.slice(0, 7) !== month) {
            throw new Error(`Shard storico ${month}: workout ${key} appartiene a ${date.slice(0, 7)}`);
        }
    }
}

export function assertNutritionMonthDocument(month: string, data: Record<string, unknown>): void {
    if (!MONTH_RE.test(month)) throw new Error(`Shard nutrizione non valido: ${month}`);
    for (const [date, raw] of Object.entries(data)) {
        if (!isCanonicalLocalDate(date) || date.slice(0, 7) !== month || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error(`Shard nutrizione ${month}: giornata ${date} non valida`);
        }
        const day = raw as NutritionDay;
        if (day.date !== date) {
            throw new Error(`Shard nutrizione ${month}: chiave ${date} diversa da day.date`);
        }
    }
}
