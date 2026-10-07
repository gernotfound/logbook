import { readDeviceValueStrict, writeDeviceValue } from '../sync/deviceStorage';
import { storageOwner } from '../sync/session';

type WorkoutTimerState = 'stopped' | 'running' | 'paused';

export interface WorkoutTimerSnapshot {
    version: 1;
    state: WorkoutTimerState;
    startTime: number;
    accumulated: number;
}

const TIMER_STORAGE_KEY = 'timer';
const OBSOLETE_TIMER_KEYS = ['timer_state', 'timer_start', 'timer_accumulated'] as const;

export const stoppedWorkoutTimer = (): WorkoutTimerSnapshot => ({
    version: 1,
    state: 'stopped',
    startTime: 0,
    accumulated: 0,
});

function finiteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizeTimerSnapshot(value: unknown): WorkoutTimerSnapshot | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<WorkoutTimerSnapshot>;
    if (candidate.version !== 1) return null;
    if (candidate.state !== 'stopped' && candidate.state !== 'running' && candidate.state !== 'paused') return null;
    if (!finiteNonNegative(candidate.startTime) || !finiteNonNegative(candidate.accumulated)) return null;

    if (candidate.state === 'stopped') return stoppedWorkoutTimer();
    if (candidate.state === 'running' && candidate.startTime <= 0) return null;

    return {
        version: 1,
        state: candidate.state,
        startTime: candidate.state === 'paused' ? 0 : candidate.startTime,
        accumulated: candidate.accumulated,
    };
}

function purgeObsoleteTimerValues(owner: string): void {
    for (const key of OBSOLETE_TIMER_KEYS) {
        try {
            writeDeviceValue(key, null, owner);
        } catch (error) {
            // Obsolete keys are never read; cleanup is best-effort only.
            console.warn('Impossibile rimuovere una vecchia chiave del timer:', error);
        }
    }
}

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
    purgeObsoleteTimerValues(owner);
}

export const resetGlobalWorkoutTimer = (owner = storageOwner()): boolean => {
    try {
        // Persist an explicit stopped snapshot instead of deleting the canonical key.
        writeWorkoutTimerSnapshot(stoppedWorkoutTimer(), owner);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('logbook_reset_timer'));
        }
        return true;
    } catch (error) {
        console.error('Errore reset timer:', error);
        return false;
    }
};

export const formatTimerMs = (ms: number) => {
    const elapsed = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};
