import { readDeviceValue, writeDeviceValue } from '../sync/deviceStorage';
import { storageOwner } from '../sync/session';

export type WorkoutTimerState = 'stopped' | 'running' | 'paused';

export interface WorkoutTimerSnapshot {
    version: 1;
    state: WorkoutTimerState;
    startTime: number;
    accumulated: number;
}

const TIMER_STORAGE_KEY = 'timer';

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

export function readWorkoutTimerSnapshot(owner = storageOwner()): WorkoutTimerSnapshot {
    const raw = readDeviceValue(TIMER_STORAGE_KEY, owner);
    if (raw === null) return stoppedWorkoutTimer();

    try {
        const parsed = normalizeTimerSnapshot(JSON.parse(raw));
        if (parsed) return parsed;
        console.warn('Snapshot timer non valido. Il timer viene ripristinato in stato fermo.');
    } catch (error) {
        console.warn('Snapshot timer non leggibile. Il timer viene ripristinato in stato fermo:', error);
    }
    return stoppedWorkoutTimer();
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
