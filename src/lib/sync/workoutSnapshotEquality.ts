import equal from 'fast-deep-equal';
import { DomainParsers } from '../schema';
import type { WorkoutSession } from '../../types';

/**
 * Browser JSON drops optional undefined fields. Zod reconstructs defaults in
 * persisted envelopes. Compare semantic workout identity, not object shape.
 * A malformed or mismatched identity never becomes an equal baseline.
 */
export function equivalentWorkoutSnapshot(a: WorkoutSession | null | undefined, b: WorkoutSession | null | undefined): boolean {
    if (equal(a ?? null, b ?? null)) return true;
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) return true;
    if (!a || !b) return false;
    const left = DomainParsers.parseActiveWorkout(a);
    const right = DomainParsers.parseActiveWorkout(b);
    return !!left?.id && left.id === right?.id && equal(left, right);
}
