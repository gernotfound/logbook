import { DomainParsers } from '../schema';
import { equivalentWorkoutSnapshot } from './workoutSnapshotEquality';
import type { WorkoutSession } from '../../types';
import { requireHealthConsentWritable } from '../healthConsent';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from './deviceStorage';
import { commitDomainOperations, readLocal, WorkoutIntentConflictError, type LocalWriteGuard } from './localRepository';
import { assertWorkoutSessionIdentities } from './domainOperations/validation';

const VERSION = 1;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER - 1;
const tokenPattern = /^[a-f0-9]{32}$/;
const SLOT_PREFIX = 'workout-intent:';
const slotName = (id: string) => SLOT_PREFIX + id;

export type WorkoutDeviceIntent = {
    __logbookWorkoutIntent: 1;
    owner: string;
    generation: string;
    sequence: number;
    // Old device intents omit this; new writes identify individual edits even
    // if two browser tabs allocate the same sequence concurrently.
    intentId?: string;
    // Every snapshot names its predecessor, so committed descendants can prove
    // which unacknowledged versions they supersede without a shared write lock.
    parentIntentId?: string;
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
        || (raw.intentId !== undefined && (typeof raw.intentId !== 'string' || !tokenPattern.test(raw.intentId)))
        || (raw.parentIntentId !== undefined && (typeof raw.parentIntentId !== 'string' || !tokenPattern.test(raw.parentIntentId)))
        || (raw.baseline !== null && (!raw.baseline || typeof raw.baseline !== 'object'))) {
        throw new Error('Metadati workout di recupero incompatibili: archivio preservato.');
    }
    const workout = validatedWorkout(raw.workout);
    const baseline = raw.baseline === null ? null : validatedWorkout(raw.baseline, false);
    return { __logbookWorkoutIntent: 1, owner, generation: raw.generation, sequence: raw.sequence,
        ...(raw.intentId ? { intentId: raw.intentId } : {}),
        ...(raw.parentIntentId ? { parentIntentId: raw.parentIntentId } : {}), baseline, workout };
}

/**
 * One immutable AEAD witness per synchronous edit. Different browser tabs can
 * overwrite the shared workout key, but never each other's random intent key.
 * Journalled descendants supersede their full predecessor chain.
 */
function readRecoverySlots(owner: string): Array<{ name: string; intent: WorkoutDeviceIntent }> {
    const prefixes = [protectedDeviceKey(SLOT_PREFIX, owner), deviceKey(SLOT_PREFIX, owner)];
    const keys: Array<{ key: string; id: string }> = [];
    for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        const prefix = prefixes.find(candidate => key?.startsWith(candidate));
        if (key && prefix) keys.push({ key, id: key.slice(prefix.length) });
    }
    return keys.sort((a, b) => a.key.localeCompare(b.key)).map(({ id }) => {
        if (!tokenPattern.test(id)) throw new Error('Copia workout di recupero incompatibile: dati preservati.');
        const name = slotName(id);
        const raw = readDeviceValueStrict(name, owner);
        if (!raw) throw new Error('Copia workout modificata durante il recupero: dati preservati.');
        let parsed: unknown;
        try { parsed = JSON.parse(raw); }
        catch { throw new Error('Copia workout corrotta: dati preservati.'); }
        const intent = parseIntent(parsed, owner);
        if (!intent || intent.intentId !== id) throw new Error('Identità della copia workout incoerente: dati preservati.');
        return { name, intent };
    });
}

/** Never delete an independent edit: only a proved committed ancestry is pruned. */
export async function releaseCommittedWorkoutSlot(
    owner: string,
    intent: Pick<WorkoutDeviceIntent, 'generation' | 'sequence' | 'intentId' | 'parentIntentId'>,
): Promise<void> {
    if (!intent.intentId) return;
    const envelope = await readLocal(owner);
    const marker = envelope?.lastWorkoutDeviceIntent;
    if (marker?.generation !== intent.generation || marker.sequence !== intent.sequence
        || marker.intentId !== intent.intentId) return;
    const slots = new Map(readRecoverySlots(owner).map(slot => [slot.intent.intentId!, slot]));
    const visited = new Set<string>();
    let id: string | undefined = intent.intentId;
    let parent: string | undefined = intent.parentIntentId;
    while (id && !visited.has(id)) {
        visited.add(id);
        const slot = slots.get(id);
        if (slot) {
            if (slot.intent.generation !== intent.generation) throw new WorkoutIntentConflictError('Catena copie workout incoerente.');
            parent = slot.intent.parentIntentId;
            // This key is immutable; no editor can reuse it for a future edit.
            writeDeviceValue(slot.name, null, owner);
        }
        id = parent;
        parent = undefined;
    }
}

/** Shared synchronous snapshot, complemented by immutable recovery witnesses. */
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
    const token = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),
        byte => byte.toString(16).padStart(2, '0')).join('');
    const generation = existing?.generation ?? token();
    const intent: WorkoutDeviceIntent = {
        __logbookWorkoutIntent: 1, owner, generation,
        sequence: (existing?.sequence ?? 0) + 1,
        intentId: token(),
        ...(existing?.intentId ? { parentIntentId: existing.intentId } : {}),
        baseline: existing ? existing.baseline : observedBase,
        workout,
    };
    // Persist the private copy FIRST. If another tab races on the shared key
    // or this second write fails, the new workout still survives the crash.
    writeDeviceValue(slotName(intent.intentId!), JSON.stringify(intent), owner);
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
    const shared = readWorkoutDeviceIntent(owner);
    if (!guard()) throw new Error('Sessione cambiata durante il recupero del workout.');
    const slots = readRecoverySlots(owner);
    if (!shared && slots.length === 0) return;
    requireHealthConsentWritable(owner);
    const envelope = await readLocal(owner);
    if (!guard()) throw new Error('Sessione cambiata durante il recupero del workout.');
    if (!envelope) throw new Error('Workout locale presente senza archivio principale verificabile. Dati preservati.');

    const applied = envelope.lastWorkoutDeviceIntent;
    if (applied?.intentId) {
        const committed = slots.find(slot => slot.intent.intentId === applied.intentId);
        if (committed) await releaseCommittedWorkoutSlot(owner, committed.intent);
    }
    const unresolved = readRecoverySlots(owner);
    const byId = new Map(unresolved.map(slot => [slot.intent.intentId!, slot.intent]));
    const parents = new Set(unresolved.flatMap(slot => slot.intent.parentIntentId ? [slot.intent.parentIntentId] : []));
    const heads = unresolved.filter(slot => !parents.has(slot.intent.intentId!));
    if (heads.length > 1 || (unresolved.length > 0 && heads.length !== 1)) {
        throw new WorkoutIntentConflictError('Più schede hanno modifiche workout non riconciliate. Le copie sono preservate.');
    }
    const candidate = heads[0]?.intent ?? shared;
    if (!candidate) return;
    const descendsFrom = (ancestorId: string): boolean => {
        let cursor: WorkoutDeviceIntent | undefined = candidate;
        const seen = new Set<string>();
        while (cursor?.parentIntentId && !seen.has(cursor.parentIntentId)) {
            if (cursor.parentIntentId === ancestorId) return true;
            seen.add(cursor.parentIntentId);
            cursor = byId.get(cursor.parentIntentId);
        }
        return false;
    };
    if (shared && candidate !== shared && shared.intentId !== candidate.intentId) {
        if (shared.generation !== candidate.generation || shared.sequence >= candidate.sequence
            || (shared.intentId && !descendsFrom(shared.intentId))) {
            throw new WorkoutIntentConflictError('Snapshot workout di più schede divergenti. Copie preservate.');
        }
    }
    if (applied?.generation === candidate.generation && applied.sequence < candidate.sequence
        && applied.intentId && !descendsFrom(applied.intentId)) {
        throw new WorkoutIntentConflictError('Modifica workout senza ascendenza verificabile: copie preservate.');
    }
    const intent = candidate;
    if (envelope.lastClosedWorkoutId === intent.workout.id || envelope.closedWorkoutIds?.includes(intent.workout.id!)) {
        // The journal has committed the closure. The obsolete device record
        // cannot resurrect a completed or deleted workout.
        return;
    }
    if (applied?.generation === intent.generation) {
        if (applied.sequence > intent.sequence) {
            if (unresolved.length) {
                throw new WorkoutIntentConflictError('Intento workout di un’altra scheda non riconciliato. Copia privata preservata.');
            }
            return;
        }
        if (applied.sequence === intent.sequence) {
            // A concurrent tab can publish different workout bytes with the same
            // generation/sequence. Sequence equality alone is not idempotence.
            if (applied.intentId !== undefined && intent.intentId !== undefined
                ? applied.intentId !== intent.intentId
                : !equivalentWorkoutSnapshot(envelope.data.activeWorkout, intent.workout)) {
                throw new WorkoutIntentConflictError('Conflitto tra modifiche concorrenti del workout: snapshot device preservato.');
            }
            return;
        }
    }

    if (applied?.generation !== intent.generation && !equivalentWorkoutSnapshot(envelope.data.activeWorkout, intent.baseline)) {
        if (equivalentWorkoutSnapshot(envelope.data.activeWorkout, intent.workout)) return;
        throw new Error('Recupero workout sospeso: lo stato locale è cambiato in un’altra scheda. La copia originale è preservata.');
    }
    await commitDomainOperations(owner, { type: 'active-workout.set', workout: intent.workout }, envelope.data, guard,
        { generation: intent.generation, sequence: intent.sequence, intentId: intent.intentId,
            parentIntentId: intent.parentIntentId, baseline: intent.baseline });
    if (!guard()) throw new Error('Sessione cambiata durante il recupero del workout.');
    // Repair the shared snapshot if this tab crashed after writing its private
    // slot but before publishing the common device key.
    const latestShared = readWorkoutDeviceIntent(owner);
    if (!latestShared || latestShared.intentId !== intent.intentId) {
        if (latestShared && (latestShared.generation !== intent.generation || latestShared.sequence >= intent.sequence)) {
            throw new WorkoutIntentConflictError('Snapshot concorrente durante il recupero. Copia privata preservata.');
        }
        writeDeviceValue('workout', JSON.stringify(intent), owner);
    }
    // Cleanup failure only retains an authenticated duplicate, never loses a journal.
    try { await releaseCommittedWorkoutSlot(owner, intent); } catch { /* keep the backup */ }
}
