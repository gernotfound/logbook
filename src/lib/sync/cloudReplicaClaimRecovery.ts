import equal from 'fast-deep-equal';
import type { AuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import { readAuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import {
    CloudReplicaMutationReconciliationRequiredError,
    type CloudReplicaControlSnapshot, type CloudReplicaMutationResult, type createCloudflareReplicaTransport,
} from './cloudReplicaTransport';
import { parseCloudflareReplicaClaimIntent, type CloudflareReplicaClaimIntent } from './cloudReplicaClaimRecord';
import { readLocal } from './localRepository';
import { adoptReplicaCheckpoint } from './localReplicaCheckpoint';
import { normalizeStorageOwner } from './owner';
import { checkpointFromCloudDocuments, type ReplicaIdentity } from './replicaProtocol';
import { updateArchiveRecord } from './secureArchiveRepository';
import { mergeVectors, parseSyncMeta } from './semanticProjection';
import { validateLocalEnvelope } from './localEnvelopeValidation';

type Guard = () => boolean;
type Transport = Pick<ReturnType<typeof createCloudflareReplicaTransport>, 'replayStoredClaim' | 'control' | 'scanAll'>;

function current(guard: Guard): void {
    if (!guard()) throw new Error('Claim D1 invalidato dalla sessione: archivio e journal preservati.');
}
function account(ownerInput: string): { owner: string; uid: string } {
    const owner = normalizeStorageOwner(ownerInput);
    if (!owner.startsWith('user:') || owner.length < 6) throw new Error('Claim D1 riservato a un account.');
    return { owner, uid: owner.slice(5) };
}
function tuple(replica: ReplicaIdentity | null) {
    return replica ? {
        slot: replica.slot, replicaId: replica.replicaId, generation: replica.generation,
    } : null;
}
function snapshotClock(snapshot: AuthenticatedCloudflareCheckpoint) {
    let clock: Record<string, number> = {};
    for (const verified of snapshot.documents.values()) {
        clock = mergeVectors(clock, parseSyncMeta(verified.sync).clock);
    }
    return clock;
}

/**
 * Candidate: persist an authenticated, bounded claim REQUEST in the encrypted
 * owner vault before any network call. The original mutationId is retained
 * across process death; the record is not evidence of a successful claim.
 */
export async function stageCloudflareReplicaClaim(
    ownerInput: string,
    verified: AuthenticatedCloudflareCheckpoint,
    control: CloudReplicaControlSnapshot,
    candidateReplicaId: string,
    guard: Guard,
): Promise<CloudflareReplicaClaimIntent> {
    const { owner } = account(ownerInput);
    current(guard);
    if (verified.revision !== control.revision || verified.fenceEpoch !== control.fenceEpoch
        || verified.consentRevision !== control.consentRevision) {
        throw new Error('Snapshot claim D1 obsoleto: journal preservato.');
    }
    const checkpointClock = snapshotClock(verified);
    const mutationId = crypto.randomUUID();
    let staged: CloudflareReplicaClaimIntent | undefined;
    await updateArchiveRecord<unknown>(owner, raw => {
        current(guard);
        const local = validateLocalEnvelope(raw, owner);
        if (!local || local.cloudIntegrityFence || local.cloudflareDelivery || local.cloudflareReplicaClaim
            || local.cloudflareReplicaRetirement || local.consentRevision !== control.consentRevision) {
            throw new Error('Claim D1 non installabile: archivio, consenso o sync non coerenti.');
        }
        const input = parseCloudflareReplicaClaimIntent({
            mutationId, expectedRevision: control.revision, expectedFenceEpoch: control.fenceEpoch,
            consentRevision: control.consentRevision, candidateReplicaId,
            currentReplica: tuple(local.replica), checkpointClock,
        }, local.consentRevision);
        staged = input;
        return { ...local, cloudflareReplicaClaim: input, revision: local.revision + 1 };
    });
    current(guard);
    if (!staged) throw new Error('Intento claim D1 non persistito.');
    return staged;
}

/**
 * A historical receipt is proof of the original claim only, not a live grant.
 * Adoption remains safe after an unrelated control revision solely when the
 * original incarnation is still active and unchanged, a fresh complete AEAD
 * scan has the same causal clock as the staged checkpoint, and two control
 * reads agree. A changed document/lease/sequence requires a new guarded claim.
 * The pending local business journal is never ACKed by membership recovery.
 */
export async function resumeCloudflareReplicaClaim(
    ownerInput: string,
    accountKey: Uint8Array,
    transport: Transport,
    csrfToken: string,
    guard: Guard,
): Promise<'idle' | 'adopted' | 'reconciliation-required'> {
    const { owner, uid } = account(ownerInput);
    current(guard);
    if (!(accountKey instanceof Uint8Array) || accountKey.length !== 32 || !csrfToken) {
        throw new Error('ADK o sessione D1 assente: journal preservato.');
    }
    const before = await readLocal(owner);
    current(guard);
    if (!before) throw new Error('Archivio locale assente: claim sospeso.');
    const intent = before.cloudflareReplicaClaim;
    if (!intent) return 'idle';
    if (before.cloudIntegrityFence || before.cloudflareDelivery || before.cloudflareReplicaRetirement
        || before.consentRevision !== intent.consentRevision) {
        throw new Error('Barriera integrità D1: claim sospeso.');
    }

    let receipt: CloudReplicaMutationResult;
    try {
        receipt = await transport.replayStoredClaim(intent, csrfToken);
    } catch (error) {
        current(guard);
        if (!(error instanceof CloudReplicaMutationReconciliationRequiredError)) throw error;
        // The transport has already validated the request-bound historical
        // receipt; only the guarded full AEAD scan can authorize adoption.
        receipt = error.historicalReceipt;
    }
    current(guard);
    if (!['register', 'checkpoint', 'reuse-expired'].includes(receipt.action)
        || receipt.mutationId !== intent.mutationId
        || receipt.revision !== intent.expectedRevision + 1
        || !Number.isSafeInteger(receipt.currentRevision)
        || receipt.currentRevision < receipt.revision) return 'reconciliation-required';
    // A receipt proves the original request but NOT what is currently in D1.
    const control = await transport.control();
    current(guard);
    if (control.revision < receipt.currentRevision
        || control.fenceEpoch !== intent.expectedFenceEpoch
        || control.consentRevision !== intent.consentRevision) {
        return 'reconciliation-required';
    }
    const entry = control.replicas[receipt.replica.slot];
    if (!entry || entry.status !== 'active' || entry.replicaId !== receipt.replica.replicaId
        || entry.generation !== receipt.replica.generation || entry.lastSeq !== receipt.baseSeq
        || entry.leaseUntilMs !== receipt.replica.leaseUntilMs
        || entry.checkpointAtMs !== receipt.replica.checkpointAtMs
        || !equal(entry.checkpointClock, intent.checkpointClock)
        || entry.leaseUntilMs <= Date.now()) {
        return 'reconciliation-required';
    }

    const verified = await readAuthenticatedCloudflareCheckpoint(
        () => transport.scanAll(), uid, accountKey, intent.consentRevision, guard,
    );
    current(guard);
    if (verified.revision !== control.revision || verified.fenceEpoch !== control.fenceEpoch
        || verified.consentRevision !== control.consentRevision
        || !equal(snapshotClock(verified), intent.checkpointClock)) {
        return 'reconciliation-required';
    }
    const currentControl = await transport.control();
    current(guard);
    if (!equal(control, currentControl)) return 'reconciliation-required';
    const docMap = new Map<string, Record<string, unknown>>();
    for (const [path, doc] of verified.documents) {
        docMap.set(path, { _sync: doc.sync });
    }
    const checkpoint = checkpointFromCloudDocuments(docMap);
    await adoptReplicaCheckpoint(owner, {
        identity: receipt.replica, baseSeq: receipt.baseSeq,
    }, checkpoint, guard, intent.mutationId);
    current(guard);
    return 'adopted';
}
