type WorkoutTimerState = 'stopped' | 'running' | 'paused';

export interface WorkoutTimerSnapshot {
    version: 1;
    state: WorkoutTimerState;
    startTime: number;
    accumulated: number;
}

export const stoppedWorkoutTimer = (): WorkoutTimerSnapshot => ({
    version: 1,
    state: 'stopped',
    startTime: 0,
    accumulated: 0,
});

function finiteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function normalizeTimerSnapshot(value: unknown): WorkoutTimerSnapshot | null {
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

export function formatTimerMs(ms: number): string {
    const elapsed = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
