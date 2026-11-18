import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { getVerifiedHealthConsentRevision } from '../healthConsent';
import { generateId } from '../utils/date';
import {
    REPLICA_SLOT_COUNT, REPLICA_LEASE_MS, REPLICA_CLOCK_SKEW_MARGIN_MS, SLOT_IDS,
    ReplicaCapacityError, parseReplicaCheckpointClock, parseReplicaControl,
    matchesReplica, emptyControl,
    type ReplicaMutationAction, type ReplicaIdentity, type ReplicaControlEntry,
    type ReplicaCheckpoint,
} from './replicaProtocol';
import type { VectorClock } from './semanticProjection';

// Transitional Firestore-only maintenance; no Kinde/D1 module may import this adapter.
export async function retireExpiredReplicas(
    db: Firestore, uid: string, now = Date.now(), isCurrent: () => boolean = () => true,
): Promise<void> {
    if (!uid || uid.includes('/')) throw new Error('Identità non valida');
    if (!isCurrent()) throw new Error('Sessione cambiata prima del retirement replica');
    const ref = doc(db, `users/${uid}/sync_control/state`);

    // Retire at most one slot per transaction because Security Rules deliberately
    // constrain every control mutation to one replica entry. Repeat until no locally
    // expired entry remains. Server request.time is still the authoritative proof.
    for (let attempt = 0; attempt < REPLICA_SLOT_COUNT; attempt += 1) {
        if (!isCurrent()) throw new Error('Sessione cambiata durante il retirement replica');
        let retired = false;
        try {
            await runTransaction(db, async transaction => {
                if (!isCurrent()) throw new Error('Sessione cambiata durante il retirement replica');
                const snapshot = await transaction.get(ref);
                if (!isCurrent()) throw new Error('Sessione cambiata durante il retirement replica');
                if (!snapshot.exists()) return;
                const current = parseReplicaControl(snapshot.data());
                const candidate = Object.entries(current.replicas).find(([, entry]) =>
                    entry.status === 'active' && entry.leaseUntilMs + REPLICA_CLOCK_SKEW_MARGIN_MS < now
                );
                if (!candidate) return;

                if (!isCurrent()) throw new Error('Sessione cambiata durante il retirement replica');
                const [slot, entry] = candidate;
                transaction.set(ref, {
                    protocolVersion: 3,
                    ...(current.consentRevision !== undefined ? { consentRevision: current.consentRevision } : {}),
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
    isCurrent: () => boolean = () => true,
): Promise<ReplicaCheckpoint> {
    if (!uid || uid.includes('/')) throw new Error('Identità non valida');
    if (!isCurrent()) throw new Error('Sessione cambiata prima del checkpoint replica');
    const normalizedCheckpoint = parseReplicaCheckpointClock(checkpointClock);
    const normalizedCandidate = candidateReplicaId?.trim();
    if (normalizedCandidate !== undefined && (!normalizedCandidate || normalizedCandidate.length > 128)) {
        throw new Error('Replica candidate ID non valido');
    }
    const ref = doc(db, `users/${uid}/sync_control/state`);

    return runTransaction(db, async transaction => {
        if (!isCurrent()) throw new Error('Sessione cambiata durante il checkpoint replica');
        const snapshot = await transaction.get(ref);
        if (!isCurrent()) throw new Error('Sessione cambiata durante il checkpoint replica');
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

        if (!isCurrent()) throw new Error('Sessione cambiata durante il checkpoint replica');
        const consentRevision = getVerifiedHealthConsentRevision(uid);
        if (!isCurrent()) throw new Error('Sessione cambiata durante il checkpoint replica');
        transaction.set(ref, {
            protocolVersion: 3,
            ...(consentRevision > 0 ? { consentRevision } : {}),
            replicas: { ...control.replicas, [slot]: entry },
            mutation: { slot, action: action! },
        });

        return { identity, baseSeq };
    });
}
