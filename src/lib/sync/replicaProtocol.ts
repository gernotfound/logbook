import { generateId } from '../utils/date';
import {
    mergeVectors,
    parseSyncMeta,
    parseVectorClock,
    type SyncMeta,
    type VectorClock,
} from './semanticProjection';

export const REPLICA_SLOT_COUNT = 16 as const;
const REPLICA_CHECKPOINT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
export const REPLICA_LEASE_MS = 360 * 24 * 60 * 60 * 1000;
export const REPLICA_CLOCK_SKEW_MARGIN_MS = 5 * 60 * 1000;
const SLOT_RE = /^s(?:0[0-9]|1[0-5])$/;
export const SLOT_IDS = Array.from({ length: REPLICA_SLOT_COUNT }, (_, index) => `s${String(index).padStart(2, '0')}`);

export type ReplicaMutationAction = 'register' | 'checkpoint' | 'advance' | 'retire' | 'reuse-expired';

export interface ReplicaIdentity {
    slot: string;
    replicaId: string;
    generation: number;
    leaseUntilMs: number;
    checkpointAtMs: number;
}

export interface ReplicaControlEntry extends Omit<ReplicaIdentity, 'slot'> {
    status: 'active' | 'retired';
    lastSeq: number;
    checkpointClock: VectorClock;
}

// Membership/claim grace matches D1; it is not permission for a client
// writer to send operations after its nominal lease has expired.
export function isReplicaMembershipEligible(
    entry: Pick<ReplicaControlEntry, 'status' | 'leaseUntilMs'>,
    nowMs = Date.now(),
): boolean {
    return entry.status === 'active' && entry.leaseUntilMs + REPLICA_CLOCK_SKEW_MARGIN_MS >= nowMs;
}

export interface ReplicaControl {
    protocolVersion: 3;
    consentRevision?: number;
    replicas: Record<string, ReplicaControlEntry>;
    mutation: {
        slot: string;
        action: ReplicaMutationAction;
        batchId?: string;
    };
}

export interface ReplicaCheckpoint {
    identity: ReplicaIdentity;
    baseSeq: number;
}

export interface CloudCheckpoint {
    clock: VectorClock;
    syncMetaByDocument: Record<string, SyncMeta>;
}

export class ReplicaCapacityError extends Error {
    readonly code = 'replica-capacity';
    constructor() {
        super('Numero massimo di repliche attive raggiunto. Riapri TheLogBook da un dispositivo già registrato o riprova dopo la scadenza di una replica inattiva.');
        this.name = 'ReplicaCapacityError';
    }
}

export class ReplicaFencedError extends Error {
    readonly code = 'replica-fenced';
    constructor(message = 'Questa replica non è più autorizzata a pubblicare il vecchio journal. È necessario un checkpoint completo prima della sincronizzazione.') {
        super(message);
        this.name = 'ReplicaFencedError';
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseSafeInteger(value: unknown, context: string, minimum = 0): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`${context} non valido`);
    }
    return value;
}

function assertSlot(slot: unknown): asserts slot is string {
    if (typeof slot !== 'string' || !SLOT_RE.test(slot)) throw new Error('Replica slot non valido');
}

export function parseReplicaIdentity(raw: unknown): ReplicaIdentity | null {
    if (raw === null || raw === undefined) return null;
    if (!isRecord(raw)) throw new Error('Identità replica locale non valida');
    assertSlot(raw.slot);
    if (typeof raw.replicaId !== 'string' || !raw.replicaId.trim()) throw new Error('Replica ID non valido');
    return {
        slot: raw.slot,
        replicaId: raw.replicaId,
        generation: parseSafeInteger(raw.generation, 'Generazione replica', 1),
        leaseUntilMs: parseSafeInteger(raw.leaseUntilMs, 'Scadenza lease replica', 1),
        checkpointAtMs: parseSafeInteger(raw.checkpointAtMs, 'Checkpoint replica', 1),
    };
}

export function parseReplicaCheckpointClock(raw: unknown): VectorClock {
    const clock = parseVectorClock(raw, 'replica checkpoint clock');
    for (const actor of Object.keys(clock)) assertSlot(actor);
    return clock;
}

function parseReplicaEntry(slot: string, raw: unknown): ReplicaControlEntry {
    assertSlot(slot);
    if (!isRecord(raw)) throw new Error('Replica control entry non valida');
    const identity = parseReplicaIdentity({ ...raw, slot });
    if (!identity) throw new Error('Replica control entry non valida');
    if (raw.status !== 'active' && raw.status !== 'retired') throw new Error('Stato replica non valido');
    const { slot: _slot, ...storedIdentity } = identity;
    return {
        ...storedIdentity,
        status: raw.status,
        lastSeq: parseSafeInteger(raw.lastSeq, 'Replica lastSeq'),
        checkpointClock: parseReplicaCheckpointClock(raw.checkpointClock),
    };
}

export function parseReplicaControl(raw: unknown): ReplicaControl {
    if (!isRecord(raw) || raw.protocolVersion !== 3 || !isRecord(raw.replicas) || !isRecord(raw.mutation)) {
        throw new Error('Registro repliche non valido');
    }
    const entries = Object.entries(raw.replicas);
    if (entries.length > REPLICA_SLOT_COUNT) throw new Error('Registro repliche oltre il limite');
    const replicas: Record<string, ReplicaControlEntry> = {};
    const replicaIds = new Set<string>();
    for (const [slot, entry] of entries) {
        const parsed = parseReplicaEntry(slot, entry);
        // D1 fences historical replica IDs even after retirement: two slots cannot own one incarnation.
        if (replicaIds.has(parsed.replicaId)) throw new Error('Replica ID duplicato nel registro');
        replicaIds.add(parsed.replicaId);
        replicas[slot] = parsed;
    }
    assertSlot(raw.mutation.slot);
    const action = raw.mutation.action;
    if (action !== 'register' && action !== 'checkpoint' && action !== 'advance' && action !== 'retire' && action !== 'reuse-expired') {
        throw new Error('Mutazione registro repliche non valida');
    }
    const batchId = raw.mutation.batchId;
    if (batchId !== undefined && (action !== 'advance' || typeof batchId !== 'string'
        || batchId.length < 16 || batchId.length > 128)) {
        throw new Error('Identificatore avanzamento replica non valido');
    }
    const revision = raw.consentRevision === undefined ? undefined : parseSafeInteger(raw.consentRevision, 'consent revision');
    return { protocolVersion: 3, ...(revision !== undefined ? { consentRevision: revision } : {}),
        replicas, mutation: { slot: raw.mutation.slot, action, ...(batchId !== undefined ? { batchId } : {}) } };
}

export function emptyControl(slot = 's00'): ReplicaControl {
    return { protocolVersion: 3, replicas: {}, mutation: { slot, action: 'register' } };
}

export function checkpointFromCloudDocuments(cloudDocuments: Map<string, Record<string, unknown>>): CloudCheckpoint {
    let clock: VectorClock = {};
    const syncMetaByDocument: Record<string, SyncMeta> = {};
    for (const [path, raw] of cloudDocuments.entries()) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw._sync === undefined) continue;
        const meta = parseSyncMeta(raw._sync);
        syncMetaByDocument[path] = meta;
        clock = mergeVectors(clock, meta.clock);
    }
    return { clock, syncMetaByDocument };
}

export function needsReplicaCheckpoint(replica: ReplicaIdentity | null | undefined, now = Date.now()): boolean {
    if (!replica) return true;
    return replica.checkpointAtMs + REPLICA_CHECKPOINT_INTERVAL_MS <= now
        || replica.leaseUntilMs - REPLICA_CHECKPOINT_INTERVAL_MS <= now;
}

export function stableFrontierFromControl(control: Pick<ReplicaControl, 'replicas'>): VectorClock {
    const active = Object.values(control.replicas).filter(entry => entry.status === 'active');
    if (!active.length) return {};
    const actors = new Set<string>();
    for (const entry of active) for (const actor of Object.keys(entry.checkpointClock)) actors.add(actor);
    const frontier: VectorClock = {};
    for (const actor of actors) {
        let minimum = Number.POSITIVE_INFINITY;
        for (const entry of active) minimum = Math.min(minimum, entry.checkpointClock[actor] ?? 0);
        if (Number.isFinite(minimum) && minimum > 0) frontier[actor] = minimum;
    }
    return frontier;
}

export function matchesReplica(entry: ReplicaControlEntry | undefined, identity: ReplicaIdentity): boolean {
    return Boolean(entry
        && entry.status === 'active'
        && entry.replicaId === identity.replicaId
        && entry.generation === identity.generation);
}

export function advanceReplicaControl(control: ReplicaControl, identity: ReplicaIdentity, lastSeq: number, batchId = generateId('sync-advance')): ReplicaControl {
    const entry = control.replicas[identity.slot];
    if (!matchesReplica(entry, identity)) throw new ReplicaFencedError();
    const nextSeq = Math.max(entry.lastSeq, parseSafeInteger(lastSeq, 'Replica sequence'));
    return {
        protocolVersion: 3,
        ...(control.consentRevision !== undefined ? { consentRevision: control.consentRevision } : {}),
        replicas: {
            ...control.replicas,
            [identity.slot]: { ...entry, lastSeq: nextSeq },
        },
        // Lost-ack replay may repeat lastSeq but must always publish a fresh
        // batch identifier; Rules compare it to the pre-transaction control.
        mutation: { slot: identity.slot, action: 'advance', batchId },
    };
}

