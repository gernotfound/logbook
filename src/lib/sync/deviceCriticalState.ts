import type { WorkoutSession } from '../../types';
import { assertWorkoutSnapshotEpoch, persistPlainWorkoutSnapshot, readWorkoutDeviceIntent, unwrapWorkoutDeviceSnapshot } from './workoutDeviceIntent';
import { readDeviceValueStrict } from './deviceStorage';
import { captureSession, isCurrentSession } from './session';
import { equivalentWorkoutSnapshot } from './workoutSnapshotEquality';

type SessionSnapshot = ReturnType<typeof captureSession>;

export function persistOwnerBoundWorkoutSnapshot(
    session: SessionSnapshot,
    dataOwner: string | null,
    localWorkout: WorkoutSession | null,
    beforeFlush?: WorkoutSession | null,
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
    if (beforeFlush !== undefined) {
        const raw = readDeviceValueStrict('workout', session.owner);
        let stored: WorkoutSession | null = null;
        if (raw !== null) {
            // Malformed or wrong-epoch evidence must never become an empty baseline.
            const source = unwrapWorkoutDeviceSnapshot(JSON.parse(raw) as unknown, session.owner);
            assertWorkoutSnapshotEpoch(session.owner, source.consentRevision);
            stored = source.workout as WorkoutSession | null;
        }
        // No redundant write when the current workout is already durable.
        if (equivalentWorkoutSnapshot(stored, localWorkout)) return;
        // A flush may introduce a new local edit; only its preceding device
        // state is evidence that a competing tab has not advanced the workout.
        if (!equivalentWorkoutSnapshot(stored, beforeFlush)) {
            throw new Error('Workout modificato da un’altra scheda: copia condivisa preservata.');
        }
    }
    persistPlainWorkoutSnapshot(localWorkout, session.owner);

    if (!isCurrentSession(session)) throw new Error('Sessione cambiata durante il salvataggio del workout.');
}
