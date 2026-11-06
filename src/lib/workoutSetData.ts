import type { SessionExerciseSet } from '../types';

const hasEnteredValue = (value: unknown): boolean => {
    if (value === undefined || value === null) return false;
    const text = String(value).trim();
    if (text === '') return false;
    const numeric = Number(text.replace(',', '.'));
    return Number.isNaN(numeric) || numeric !== 0;
};

export function sessionSetHasMeaningfulData(set: Partial<SessionExerciseSet>): boolean {
    if (
        hasEnteredValue(set.kg)
        || hasEnteredValue(set.reps)
        || hasEnteredValue(set.time)
        || hasEnteredValue(set.distance)
        || hasEnteredValue(set.speed)
        || hasEnteredValue(set.incline)
        || hasEnteredValue(set.kcal)
        || set.rir !== undefined
        || Boolean(set.target)
        || (set.technique !== undefined && set.technique !== 'straight')
    ) {
        return true;
    }

    if (set.segments?.some(segment => (
        hasEnteredValue(segment.kg)
        || hasEnteredValue(segment.reps)
        || hasEnteredValue(segment.time)
        || segment.restBeforeSeconds !== undefined
        || segment.target !== undefined
    ))) {
        return true;
    }

    return false;
}
