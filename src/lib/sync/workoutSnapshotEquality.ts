import equal from 'fast-deep-equal';
import { DomainParsers } from '../schema';
import type { WorkoutSession } from '../../types';

/**
 * Device JSON omits undefined fields; Zod may materialize those same optional
 * fields as undefined while expanding defaults. Compare the canonical persisted
 * representation, but only after both workouts pass identity validation.
 */
export function equivalentWorkoutSnapshot(a: WorkoutSession | null | undefined, b: WorkoutSession | null | undefined): boolean {
    if (!a || !b) return (a ?? null) === (b ?? null);
    const left = DomainParsers.parseActiveWorkout(a);
    const right = DomainParsers.parseActiveWorkout(b);
    if (!left?.id || left.id !== right?.id) return false;
    return equal(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)));
}
