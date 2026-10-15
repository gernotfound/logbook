import { DomainParsers } from './schema';
import { assertWorkoutSessionIdentities } from './sync/domainOperations/validation';
import { unwrapWorkoutDeviceSnapshot } from './sync/workoutDeviceIntent';
import { readDeviceValueStrict } from './sync/deviceStorage';
import { writeWorkoutTimerSnapshot, type WorkoutTimerSnapshot } from './utils/timer';
import type { SyncResult, UserData, WorkoutSession } from '../types';

export interface PortableWorkoutRecoveryState {
    dataOwner: string | null;
    userData: UserData | null;
    localWorkout: WorkoutSession | null;
    localPersistenceBlocked: boolean;
}
export type WorkoutRecoveryOutcome = 'restored' | 'already-present' | 'completed' | 'conflict';

/** The original device intent is evidence, NOT a portable causal journal. */
export function decodePortableWorkout(raw: string, owner: string): WorkoutSession {
    if (raw.length > 1_000_000) throw new Error('Backup: allenamento di recupero troppo grande.');
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error('Backup: allenamento di recupero non JSON.'); }
    const source = unwrapWorkoutDeviceSnapshot(parsed, owner);
    const workout = DomainParsers.parseActiveWorkout(source.workout);
    if (!workout) throw new Error('Backup: allenamento di recupero non valido.');
    assertWorkoutSessionIdentities(workout, 'Backup workout');
    return workout;
}

export async function restorePortableWorkout(
    raw: string, owner: string,
    readState: () => PortableWorkoutRecoveryState,
    commitWorkout: (workout: WorkoutSession) => Promise<SyncResult>,
    assertCurrent: () => void,
): Promise<WorkoutRecoveryOutcome> {
    const workout = decodePortableWorkout(raw, owner);
    assertCurrent();
    const state = readState();
    if (state.dataOwner !== owner || !state.userData || state.localPersistenceBlocked) {
        throw new Error('Archivio non pronto per recuperare l’allenamento.');
    }
    if (state.userData.history?.some(item => item.id === workout.id)) return 'completed';
    // A different active session must never be displaced by an old backup.
    if (state.userData.activeWorkout && state.userData.activeWorkout.id !== workout.id) return 'conflict';
    if (state.localWorkout !== null || readDeviceValueStrict('workout', owner) !== null) return 'already-present';
    assertCurrent();
    // Commits as a fresh owner-scoped Domain Operation, atomically updating
    // IndexedDB business state and journal; raw old-epoch metadata is never written.
    const result = await commitWorkout(workout);
    if (!result.ok && result.status !== 'local-pending') {
        throw new Error('Allenamento non recuperato: salvataggio locale/cloud non confermato.');
    }
    assertCurrent();
    return 'restored';
}

/** A running timer is frozen at the export instant, never resumed for days on import. */
export function restorePortableTimerAsPaused(
    raw: string | null, exportedAt: string, owner: string, assertCurrent: () => void,
): boolean {
    if (!raw) return false;
    assertCurrent();
    if (readDeviceValueStrict('timer', owner) !== null) return false;
    if (raw.length > 10_000) throw new Error('Backup: timer non valido.');
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('Backup: timer non JSON.'); }
    if (!value || typeof value !== 'object') throw new Error('Backup: timer non valido.');
    const timer = value as Partial<WorkoutTimerSnapshot>;
    if (timer.version !== 1
        || (timer.state !== 'running' && timer.state !== 'paused' && timer.state !== 'stopped')
        || typeof timer.startTime !== 'number' || !Number.isFinite(timer.startTime) || timer.startTime < 0
        || typeof timer.accumulated !== 'number' || !Number.isFinite(timer.accumulated) || timer.accumulated < 0) {
        throw new Error('Backup: timer non valido.');
    }
    if (timer.state === 'stopped') return false;
    const at = new Date(exportedAt).getTime();
    if (!Number.isFinite(at) || (timer.state === 'running' && (!timer.startTime || timer.startTime > at))) {
        throw new Error('Backup: data del timer non coerente con esportazione.');
    }
    const accumulated = timer.accumulated + (timer.state === 'running' ? at - timer.startTime! : 0);
    if (!Number.isFinite(accumulated)) throw new Error('Backup: tempo del timer non valido.');
    assertCurrent();
    writeWorkoutTimerSnapshot({ version: 1, state: 'paused', startTime: 0, accumulated }, owner);
    return true;
}
