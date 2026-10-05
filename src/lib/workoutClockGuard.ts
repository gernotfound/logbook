const CLOCK_JUMP_TOLERANCE_MS = 30_000;

type GuardState = {
    startTime: number;
    lastWall: number;
    lastMono: number;
    anomalous: boolean;
};

const guards = new Map<string, GuardState>();

export class WorkoutClockAnomalyError extends Error {
    readonly code = 'workout-clock-anomaly';

    constructor(message = 'L’orologio del dispositivo è cambiato durante l’allenamento.') {
        super(message);
        this.name = 'WorkoutClockAnomalyError';
    }
}

const monotonicNow = (): number => (
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : 0
);

function getOrCreate(workoutId: string, startTime: number, wallNow: number, monoNow: number): GuardState {
    const existing = guards.get(workoutId);
    if (existing && existing.startTime === startTime) return existing;

    const state: GuardState = {
        startTime,
        lastWall: wallNow,
        lastMono: monoNow,
        anomalous: wallNow + CLOCK_JUMP_TOLERANCE_MS < startTime,
    };
    guards.set(workoutId, state);
    return state;
}

export function sampleWorkoutClock(
    workoutId: string,
    startTime: number,
    wallNow = Date.now(),
    monoNow = monotonicNow(),
): { elapsedMs: number; anomalous: boolean } {
    const state = getOrCreate(workoutId, startTime, wallNow, monoNow);

    const wallDelta = wallNow - state.lastWall;
    const monoDelta = Math.max(0, monoNow - state.lastMono);
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible';

    // While visible, wall time and the process monotonic clock should advance
    // together. Large divergence is a system-clock adjustment, not timer drift.
    if (
        wallDelta < -CLOCK_JUMP_TOLERANCE_MS
        || (visible && Math.abs(wallDelta - monoDelta) > CLOCK_JUMP_TOLERANCE_MS)
    ) {
        state.anomalous = true;
    }

    state.lastWall = wallNow;
    state.lastMono = monoNow;

    return {
        elapsedMs: Math.max(0, wallNow - startTime),
        anomalous: state.anomalous,
    };
}

export function resumeWorkoutClock(
    workoutId: string,
    startTime: number,
    wallNow = Date.now(),
    monoNow = monotonicNow(),
): { anomalous: boolean } {
    const state = getOrCreate(workoutId, startTime, wallNow, monoNow);

    // A backwards wall-clock jump remains invalid even if it happened while the
    // process was backgrounded. Large forward jumps while hidden are ambiguous
    // with legitimate elapsed time, so the anchor is simply reset.
    if (wallNow < state.lastWall - CLOCK_JUMP_TOLERANCE_MS) state.anomalous = true;
    state.lastWall = wallNow;
    state.lastMono = monoNow;
    return { anomalous: state.anomalous };
}

export function assertWorkoutClockHealthy(
    workoutId: string,
    startTime: number,
    endTime: number,
): void {
    const sampled = sampleWorkoutClock(workoutId, startTime, endTime, monotonicNow());
    if (endTime + CLOCK_JUMP_TOLERANCE_MS < startTime || sampled.anomalous) {
        throw new WorkoutClockAnomalyError();
    }
}

export function resetWorkoutClockGuard(workoutId?: string): void {
    if (workoutId) guards.delete(workoutId);
    else guards.clear();
}

export function isWorkoutClockAnomalyError(error: unknown): error is WorkoutClockAnomalyError {
    return error instanceof WorkoutClockAnomalyError
        || (Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === 'workout-clock-anomaly');
}
