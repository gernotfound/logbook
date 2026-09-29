import type { SessionExerciseSet } from '../types';

type SessionSetLike = Partial<SessionExerciseSet> & {
    weight?: unknown;
    timeInSeconds?: unknown;
};

const hasEnteredValue = (value: unknown): boolean => {
    if (value === undefined || value === null) return false;
    return typeof value !== 'string' || value.trim() !== '';
};

export function sessionSetHasMeaningfulData(set: SessionSetLike): boolean {
    if (
        hasEnteredValue(set.kg)
        || hasEnteredValue(set.weight)
        || hasEnteredValue(set.reps)
        || hasEnteredValue(set.time)
        || hasEnteredValue(set.timeInSeconds)
        || hasEnteredValue(set.distance)
        || hasEnteredValue(set.speed)
        || hasEnteredValue(set.incline)
        || hasEnteredValue(set.kcal)
        || set.rir !== undefined
        || set.done === true
        || Boolean(set.target)
        || (set.executionMode !== undefined && set.executionMode !== 'standard')
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
        || segment.technique !== undefined
    ))) {
        return true;
    }

    if (set.dropsets?.some(drop => hasEnteredValue(drop.kg) || hasEnteredValue(drop.reps))) {
        return true;
    }

    return Boolean(set.isometrics?.some(iso => hasEnteredValue(iso.kg) || hasEnteredValue(iso.time)));
}
