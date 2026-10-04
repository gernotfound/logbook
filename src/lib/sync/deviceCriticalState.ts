import type { WorkoutSession } from '../../types';
import { writeDeviceValue } from './deviceStorage';
import { isCurrentSession, type SessionSnapshot } from './session';

export function persistOwnerBoundWorkoutSnapshot(
    session: SessionSnapshot,
    dataOwner: string | null,
    localWorkout: WorkoutSession | null,
): void {
    if (!isCurrentSession(session)) throw new Error('Sessione cambiata durante il salvataggio del workout.');

    // A missing/mismatched dataset owner means Zustand cannot prove ownership of the
    // device-critical workout. Never move or clear data under another owner's key.
    if (dataOwner !== session.owner) {
        if (localWorkout) throw new Error('Workout locale non attribuibile con sicurezza all’account corrente.');
        return;
    }

    writeDeviceValue(
        'workout',
        localWorkout ? JSON.stringify(localWorkout) : null,
        session.owner,
    );

    if (!isCurrentSession(session)) throw new Error('Sessione cambiata durante il salvataggio del workout.');
}
