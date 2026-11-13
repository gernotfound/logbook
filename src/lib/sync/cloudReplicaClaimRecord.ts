import { parseVectorClock, type VectorClock } from './semanticProjection';
import type { CloudReplicaClaimRequest } from './cloudReplicaTransport';

export type CloudflareReplicaClaimIntent = CloudReplicaClaimRequest;

const SLOT = /^s(?:0[0-9]|1[0-5])$/;
const ID = /^[A-Za-z0-9_-]{16,128}$/;
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const safe = (n: unknown, min: number): n is number =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= min;

function replicaTuple(value: unknown): CloudReplicaClaimRequest['currentReplica'] {
    if (value === null) return null;
    if (!record(value) || Object.keys(value).sort().join(',') !== 'generation,replicaId,slot'
        || typeof value.slot !== 'string' || !SLOT.test(value.slot)
        || typeof value.replicaId !== 'string' || !value.replicaId.trim()
        || value.replicaId.trim() !== value.replicaId || value.replicaId.length > 128
        || !safe(value.generation, 1)) throw new Error('Intento claim D1 non valido: archivio cifrato preservato.');
    return { slot: value.slot, replicaId: value.replicaId, generation: value.generation };
}

/**
 * The encrypted owner vault is the only source of an outstanding membership
 * request. Never regenerate its mutation ID on a retry after lost HTTP ACK.
 * The record is proof of a staged REQUEST, never proof of granted membership.
 */
export function parseCloudflareReplicaClaimIntent(
    raw: unknown,
    consentRevision?: number,
): CloudflareReplicaClaimIntent {
    if (!record(raw)
        || Object.keys(raw).sort().join(',') !==
          'candidateReplicaId,checkpointClock,consentRevision,currentReplica,expectedFenceEpoch,expectedRevision,mutationId'
        || typeof raw.mutationId !== 'string' || !ID.test(raw.mutationId)
        || typeof raw.candidateReplicaId !== 'string' || !raw.candidateReplicaId.trim()
        || raw.candidateReplicaId.trim() !== raw.candidateReplicaId || raw.candidateReplicaId.length > 128
        || !safe(raw.expectedRevision, 0) || !safe(raw.expectedFenceEpoch, 1)
        || !safe(raw.consentRevision, 1) || raw.consentRevision !== consentRevision) {
        throw new Error('Intento claim D1 non valido: archivio cifrato preservato.');
    }
    const clock: VectorClock = parseVectorClock(raw.checkpointClock, 'D1 claim checkpoint');
    if (Object.keys(clock).length > 16 || Object.keys(clock).some(actor => !SLOT.test(actor))) {
        throw new Error('Intento claim D1 non valido: archivio cifrato preservato.');
    }
    return {
        mutationId: raw.mutationId,
        expectedRevision: raw.expectedRevision,
        expectedFenceEpoch: raw.expectedFenceEpoch,
        consentRevision: raw.consentRevision,
        candidateReplicaId: raw.candidateReplicaId,
        currentReplica: replicaTuple(raw.currentReplica),
        checkpointClock: clock,
    };
}
