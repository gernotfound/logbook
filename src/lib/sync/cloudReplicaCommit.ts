import { CloudCiphertextError } from './cloudDocumentCipher';
import { prepareEncryptedDocumentChanges, type PreparedEncryptedDocumentChanges } from './cloudMergeEngine';
import type { CloudReplicaBatch, CloudReplicaControlSnapshot, CloudReplicaSnapshot } from './cloudReplicaTransport';
import { stableFrontierFromControl, type ReplicaIdentity } from './replicaProtocol';
import { parseSemanticOperation } from './semanticProjection/metadata';
import type { SemanticOperation } from './semanticProjection/contracts';
import { distinctDocumentCount, MAX_SYNC_DOCUMENTS_PER_TRANSACTION } from './syncBatching';

export class CloudReplicaStaleSnapshotError extends Error {
    constructor() {
        super('Snapshot remoto non coerente: il journal locale resta in attesa.');
        this.name = 'CloudReplicaStaleSnapshotError';
    }
}

/**
 * Candidate D1 commit preparation reuses the exact Firestore semantic+AEAD
 * engine. Callers must independently obtain a trusted replica control and
 * stable frontier; this stage does NOT authorize a remote write or local ACK.
 */
export function prepareCloudflareCommit(
    uid: string,
    rawOperations: SemanticOperation[],
    snapshot: CloudReplicaSnapshot,
    control: CloudReplicaControlSnapshot,
    replica: Pick<ReplicaIdentity, 'slot' | 'replicaId' | 'generation'>,
    batchId: string,
    accountKey: Uint8Array,
    isCurrent: () => boolean,
): { batch: CloudReplicaBatch; outcome: PreparedEncryptedDocumentChanges } {
    if (!isCurrent()) throw new CloudReplicaStaleSnapshotError();
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
        || !Number.isSafeInteger(snapshot.fenceEpoch) || snapshot.fenceEpoch < 1
        || control.revision !== snapshot.revision || control.fenceEpoch !== snapshot.fenceEpoch
        || control.consentRevision !== snapshot.consentRevision
        || !Number.isSafeInteger(control.consentRevision) || control.consentRevision < 1
        || !/^[A-Za-z0-9_-]{16,128}$/.test(batchId)) throw new CloudReplicaStaleSnapshotError();

    const entry = control.replicas[replica.slot];
    if (!entry || entry.status !== 'active' || entry.replicaId !== replica.replicaId
        || entry.generation !== replica.generation || !Number.isSafeInteger(entry.lastSeq)
        || entry.lastSeq < 0 || !Number.isSafeInteger(entry.leaseUntilMs)
        || entry.leaseUntilMs <= Date.now()) throw new CloudReplicaStaleSnapshotError();
    const consentRevision = control.consentRevision;
    const stableFrontier = stableFrontierFromControl(control);

    const ops = rawOperations.map(parseSemanticOperation);
    const paths = [...new Set(ops.map(operation => operation.docPath))];
    if (!ops.length || distinctDocumentCount(ops) > MAX_SYNC_DOCUMENTS_PER_TRANSACTION
        || ops.some(operation => operation.actorId !== replica.slot)
        || snapshot.documents.length !== paths.length) throw new CloudReplicaStaleSnapshotError();

    const remote = new Map<string, unknown>();
    const seen = new Set<string>();
    for (const entry of snapshot.documents) {
        if (!paths.includes(entry.path) || seen.has(entry.path)
            || (entry.document === null) !== (entry.revision === null)
            || (entry.revision !== null && (
                !Number.isSafeInteger(entry.revision) || entry.revision < 1 || entry.revision > snapshot.revision
            ))) throw new CloudReplicaStaleSnapshotError();
        seen.add(entry.path);
        if (entry.document !== null) remote.set(entry.path, entry.document);
    }

    const lastSeq = ops.reduce((max, operation) => Math.max(max, operation.seq), entry.lastSeq);
    if (lastSeq < 1) throw new CloudReplicaStaleSnapshotError();
    const writer = { ...replica, seq: lastSeq, consentRevision };
    const outcome = prepareEncryptedDocumentChanges(
        uid, ops, remote, stableFrontier, writer, accountKey,
    );
    if (!isCurrent()) throw new CloudReplicaStaleSnapshotError();
    if (outcome.sealedDocuments.size !== paths.length) {
        throw new CloudCiphertextError();
    }
    const batch: CloudReplicaBatch = {
        batchId,
        expectedRevision: snapshot.revision,
        expectedFenceEpoch: snapshot.fenceEpoch,
        consentRevision,
        replica,
        lastSeq,
        documents: [...outcome.sealedDocuments].map(([path, document]) => ({ path, document })),
    };
    return { batch, outcome };
}
