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

    // Adding an advanced segment is an intentional edit even before values are entered.
    if (set.segments?.length) return true;

    return false;
}
