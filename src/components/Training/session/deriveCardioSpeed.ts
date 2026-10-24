import type { SessionExerciseSet } from '../../../types';

// Cardio speed is a derived UI value, not a separate workout operation.
// Preserve the existing decimal-comma, blank and incomplete-input semantics.
export function deriveCardioSpeed(
    currentSet: Pick<SessionExerciseSet, 'time' | 'distance'>,
    field: 'time' | 'distance',
    value: string,
): string | undefined {
    const newTimeStr = field === 'time' ? value : (currentSet.time || '');
    const newDistStr = field === 'distance' ? value : (currentSet.distance || '');

    // parseFloat also accepts malformed suffixes (for example "5km") and Infinity.
    // Only complete, finite, nonnegative decimal metrics may produce a saved speed.
    const parseMetric = (input: string): number | null => {
        const normalized = input.trim().replace(',', '.');
        if (!/^(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)$/.test(normalized)) return null;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    };
    const timeVal = parseMetric(newTimeStr);
    const distVal = parseMetric(newDistStr);

    if (timeVal !== null && timeVal > 0 && distVal !== null && distVal >= 0) {
        const speed = distVal / (timeVal / 60);
        return Number.isFinite(speed) ? speed.toFixed(2) : undefined;
    }
    if (newTimeStr.trim() === '' || newDistStr.trim() === '') return '';
    return undefined;
}
