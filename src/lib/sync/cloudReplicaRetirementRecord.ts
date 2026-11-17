import type { CloudReplicaRetirementRequest } from './cloudReplicaTransport';

export type CloudflareReplicaRetirementIntent = CloudReplicaRetirementRequest;

const SLOT = /^s(?:0[0-9]|1[0-5])$/;
const ID = /^[A-Za-z0-9_-]{16,128}$/;
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const safe = (value: unknown, min: number): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min;

function invalid(): never {
    throw new Error('Intento retirement D1 non valido: archivio cifrato preservato.');
}

/**
 * A pending retirement is a request, not evidence of remote membership state.
 * Its mutation ID and target incarnation must survive lost HTTP responses unchanged.
 */
export function parseCloudflareReplicaRetirementIntent(
    raw: unknown,
    consentRevision?: number,
): CloudflareReplicaRetirementIntent {
    if (!record(raw)
        || Object.keys(raw).sort().join(',') !==
          'consentRevision,expectedFenceEpoch,expectedRevision,mutationId,replica'
        || typeof raw.mutationId !== 'string' || !ID.test(raw.mutationId)
        || !safe(raw.expectedRevision, 0) || !safe(raw.expectedFenceEpoch, 1)
        || !safe(raw.consentRevision, 1)
        || (consentRevision !== undefined && raw.consentRevision !== consentRevision)
        || !record(raw.replica)
        || Object.keys(raw.replica).sort().join(',') !== 'generation,replicaId,slot'
        || typeof raw.replica.slot !== 'string' || !SLOT.test(raw.replica.slot)
        || typeof raw.replica.replicaId !== 'string' || !raw.replica.replicaId.trim()
        || raw.replica.replicaId.trim() !== raw.replica.replicaId
        || raw.replica.replicaId.length > 128 || !safe(raw.replica.generation, 1)) invalid();

    return {
        mutationId: raw.mutationId,
        expectedRevision: raw.expectedRevision,
        expectedFenceEpoch: raw.expectedFenceEpoch,
        consentRevision: raw.consentRevision,
        replica: {
            slot: raw.replica.slot, replicaId: raw.replica.replicaId,
            generation: raw.replica.generation,
        },
    };
}
