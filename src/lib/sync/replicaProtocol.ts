import {
    doc,
    runTransaction,
    type Firestore,
} from 'firebase/firestore';
import { generateId } from '../utils/date';
import {
    mergeVectors,
    parseSyncMeta,
    parseVectorClock,
    type SyncMeta,
    type VectorClock,
} from './semanticProjection';

export const REPLICA_SLOT_COUNT = 16 as const;
export const REPLICA_CHECKPOINT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
export const REPLICA_LEASE_MS = 360 * 24 * 60 * 60 * 1000;
const REPLICA_CLOCK_SKEW_MARGIN_MS = 5 * 60 * 1000;
const SLOT_RE = /^s(?:0[0-9]|1[0-5])$/;
const SLOT_IDS = Array.from({ length: REPLICA_SLOT_COUNT }, (_, index) => `s${String(index).padStart(2, '0')}`);

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

export interface ReplicaControl {
    protocolVersion: 3;
    replicas: Record<string, ReplicaControlEntry>;
    mutation: {
        slot: string;
        action: ReplicaMutationAction;
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
        checkpointClock: parseVectorClock(raw.checkpointClock, 'replica checkpoint clock'),
    };
}

export function parseReplicaControl(raw: unknown): ReplicaControl {
    if (!isRecord(raw) || raw.protocolVersion !== 3 || !isRecord(raw.replicas) || !isRecord(raw.mutation)) {
        throw new Error('Registro repliche non valido');
    }
    const entries = Object.entries(raw.replicas);
    if (entries.length > REPLICA_SLOT_COUNT) throw new Error('Registro repliche oltre il limite');
    const replicas: Record<string, ReplicaControlEntry> = {};
    for (const [slot, entry] of entries) replicas[slot] = parseReplicaEntry(slot, entry);
    assertSlot(raw.mutation.slot);
    const action = raw.mutation.action;
    if (action !== 'register' && action !== 'checkpoint' && action !== 'advance' && action !== 'retire' && action !== 'reuse-expired') {
        throw new Error('Mutazione registro repliche non valida');
    }
    return { protocolVersion: 3, replicas, mutation: { slot: raw.mutation.slot, action } };
}

function emptyControl(slot = 's00'): ReplicaControl {
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

export function stableFrontierFromControl(control: ReplicaControl): VectorClock {
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

export function advanceReplicaControl(control: ReplicaControl, identity: ReplicaIdentity, lastSeq: number): ReplicaControl {
    const entry = control.replicas[identity.slot];
    if (!matchesReplica(entry, identity)) throw new ReplicaFencedError();
    const nextSeq = Math.max(entry.lastSeq, parseSafeInteger(lastSeq, 'Replica sequence'));
    return {
        protocolVersion: 3,
        replicas: {
            ...control.replicas,
            [identity.slot]: { ...entry, lastSeq: nextSeq },
        },
        mutation: { slot: identity.slot, action: 'advance' },
    };
}

export async function retireExpiredReplicas(db: Firestore, uid: string, now = Date.now()): Promise<void> {
    if (!uid || uid.includes('/')) throw new Error('Identità non valida');
    const ref = doc(db, `users/${uid}/sync_control/state`);

    // Retire at most one slot per transaction because Security Rules deliberately
    // constrain every control mutation to one replica entry. Repeat until no locally
    // expired entry remains. Server request.time is still the authoritative proof.
    for (let attempt = 0; attempt < REPLICA_SLOT_COUNT; attempt += 1) {
        let retired = false;
        try {
            await runTransaction(db, async transaction => {
                const snapshot = await transaction.get(ref);
                if (!snapshot.exists()) return;
                const current = parseReplicaControl(snapshot.data());
                const candidate = Object.entries(current.replicas).find(([, entry]) =>
                    entry.status === 'active' && entry.leaseUntilMs + REPLICA_CLOCK_SKEW_MARGIN_MS < now
                );
                if (!candidate) return;

                const [slot, entry] = candidate;
                transaction.set(ref, {
                    protocolVersion: 3,
                    replicas: {
                        ...current.replicas,
                        [slot]: { ...entry, status: 'retired' },
                    },
                    mutation: { slot, action: 'retire' },
                });
                retired = true;
            });
        } catch (error) {
            // A client clock ahead of server time can only delay retirement. Rules reject
            // the mutation and the still-active replica continues to block stable-frontier GC.
            if ((error as { code?: unknown })?.code !== 'permission-denied') throw error;
            return;
        }
        if (!retired) return;
    }
}

export async function claimReplicaCheckpoint(
    db: Firestore,
    uid: string,
    currentReplica: ReplicaIdentity | null | undefined,
    checkpointClock: VectorClock,
    localActorSeq = 0,
    candidateReplicaId?: string,
): Promise<ReplicaCheckpoint> {
    if (!uid || uid.includes('/')) throw new Error('Identità non valida');
    const normalizedCheckpoint = parseVectorClock(checkpointClock, 'checkpoint cloud clock');
    const normalizedCandidate = candidateReplicaId?.trim();
    if (normalizedCandidate !== undefined && (!normalizedCandidate || normalizedCandidate.length > 128)) {
        throw new Error('Replica candidate ID non valido');
    }
    const ref = doc(db, `users/${uid}/sync_control/state`);

    return runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        const control = snapshot.exists() ? parseReplicaControl(snapshot.data()) : emptyControl();
        const now = Date.now();

        let slot: string | undefined;
        let action: ReplicaMutationAction;
        let replicaId: string;
        let generation: number;
        let baseSeq = 0;

        if (currentReplica) {
            const existing = control.replicas[currentReplica.slot];
            if (matchesReplica(existing, currentReplica) && existing!.leaseUntilMs + REPLICA_CLOCK_SKEW_MARGIN_MS >= now) {
                slot = currentReplica.slot;
                action = 'checkpoint';
                replicaId = currentReplica.replicaId;
                generation = currentReplica.generation;
                baseSeq = Math.max(existing!.lastSeq, localActorSeq);
            }
        }

        if (!slot && normalizedCandidate) {
            const concurrentClaim = Object.entries(control.replicas).find(([, entry]) =>
                entry.status === 'active'
                && entry.replicaId === normalizedCandidate
                && entry.leaseUntilMs + REPLICA_CLOCK_SKEW_MARGIN_MS >= now
            );
            if (concurrentClaim) {
                const [claimedSlot, entry] = concurrentClaim;
                slot = claimedSlot;
                action = 'checkpoint';
                replicaId = entry.replicaId;
                generation = entry.generation;
                baseSeq = Math.max(entry.lastSeq, localActorSeq, normalizedCheckpoint[claimedSlot] ?? 0);
            }
        }

        if (!slot) {
            slot = SLOT_IDS.find(candidate => control.replicas[candidate] === undefined);
            action = 'register';
            if (!slot) {
                slot = SLOT_IDS.find(candidate => control.replicas[candidate]?.status === 'retired');
                action = 'reuse-expired';
            }
            if (!slot) {
                slot = SLOT_IDS.find(candidate => {
                    const entry = control.replicas[candidate];
                    return entry?.status === 'active' && entry.leaseUntilMs + REPLICA_CLOCK_SKEW_MARGIN_MS < now;
                });
                action = 'reuse-expired';
            }
            if (!slot) throw new ReplicaCapacityError();

            const previous = control.replicas[slot];
            const candidateAlreadyUsed = normalizedCandidate
                && Object.values(control.replicas).some(entry => entry.replicaId === normalizedCandidate);
            replicaId = normalizedCandidate && !candidateAlreadyUsed ? normalizedCandidate : generateId('replica');
            generation = (previous?.generation ?? 0) + 1;
            baseSeq = Math.max(
                previous?.lastSeq ?? 0,
                normalizedCheckpoint[slot] ?? 0,
                currentReplica?.slot === slot ? localActorSeq : 0,
            );
        }

        const checkpointAtMs = now;
        const leaseUntilMs = now + REPLICA_LEASE_MS;
        const identity: ReplicaIdentity = { slot, replicaId: replicaId!, generation: generation!, leaseUntilMs, checkpointAtMs };
        const entry: ReplicaControlEntry = {
            replicaId: identity.replicaId,
            generation: identity.generation,
            leaseUntilMs: identity.leaseUntilMs,
            checkpointAtMs: identity.checkpointAtMs,
            status: 'active',
            lastSeq: baseSeq,
            checkpointClock: normalizedCheckpoint,
        };

        transaction.set(ref, {
            protocolVersion: 3,
            replicas: { ...control.replicas, [slot]: entry },
            mutation: { slot, action: action! },
        });

        return { identity, baseSeq };
    });
}
