import equal from 'fast-deep-equal';
import { getCachedCatalog } from '../catalog/catalogService';
import type { UserData } from '../../types';
import { applyRemoteDocuments, type DocumentData } from './documentProjection';
import { readAccountCloudDocument } from './cloudDocumentRead';
import { prepareCloudflareCommit } from './cloudReplicaCommit';
import type {
    CloudReplicaControlSnapshot, CloudReplicaSnapshot, createCloudflareReplicaTransport,
} from './cloudReplicaTransport';
import { parseCloudflareDeliveryIntent, type CloudflareDeliveryIntent } from './cloudReplicaDeliveryRecord';
import { readLocal, acknowledgeThrough } from './localRepository';
import { normalizeStorageOwner } from './owner';
import type { ReplicaIdentity } from './replicaProtocol';
import { updateArchiveRecord } from './secureArchiveRepository';
import { parseSyncMeta, type SemanticOperation, type SyncMeta } from './semanticProjection';
import { boundedPendingTransactionBatch } from './syncBatching';
import { validateLocalEnvelope } from './localEnvelopeValidation';

type DeliveryTransport = Pick<ReturnType<typeof createCloudflareReplicaTransport>, 'commit' | 'receipt'>;
type SessionGuard = () => boolean;

function checkedOwner(owner: string): { owner: string; uid: string } {
    const canonical = normalizeStorageOwner(owner);
    if (!canonical.startsWith('user:') || canonical.length <= 5) {
        throw new Error('Consegna D1 disponibile solo per un account verificato.');
    }
    return { owner: canonical, uid: canonical.slice(5) };
}
function current(guard: SessionGuard): void {
    if (!guard()) throw new Error('Consegna D1 invalidata dalla sessione: journal preservato.');
}

/**
 * STAGING ONLY: no network request until the original, random-nonce AEAD
 * ciphertext and its complete causal prefix are encrypted into ONE owner
 * vault transaction. Never re-seal a pending attempt after a crash.
 */
export async function stageCloudflareDelivery(
    ownerInput: string,
    operations: SemanticOperation[],
    snapshot: CloudReplicaSnapshot,
    control: CloudReplicaControlSnapshot,
    replica: ReplicaIdentity,
    batchId: string,
    accountKey: Uint8Array,
    guard: SessionGuard,
): Promise<CloudflareDeliveryIntent> {
    const { owner, uid } = checkedOwner(ownerInput);
    current(guard);
    const prepared = prepareCloudflareCommit(
        uid, operations, snapshot, control, replica, batchId, accountKey, guard,
    );
    const intent: CloudflareDeliveryIntent = {
        batch: prepared.batch, replica: structuredClone(replica),
        operations: structuredClone(operations),
    };
    await updateArchiveRecord<unknown>(owner, raw => {
        current(guard);
        const envelope = validateLocalEnvelope(raw, owner);
        if (!envelope || envelope.cloudflareDelivery || envelope.cloudIntegrityFence
            || !envelope.replica || envelope.replica.slot !== replica.slot
            || envelope.replica.replicaId !== replica.replicaId
            || envelope.replica.generation !== replica.generation
            || envelope.consentRevision !== intent.batch.consentRevision
            || !equal(boundedPendingTransactionBatch(envelope.pending), operations)) {
            throw new Error('Intento D1 non installabile: journal o replica variati, ciphertext preservati.');
        }
        parseCloudflareDeliveryIntent(intent, owner, envelope.pending, envelope.replica,
            envelope.consentRevision);
        return {
            ...envelope, cloudflareDelivery: intent, revision: envelope.revision + 1,
        };
    });
    current(guard);
    return intent;
}

/**
 * Replays the immutable saved body and accepts only the server's content-bound
 * receipt. An ambiguous response without that proof retains the intent and
 * all pending operations, even when a remote commit may have succeeded.
 *
 * This candidate is deliberately NOT wired to the active Firestore journal.
 * Real Auth, ADK, hydration and local checkpoint adoption remain separate gates.
 */
export async function resumeCloudflareDelivery(
    ownerInput: string,
    accountKey: Uint8Array,
    transport: DeliveryTransport,
    csrfToken: string,
    guard: SessionGuard,
): Promise<'idle' | 'acknowledged'> {
    const { owner, uid } = checkedOwner(ownerInput);
    current(guard);
    if (!(accountKey instanceof Uint8Array) || accountKey.length !== 32 || !csrfToken) {
        throw new Error('Chiave o sessione D1 mancante: journal preservato.');
    }
    const local = await readLocal(owner);
    current(guard);
    if (!local) throw new Error('Archivio locale assente: non è consentito un ACK.');
    if (local.cloudIntegrityFence) {
        throw new Error('Barriera cloud presente: consegna D1 sospesa e journal preservato.');
    }
    const intent = local.cloudflareDelivery;
    if (!intent) return 'idle';

    // AEAD-open every stored byte before any network or ACK action. The D1
    // server has never seen the business plaintext nor the field tombstones.
    const documentData = new Map<string, DocumentData>();
    const syncMeta: Record<string, SyncMeta> = {};
    for (const { path, document } of intent.batch.documents) {
        current(guard);
        const parsed = readAccountCloudDocument(document, 'D1 durable delivery', uid, path, accountKey);
        documentData.set(path, parsed.business);
        syncMeta[path] = parseSyncMeta(parsed.sync);
    }
    const catalog = await getCachedCatalog();
    current(guard);
    const remote: UserData = applyRemoteDocuments(local.data, documentData, catalog);

    let confirmed = await transport.receipt(intent.batch);
    current(guard);
    if (!confirmed) {
        try {
            await transport.commit(intent.batch, csrfToken);
        } catch (error) {
            // A failed HTTP response can follow a successful D1 transaction.
            // The only admissible recovery is the exact saved batch receipt.
            current(guard);
            confirmed = await transport.receipt(intent.batch);
            current(guard);
            if (!confirmed) throw error;
        }
        if (!confirmed) {
            confirmed = await transport.receipt(intent.batch);
            current(guard);
        }
    }
    if (!confirmed || confirmed.revision !== intent.batch.expectedRevision + 1
        || confirmed.lastSeq !== intent.batch.lastSeq) {
        throw new Error('Ricevuta D1 assente o discordante: journal e ciphertext preservati.');
    }
    const delivered = intent.operations;
    const lastSeq = delivered.at(-1)!.seq;
    const months = [...new Set(intent.batch.documents.flatMap(({ path }) =>
        path === '' ? [] : [path.split('/')[1]]))];
    current(guard);
    await acknowledgeThrough(owner, lastSeq, remote, months, syncMeta, {
        operations: delivered, replica: intent.replica,
        cloudflareBatchId: intent.batch.batchId,
    }, guard);
    return 'acknowledged';
}
