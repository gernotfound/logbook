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

    const timeVal = parseFloat(newTimeStr.replace(',', '.'));
    const distVal = parseFloat(newDistStr.replace(',', '.'));

    if (!Number.isNaN(timeVal) && !Number.isNaN(distVal) && timeVal > 0) {
        return (distVal / (timeVal / 60)).toFixed(2);
    }
    if (newTimeStr === '' || newDistStr === '') return '';
    return undefined;
}
