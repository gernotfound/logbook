import { readDeviceValueStrict, writeDeviceValue } from '../sync/deviceStorage';
import { storageOwner } from '../sync/session';
import { normalizeTimerSnapshot, stoppedWorkoutTimer, type WorkoutTimerSnapshot } from '../workoutTimerSnapshot';
export { stoppedWorkoutTimer, type WorkoutTimerSnapshot } from '../workoutTimerSnapshot';

const TIMER_STORAGE_KEY = 'timer';

class WorkoutTimerStorageCorruptError extends Error {
    readonly code = 'workout-timer-storage-corrupt';

    constructor(message = 'Snapshot timer locale non leggibile.') {
        super(message);
        this.name = 'WorkoutTimerStorageCorruptError';
    }
}

export function readWorkoutTimerSnapshot(owner = storageOwner()): WorkoutTimerSnapshot {
    const raw = readDeviceValueStrict(TIMER_STORAGE_KEY, owner);
    if (raw === null) return stoppedWorkoutTimer();

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new WorkoutTimerStorageCorruptError(
            error instanceof Error ? `Snapshot timer locale corrotto: ${error.message}` : undefined,
        );
    }

    const normalized = normalizeTimerSnapshot(parsed);
    if (!normalized) throw new WorkoutTimerStorageCorruptError('Snapshot timer locale non valido.');
    return normalized;
}

export function writeWorkoutTimerSnapshot(snapshot: WorkoutTimerSnapshot, owner = storageOwner()): void {
    const normalized = normalizeTimerSnapshot(snapshot);
    if (!normalized) throw new Error('Snapshot timer non valido.');

    // The timer is a single logical value. One Web Storage write prevents a page
    // interruption or quota/security error from persisting only part of its state.
    writeDeviceValue(TIMER_STORAGE_KEY, JSON.stringify(normalized), owner);
}

export const resetGlobalWorkoutTimer = (owner = storageOwner()): boolean => {
    try {
        // Persist an explicit stopped snapshot instead of deleting the canonical key.
        writeWorkoutTimerSnapshot(stoppedWorkoutTimer(), owner);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('logbook_reset_timer', { detail: { owner } }));
        }
        return true;
    } catch (error) {
        console.error('Errore reset timer:', error);
        return false;
    }
};
