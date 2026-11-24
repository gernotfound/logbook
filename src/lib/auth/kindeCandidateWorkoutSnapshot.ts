import equal from 'fast-deep-equal';
import type { WorkoutSession } from '../../types';
import { DomainParsers } from '../schema';
import { assertWorkoutSessionIdentities } from '../sync/domainOperations/validation';

/** Reject a device draft if the read schema would discard or replace values. */
export function parseKindeWorkoutSnapshot(value: unknown): WorkoutSession & { id: string } {
    const parsed = DomainParsers.parseActiveWorkout(value);
    if (!parsed?.id) throw new Error('Seduta non valida.');
    assertWorkoutSessionIdentities(parsed, 'Bozza seduta');
    const stored = JSON.parse(JSON.stringify(value)) as WorkoutSession;
    const canonical = JSON.parse(JSON.stringify(parsed)) as WorkoutSession;
    if (!equal({ pains: [], ...stored }, canonical)) throw new Error('Copia della seduta non verificabile.');
    return { ...parsed, id: parsed.id };
}
