// New/edited cycles have the limits shown in the editor. The projection schema
// remains lossless for existing/imported cycles: validate new writes separately.
export const MAX_EDITABLE_CYCLE_WEEKS = 52;
export const MAX_CYCLE_SESSIONS_PER_WEEK = 14;

// A historical 100-week cycle is covered by regression tests; cap computation
// independently so malformed persisted data cannot create unbounded schedules.
export const MAX_CALCULATED_CYCLE_WEEKS = 104;

export function isBoundedCycleCount(value: unknown, max: number): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max;
}

export function previewCycleCount(value: string, fallback: number, max: number): number {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 1
        ? Math.min(parsed, max)
        : Math.min(max, Math.max(1, fallback));
}

 
// Read-only numerical guard. Never migrate or rewrite a historical cycle to
// make a derived chart computable.
export function getCycleVolumeFrequencies(
    items: ReadonlyArray<{ frequencyPerWeek?: number }>,
    requestedSessions: number | undefined,
): { sessionsPerWeek: number; frequencies: number[] } | null {
    if (items.length === 0) return null;
    const frequencies = items.map(item => item.frequencyPerWeek ?? 1);
    if (frequencies.some(value => !Number.isSafeInteger(value) || value < 1)) return null;
    const sum = frequencies.reduce((total, value) => total + value, 0);
    if (!Number.isSafeInteger(sum) || sum < 1) return null;
    const sessionsPerWeek = requestedSessions ?? sum;
    if (!isBoundedCycleCount(sessionsPerWeek, MAX_CYCLE_SESSIONS_PER_WEEK)) return null;
    return {
        sessionsPerWeek,
        frequencies: frequencies.map(value => value * (sessionsPerWeek / sum)),
    };
}
