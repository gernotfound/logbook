import { resumeCloudflareDelivery, stageCloudflareDelivery } from './cloudReplicaDurableDelivery';
import { CloudReplicaTransportError, type createCloudflareReplicaTransport } from './cloudReplicaTransport';
import { restageUncommittedCloudflareDelivery } from './cloudReplicaDeliveryRecovery';
import { ensureBoundedPendingSequences, readLocal } from './localRepository';
import { normalizeStorageOwner } from './owner';
import { boundedPendingTransactionBatch } from './syncBatching';

type CandidateTransport = Pick<
    ReturnType<typeof createCloudflareReplicaTransport>,
    'control' | 'read' | 'commit' | 'receipt' | 'commitOutcome' | 'scanAll'
>;
type SessionGuard = () => boolean;
type JournalAccessScope = Readonly<{ consentRevision: number; fenceEpoch: number }>;

async function resumeOrRestage(
    owner: string,
    accountKey: Uint8Array,
    transport: CandidateTransport,
    csrfToken: string,
    guard: SessionGuard,
): Promise<'idle' | 'acknowledged' | 'retry-staged' | 'reconciliation-required'> {
    try {
        return await resumeCloudflareDelivery(owner, accountKey, transport, csrfToken, guard);
    } catch (error) {
        if (!(error instanceof CloudReplicaTransportError) || error.status !== 409) throw error;
        requireCurrent(guard);
        return restageUncommittedCloudflareDelivery(owner, accountKey, transport, csrfToken, guard);
    }
}

function requireCurrent(guard: SessionGuard): void {
    if (!guard()) throw new Error('Sessione D1 cambiata: journal locale preservato.');
}

/**
 * Isolated candidate only: composes the existing D1 stages without changing
 * replicateJournal() or choosing an Auth provider. The caller must supply a
 * trusted session/consent guard, an ADK and a session-bound CSRF token.
 *
 * A staged request is immutable. On an ambiguous commit or 409, it must be
 * replayed or reconciled against a primary-SQL non-commit proof, never resealed.
 */
export async function deliverCloudflareJournalCandidate(
    ownerInput: string,
    accountKey: Uint8Array,
    transport: CandidateTransport,
    csrfToken: string,
    guard: SessionGuard,
    expected?: JournalAccessScope,
): Promise<'idle' | 'acknowledged' | 'retry-staged' | 'reconciliation-required'> {
    const owner = normalizeStorageOwner(ownerInput);
    if (!owner.startsWith('user:') || !(accountKey instanceof Uint8Array)
        || accountKey.length !== 32 || !csrfToken) {
        throw new Error('Account, chiave o sessione D1 non validi: journal preservato.');
    }
    requireCurrent(guard);
    const local = await readLocal(owner);
    requireCurrent(guard);
    if (!local) throw new Error('Archivio locale assente: nessuna consegna D1 autorizzata.');
    if (expected && local.consentRevision !== expected.consentRevision) {
        throw new Error('Consenso locale D1 differente: journal preservato.');
    }
    if (expected && local.cloudflareDelivery && local.cloudflareDelivery.batch.expectedFenceEpoch !== expected.fenceEpoch) {
        throw new Error('Intento D1 di un’altra epoca: journal preservato per il recupero.');
    }
    if (local.cloudIntegrityFence || local.cloudflareReplicaClaim || local.cloudflareReplicaRetirement) {
        throw new Error('Replica D1 non pronta: journal locale preservato.');
    }

    // Always recover the original encrypted intent before considering a new
    // batch. A new nonce or batch ID after a lost response would break replay.
    if (local.cloudflareDelivery) {
        return resumeOrRestage(owner, accountKey, transport, csrfToken, guard);
    }
    if (!local.pending.length) return 'idle';
    if (!local.replica || local.actorId !== local.replica.slot
        || local.replica.leaseUntilMs <= Date.now()
        || !local.consentRevision || local.pending.some(op => op.actorId !== local.replica?.slot)) {
        throw new Error('Replica o consenso D1 non validi: journal preservato.');
    }

    // A causal sequence must never be sliced across D1 batches. Resequence
    // atomically in the owner vault before staging any immutable ciphertext.
    const prepared = await ensureBoundedPendingSequences(owner, local.actorId, guard);
    requireCurrent(guard);
    if (!prepared || prepared.cloudIntegrityFence || prepared.cloudflareDelivery
        || prepared.cloudflareReplicaClaim || prepared.cloudflareReplicaRetirement
        || !prepared.replica || prepared.actorId !== prepared.replica.slot
        || prepared.replica.replicaId !== local.replica.replicaId
        || prepared.replica.generation !== local.replica.generation
        || prepared.replica.leaseUntilMs <= Date.now()
        || prepared.consentRevision !== local.consentRevision
        || prepared.pending.some(op => op.actorId !== prepared.replica?.slot)) {
        throw new Error('Replica o journal D1 variati: operazioni locali preservate.');
    }
    if (!prepared.pending.length) return 'idle';

    const operations = boundedPendingTransactionBatch(prepared.pending);
    if (!operations.length) throw new Error('Prefisso causale D1 assente: journal preservato.');
    const paths = [...new Set(operations.map(op => op.docPath))];
    const control = await transport.control();
    requireCurrent(guard);
    if (control.consentRevision !== prepared.consentRevision) {
        throw new Error('Consenso cloud D1 differente: journal preservato.');
    }
    if (expected && control.fenceEpoch !== expected.fenceEpoch) {
        throw new Error('Epoca cloud D1 differente: journal preservato.');
    }
    const snapshot = await transport.read(paths);
    requireCurrent(guard);

    // The stage verifies that control and document revisions match and that
    // the causal prefix still equals the one committed in IndexedDB.
    const batchId = Array.from(crypto.getRandomValues(new Uint8Array(16)),
        byte => byte.toString(16).padStart(2, '0')).join('');
    await stageCloudflareDelivery(
        owner, operations, snapshot, control, prepared.replica, batchId, accountKey, guard,
    );
    requireCurrent(guard);
    return resumeOrRestage(owner, accountKey, transport, csrfToken, guard);
}
