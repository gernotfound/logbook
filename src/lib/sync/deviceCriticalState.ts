import type { WorkoutSession } from '../../types';
import { writeDeviceValue } from './deviceStorage';
import { captureSession, isCurrentSession } from './session';
import { readWorkoutDeviceIntent } from './workoutDeviceIntent';
import { equivalentWorkoutSnapshot } from './workoutSnapshotEquality';

type SessionSnapshot = ReturnType<typeof captureSession>;

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

    // Background flush is not allowed to erase a newer, crash-replayable
    // intent before its IndexedDB journal commit. Both live in one AEAD record.
    if (session.owner.startsWith('user:')) {
        const intent = readWorkoutDeviceIntent(session.owner);
        if (intent) {
            if (!equivalentWorkoutSnapshot(intent.workout, localWorkout)) {
                throw new Error('Snapshot workout non coerente con la copia di recupero sul dispositivo.');
            }
            return;
        }
    }
    writeDeviceValue(
        'workout',
        localWorkout ? JSON.stringify(localWorkout) : null,
        session.owner,
    );

    if (!isCurrentSession(session)) throw new Error('Sessione cambiata durante il salvataggio del workout.');
}
