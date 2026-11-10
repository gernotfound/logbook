// The routine editor already caps sets at 20. Apply the same bounded-work
// contract at session preparation so malformed imported plans cannot allocate
// unbounded arrays. These are execution limits, not read-schema migrations.
export const MAX_ROUTINE_SETS = 20;
export const MAX_ROUTINE_SEGMENTS = 20;

export class InvalidRoutineSessionPlanError extends Error {
    constructor() {
        super('La scheda contiene troppe serie o segmenti, oppure valori non validi. Correggila prima di iniziare l’allenamento.');
        this.name = 'InvalidRoutineSessionPlanError';
    }
}

export function requireRoutineSessionCount(value: unknown, max: number): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
        throw new InvalidRoutineSessionPlanError();
    }
    return value;
}

 
export function parseRoutineSetCount(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value);
    if (!/^[1-9]\d*$/.test(text)) return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed <= MAX_ROUTINE_SETS ? parsed : null;
}

export function previewRoutineSets(value: unknown, currentPlans?: readonly unknown[]): number {
    if (currentPlans && parseRoutineSetCount(value) === null) {
        // A draft with invalid input keeps the existing per-set editors visible,
        // rather than truncating or silently replacing their configured plans.
        return Math.min(MAX_ROUTINE_SETS, currentPlans.length);
    }
    const parsed = Number.parseInt(String(value || 3), 10);
    return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(MAX_ROUTINE_SETS, parsed)) : 3;
}
