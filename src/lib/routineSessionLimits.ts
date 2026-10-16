// The routine editor already caps sets at 20. Apply the same bounded-work
// contract at session preparation so legacy/imported plans cannot allocate
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

 
export function previewRoutineSets(value: unknown): number {
    const parsed = Number.parseInt(String(value || 3), 10);
    return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(MAX_ROUTINE_SETS, parsed)) : 3;
}
