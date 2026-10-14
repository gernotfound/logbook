import equal from 'fast-deep-equal';
import { DomainParsers } from '../schema';
import { equivalentWorkoutSnapshot } from './workoutSnapshotEquality';
import type { WorkoutSession } from '../../types';
import { requireHealthConsentWritable } from '../healthConsent';
import { readDeviceValueStrict, writeDeviceValue } from './deviceStorage';
import { commitDomainOperations, readLocal, type LocalWriteGuard } from './localRepository';
import { assertWorkoutSessionIdentities } from './domainOperations/validation';

const VERSION = 1;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER - 1;
const tokenPattern = /^[a-f0-9]{32}$/;

export type WorkoutDeviceIntent = {
    __logbookWorkoutIntent: 1;
    owner: string;
    generation: string;
    sequence: number;
    // Frozen when the first synchronous snapshot is written. Used to fence an
    // untracked pre-upgrade or cross-tab envelope, not to replace the journal.
    baseline: WorkoutSession | null;
    workout: WorkoutSession;
};

function validatedWorkout(value: unknown, strictIdentity = true): WorkoutSession {
    const parsed = DomainParsers.parseActiveWorkout(value);
    if (!parsed || !parsed.id || !value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Snapshot workout di recupero non valido.');
    }
    if (strictIdentity) assertWorkoutSessionIdentities(parsed, 'Recupero allenamento');
    // Keep the precise snapshot bytes. Zod's field sanitizers must not silently
    // discard a device draft or make the next edit look like a competing tab.
    return value as WorkoutSession;
}


function parseIntent(value: unknown, owner: string): WorkoutDeviceIntent | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !Object.hasOwn(value, '__logbookWorkoutIntent')) return null;
    const raw = value as Partial<WorkoutDeviceIntent>;
    if (raw.__logbookWorkoutIntent !== VERSION || raw.owner !== owner
        || typeof raw.generation !== 'string' || !tokenPattern.test(raw.generation)
        || typeof raw.sequence !== 'number' || !Number.isSafeInteger(raw.sequence)
        || raw.sequence < 1 || raw.sequence > MAX_SEQUENCE
        || (raw.baseline !== null && (!raw.baseline || typeof raw.baseline !== 'object'))) {
        throw new Error('Metadati workout di recupero incompatibili: archivio preservato.');
    }
    const workout = validatedWorkout(raw.workout);
    const baseline = raw.baseline === null ? null : validatedWorkout(raw.baseline, false);
    return { __logbookWorkoutIntent: 1, owner, generation: raw.generation, sequence: raw.sequence, baseline, workout };
}

/** The complete intent and the latest workout live in ONE synchronous AEAD record. */
export function readWorkoutDeviceIntent(owner: string): WorkoutDeviceIntent | null {
    const raw = readDeviceValueStrict('workout', owner);
    if (raw === null) return null;
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { throw new Error('Snapshot workout esistente corrotto: non può essere sovrascritto.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Snapshot workout esistente non valido: non può essere sovrascritto.');
    }
    return parseIntent(value, owner);
}

export function unwrapWorkoutDeviceSnapshot(value: unknown, owner: string): { workout: unknown; isIntent: boolean } {
    const intent = parseIntent(value, owner);
    return intent ? { workout: intent.workout, isIntent: true } : { workout: value, isIntent: false };
}

export function saveWorkoutDeviceIntent(
    owner: string,
    previous: WorkoutSession | null,
    workout: WorkoutSession,
    observedBase: WorkoutSession | null,
): WorkoutDeviceIntent {
    const existing = readWorkoutDeviceIntent(owner);
    if (!existing) {
        const raw = readDeviceValueStrict('workout', owner);
        if (raw !== null) {
            const legacy = validatedWorkout(JSON.parse(raw) as unknown, false);
            if (!equivalentWorkoutSnapshot(legacy, previous)) {
                throw new Error('Snapshot workout cambiato da un’altra scheda: dati preservati.');
            }
        }
    }
    if (existing && !equivalentWorkoutSnapshot(existing.workout, previous)) {
        throw new Error('Workout modificato da un’altra scheda: recupero protetto senza sovrascrivere i dati.');
    }
    if (existing && existing.sequence >= MAX_SEQUENCE) throw new Error('Contatore recupero workout esaurito.');
    const random = crypto.getRandomValues(new Uint8Array(16));
    const generation = existing?.generation
        ?? Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
    const intent: WorkoutDeviceIntent = {
        __logbookWorkoutIntent: 1, owner, generation,
        sequence: (existing?.sequence ?? 0) + 1,
        baseline: existing ? existing.baseline : observedBase,
        workout,
    };
    writeDeviceValue('workout', JSON.stringify(intent), owner);
    return intent;
}

/**
 * Auth-confirmed boot boundary: replay only this device's proved, newer intent.
 * No cloud call or second queue. The domain transaction atomically writes data,
 * semantic journal AND the applied intent generation/sequence.
 */
export async function recoverWorkoutDeviceIntent(owner: string, guard: LocalWriteGuard): Promise<void> {
    if (!owner.startsWith('user:')) return;
    const intent = readWorkoutDeviceIntent(owner);
    if (!intent) return;
    if (!guard()) throw new Error('Sessione cambiata durante il recupero del workout.');
    requireHealthConsentWritable(owner);
    const envelope = await readLocal(owner);
    if (!guard()) throw new Error('Sessione cambiata durante il recupero del workout.');
    if (!envelope) throw new Error('Workout locale presente senza archivio principale verificabile. Dati preservati.');
    if (envelope.lastClosedWorkoutId === intent.workout.id || envelope.closedWorkoutIds?.includes(intent.workout.id!)) {
        // The journal has committed the closure. The obsolete device record
        // cannot resurrect a completed or deleted workout.
        return;
    }
    const applied = envelope.lastWorkoutDeviceIntent;
    if (applied?.generation === intent.generation && applied.sequence >= intent.sequence) return;

    if (applied?.generation !== intent.generation && !equal(envelope.data.activeWorkout, intent.baseline)) {
        if (equal(envelope.data.activeWorkout, intent.workout)) return;
        throw new Error('Recupero workout sospeso: lo stato locale è cambiato in un’altra scheda. La copia originale è preservata.');
    }
    await commitDomainOperations(owner, { type: 'active-workout.set', workout: intent.workout }, envelope.data, guard,
        { generation: intent.generation, sequence: intent.sequence, baseline: intent.baseline });
}
