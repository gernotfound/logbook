import equal from 'fast-deep-equal';
import type { AuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import { readAuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import {
    CloudReplicaCapacityError, CloudReplicaMutationReconciliationRequiredError, CloudReplicaTransportError,
    type CloudReplicaControlSnapshot, type CloudReplicaMutationResult, type createCloudflareReplicaTransport,
} from './cloudReplicaTransport';
import { parseCloudflareReplicaClaimIntent, type CloudflareReplicaClaimIntent } from './cloudReplicaClaimRecord';
import { readLocal } from './localArchiveBootstrap';
import { adoptReplicaCheckpoint, ReplicaPendingReconciliationRequiredError } from './localReplicaCheckpoint';
import { normalizeStorageOwner } from './owner';
import { checkpointFromCloudDocuments, type ReplicaIdentity } from './replicaProtocol';
import { updateArchiveRecord } from './secureArchiveRepository';
import { mergeVectors, parseSyncMeta } from './semanticProjection';
import { validateLocalEnvelope } from './localEnvelopeValidation';
import { adoptRetiredReplicaHandoff, hasIntactRetiredReplicaHandoff, matchRetiredReplicaDraftCloud } from './retiredReplicaHandoff';
import { getCachedCatalog } from '../catalog/catalogService';

type Guard = () => boolean;
type Transport = Pick<ReturnType<typeof createCloudflareReplicaTransport>, 'replayStoredClaim' | 'claimMutationOutcome' | 'control' | 'scanAll'>;

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
    expectedLocalRevision?: number,
): Promise<CloudflareReplicaClaimIntent> {
    const { owner, uid } = account(ownerInput);
    current(guard);
    if (control.uid !== uid || verified.revision !== control.revision || verified.fenceEpoch !== control.fenceEpoch
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
            || local.cloudflareReplicaRetirement || local.consentRevision !== control.consentRevision
            || (expectedLocalRevision !== undefined && local.revision !== expectedLocalRevision)) {
            throw new Error('Claim D1 non installabile: archivio, consenso o sync non coerenti.');
        }
        // A retired incarnation's offline operations cannot be assigned a new
        // causal identity until their original frontier has been reconciled.
        // The first claim (replica === null) must still carry new local edits.
        if (local.replica && local.pending.length > 0
            && (!hasIntactRetiredReplicaHandoff(local)
                || local.retiredReplicaTransferDraft?.cloudRevision !== control.revision
                || !matchRetiredReplicaDraftCloud(local.retiredReplicaTransferDraft, verified))) {
            throw new Error('Replica precedente con journal offline: rientro D1 sospeso per riconciliazione esplicita.');
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
 * A new mutation never replaces the original request in flight: the caller
 * must first establish that it cannot still commit, or that an original
 * request-bound receipt already proves commit. The complete new request is
 * sealed in the same owner transaction, without touching business pending.
 */
async function replaceClaimIntent(
    owner: string,
    intent: CloudflareReplicaClaimIntent,
    control: CloudReplicaControlSnapshot,
    checkpointClock: Record<string, number>,
    guard: Guard,
): Promise<'retry-staged' | 'reconciliation-required'> {
    const next = parseCloudflareReplicaClaimIntent({
        ...intent, mutationId: crypto.randomUUID(),
        expectedRevision: control.revision, checkpointClock,
    }, intent.consentRevision);
    let lateOldPending = false;
    await updateArchiveRecord<unknown>(owner, raw => {
        current(guard);
        const saved = validateLocalEnvelope(raw, owner);
        if (!saved || saved.cloudIntegrityFence || saved.cloudflareDelivery
            || saved.cloudflareReplicaRetirement || saved.cloudflareReplicaCancellation
            || saved.consentRevision !== intent.consentRevision
            || !equal(saved.cloudflareReplicaClaim, intent)
            || !equal(tuple(saved.replica), intent.currentReplica)) {
            throw new Error('Rebase claim D1 concorrente o non autorizzato: intent e journal preservati.');
        }
        // A second tab can append to the old replica while the primary proof
        // and AEAD scan run. Do not seal a NEW, not-yet-committed claim over
        // that journal; the first claim (no previous replica) is unaffected.
        if (saved.replica && saved.pending.length > 0) {
            lateOldPending = true;
            return raw;
        }
        return { ...saved, cloudflareReplicaClaim: next, revision: saved.revision + 1 };
    });
    current(guard);
    return lateOldPending ? 'reconciliation-required' : 'retry-staged';
}

/**
 * Rebase a stale claim only after the primary DB has atomically observed the
 * original mutation absent AND its expected revision permanently surpassed.
 * The new request is sealed locally before any subsequent network attempt;
 * an ambiguous 409 or a failed authenticated scan preserves the original.
 */
async function rebaseUncommittedClaim(
    owner: string,
    uid: string,
    intent: CloudflareReplicaClaimIntent,
    accountKey: Uint8Array,
    transport: Transport,
    csrfToken: string,
    guard: Guard,
): Promise<'retry-staged' | 'reconciliation-required'> {
    const outcome = await transport.claimMutationOutcome(intent, csrfToken);
    current(guard);
    if (outcome.outcome !== 'not-committed') return 'reconciliation-required';

    const control = await transport.control();
    current(guard);
    if (control.uid !== uid || control.revision !== outcome.currentRevision
        || control.revision <= intent.expectedRevision
        || control.fenceEpoch !== intent.expectedFenceEpoch
        || control.consentRevision !== intent.consentRevision) return 'reconciliation-required';

    const verified = await readAuthenticatedCloudflareCheckpoint(
        () => transport.scanAll(), uid, accountKey, intent.consentRevision, guard,
    );
    current(guard);
    if (verified.revision !== control.revision
        || verified.fenceEpoch !== control.fenceEpoch
        || verified.consentRevision !== control.consentRevision) {
        return 'reconciliation-required';
    }
    const again = await transport.control();
    current(guard);
    if (!equal(control, again)) return 'reconciliation-required';

    return replaceClaimIntent(owner, intent, control, snapshotClock(verified), guard);
}

/**
 * A historical receipt is proof of the original claim only, not a live grant.
 * Adoption remains safe after an unrelated control revision solely when the
 * original incarnation is still active and unchanged, a fresh complete AEAD
 * scan has the same causal clock as the staged checkpoint, and two control
 * reads agree. A changed document clock may instead stage a fresh request,
 * only while the exact original incarnation remains live and both controls
 * agree; it cannot silently adopt changed data or ACK pending business.
 * Lease, sequence or membership changes still require separate recovery.
 */
export async function resumeCloudflareReplicaClaim(
    ownerInput: string,
    accountKey: Uint8Array,
    transport: Transport,
    csrfToken: string,
    guard: Guard,
): Promise<'idle' | 'adopted' | 'retry-staged' | 'reconciliation-required'> {
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
    const transfer = before.pending.length > 0 && hasIntactRetiredReplicaHandoff(before)
        && before.retiredReplicaTransferDraft?.cloudRevision === intent.expectedRevision;
    if (before.cloudflareReplicaCancellation) return 'reconciliation-required';
    if (before.cloudIntegrityFence || before.cloudflareDelivery || before.cloudflareReplicaRetirement
        || before.consentRevision !== intent.consentRevision) {
        throw new Error('Barriera integrità D1: claim sospeso.');
    }

    // A second tab may have added offline operations to the previous replica
    // after staging. Live control alone does not make replay safe: the lease
    // can expire before the server chooses checkpoint vs slot replacement.
    // Only a primary-ledger proof of the original immutable commit guarantees
    // replay cannot make a new membership write. Adoption still needs the
    // original incarnation and the final IndexedDB fence.
    if (intent.currentReplica && before.pending.length > 0 && !transfer) {
        if (!equal(tuple(before.replica), intent.currentReplica)) return 'reconciliation-required';
        const control = await transport.control();
        current(guard);
        const entry = control.replicas[intent.currentReplica.slot];
        if (control.uid !== uid || control.fenceEpoch !== intent.expectedFenceEpoch
            || control.consentRevision !== intent.consentRevision
            || !entry || entry.status !== 'active'
            || entry.replicaId !== intent.currentReplica.replicaId
            || entry.generation !== intent.currentReplica.generation
            || entry.leaseUntilMs <= Date.now()) return 'reconciliation-required';
        const outcome = await transport.claimMutationOutcome(intent, csrfToken);
        current(guard);
        if (outcome.outcome !== 'committed') return 'reconciliation-required';
        const latest = await readLocal(owner);
        current(guard);
        if (!latest || !equal(latest.cloudflareReplicaClaim, intent)
            || !equal(tuple(latest.replica), intent.currentReplica)
            || latest.cloudflareReplicaCancellation || latest.cloudIntegrityFence) return 'reconciliation-required';
    }

    let receipt: CloudReplicaMutationResult;
    try {
        receipt = await transport.replayStoredClaim(intent, csrfToken);
    } catch (error) {
        current(guard);
        if (error instanceof CloudReplicaCapacityError) throw error;
        if (!(error instanceof CloudReplicaMutationReconciliationRequiredError)) {
            if (error instanceof CloudReplicaTransportError && error.status === 409) {
                if (transfer) return 'reconciliation-required';
                return rebaseUncommittedClaim(owner, uid, intent, accountKey, transport, csrfToken, guard);
            }
            throw error;
        }
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
    if (intent.currentReplica) {
        // A write can arrive during the HTTP claim, after the first local
        // snapshot. Recheck its durable journal before any adoption scan;
        // the final IndexedDB fence still handles edits after this read.
        const latest = await readLocal(owner);
        current(guard);
        if (!latest || !equal(latest.cloudflareReplicaClaim, intent)
            || !equal(tuple(latest.replica), intent.currentReplica)
            || latest.cloudflareReplicaCancellation || latest.cloudIntegrityFence) return 'reconciliation-required';
        if (transfer && !hasIntactRetiredReplicaHandoff(latest)) return 'reconciliation-required';
        if (latest.pending.length > 0 && !transfer
            && (receipt.action !== 'checkpoint' || !equal(tuple(receipt.replica), intent.currentReplica))) {
            return 'reconciliation-required';
        }
    }
    // A receipt proves the original request but NOT what is currently in D1.
    const control = await transport.control();
    current(guard);
    if (control.uid !== uid || control.revision < receipt.currentRevision
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
        || verified.consentRevision !== control.consentRevision) {
        return 'reconciliation-required';
    }
    const verifiedClock = snapshotClock(verified);
    const currentControl = await transport.control();
    current(guard);
    if (!equal(control, currentControl)) return 'reconciliation-required';
    // The AEAD scan and both control reads can outlast the original lease.
    // Fence the final IndexedDB commit as well, not just the first read.
    if (entry.leaseUntilMs <= Date.now()) return 'reconciliation-required';
    const liveMembership = () => guard() && entry.leaseUntilMs > Date.now();
    if (!equal(verifiedClock, intent.checkpointClock)) {
        if (transfer) return 'reconciliation-required';
        // The original claim committed, but independently committed documents
        // advanced. Restage a new request only while the original membership
        // and its receipt metadata still match; no current grant is inferred.
        return replaceClaimIntent(owner, intent, control, verifiedClock, liveMembership);
    }
    const docMap = new Map<string, Record<string, unknown>>();
    for (const [path, doc] of verified.documents) {
        docMap.set(path, { _sync: doc.sync });
    }
    const checkpoint = checkpointFromCloudDocuments(docMap);
    if (transfer) {
        const latest = await readLocal(owner);
        current(liveMembership);
        if (!latest || !equal(latest.cloudflareReplicaClaim, intent)
            || !hasIntactRetiredReplicaHandoff(latest)
            || !latest.retiredReplicaTransferDraft
            || !matchRetiredReplicaDraftCloud(latest.retiredReplicaTransferDraft, verified)
            || receipt.action === 'checkpoint' || !equal(tuple(latest.replica), intent.currentReplica)) {
            return 'reconciliation-required';
        }
        try {
            const catalog = await getCachedCatalog();
            current(liveMembership);
            await adoptRetiredReplicaHandoff(owner, { identity: receipt.replica, baseSeq: receipt.baseSeq },
                verified, catalog, intent.mutationId, latest, liveMembership);
        } catch (error) {
            if (error instanceof ReplicaPendingReconciliationRequiredError) return 'reconciliation-required';
            throw error;
        }
        current(liveMembership);
        return 'adopted';
    }
    try {
        await adoptReplicaCheckpoint(owner, {
            identity: receipt.replica, baseSeq: receipt.baseSeq,
        }, checkpoint, liveMembership, intent.mutationId);
    } catch (error) {
        // The final owner transaction can observe a write newer than the
        // response/AEAD reads. Only this precise causal fence is recoverable;
        // unrelated archive, consent and storage failures must still surface.
        if (error instanceof ReplicaPendingReconciliationRequiredError) return 'reconciliation-required';
        throw error;
    }
    current(liveMembership);
    return 'adopted';
}
