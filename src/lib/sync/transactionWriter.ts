import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { generateId } from '../utils/date';
import type { DocumentData } from './documentProjection';
import type { SemanticOperation, SyncMeta } from './semanticProjection';
import { getVerifiedHealthConsentRevision } from '../healthConsent';
import {
    ReplicaFencedError,
    advanceReplicaControl,
    matchesReplica,
    parseReplicaControl,
    stableFrontierFromControl,
    type ReplicaIdentity,
} from './replicaProtocol';
import { distinctDocumentCount, MAX_SYNC_DOCUMENTS_PER_TRANSACTION } from './syncBatching';
import { CloudCiphertextError } from './cloudDocumentCipher';
import { prepareEncryptedDocumentChanges } from './cloudMergeEngine';
export { CloudDataIntegrityError } from './cloudBusinessIntegrity';

export interface TransactionOutcome { documents: Map<string, DocumentData>; syncMeta: Record<string, SyncMeta> }

export async function applyDocumentChanges(
    db: Firestore,
    uid: string,
    ops: SemanticOperation[],
    isCurrent: () => boolean,
    replica: ReplicaIdentity,
    cloudKey: Uint8Array,
): Promise<TransactionOutcome> {
    if (!(cloudKey instanceof Uint8Array) || cloudKey.length !== 32) throw new CloudCiphertextError();
    if (!uid || uid.includes('/')) throw new Error('Identità non valida');
    if (!isCurrent()) throw new Error('Sessione cambiata');
    if (!ops.length) return { documents: new Map(), syncMeta: {} };
    const documentCount = distinctDocumentCount(ops);
    if (documentCount > MAX_SYNC_DOCUMENTS_PER_TRANSACTION) {
        throw new Error(`Transazione sync troppo grande: ${documentCount} documenti, massimo ${MAX_SYNC_DOCUMENTS_PER_TRANSACTION}.`);
    }

    // Firestore may retry this callback. Preserve the batch identity and causal
    // semantics; discarded retries may use fresh AEAD nonces without affecting ACKs.
    const batchId = generateId('sync-advance');
    return runTransaction(db, async transaction => {
        if (!isCurrent()) throw new Error('Sessione cambiata');

        const pathsToRead = [...new Set(ops.map(op => op.docPath))];
        const refs = pathsToRead.map(path => doc(db, `users/${uid}${path ? '/' + path : ''}`));
        const controlRef = doc(db, `users/${uid}/sync_control/state`);
        const [controlSnapshot, ...snapshots] = await Promise.all([
            transaction.get(controlRef),
            ...refs.map(ref => transaction.get(ref)),
        ]);

        if (!isCurrent()) throw new Error('Sessione cambiata');
        if (!controlSnapshot.exists()) throw new ReplicaFencedError('Registro replica assente: checkpoint completo richiesto.');
        const control = parseReplicaControl(controlSnapshot.data());
        const consentRevision = getVerifiedHealthConsentRevision(uid);
        if ((control.consentRevision ?? 0) !== consentRevision) {
            throw new ReplicaFencedError('La replica appartiene a una generazione di consenso precedente.');
        }
        const replicaEntry = control.replicas[replica.slot];
        if (!matchesReplica(replicaEntry, replica)) throw new ReplicaFencedError();
        if (replicaEntry!.leaseUntilMs < Date.now()) throw new ReplicaFencedError('Lease replica scaduta: checkpoint completo richiesto.');
        if (ops.some(op => op.actorId !== replica.slot)) {
            throw new ReplicaFencedError('Il journal locale appartiene a una replica precedente e deve essere ribasato.');
        }
        const stableFrontier = stableFrontierFromControl(control);
        const deliveredSeq = ops.reduce((max, operation) => Math.max(max, operation.seq), replicaEntry!.lastSeq);
        const writer = { slot: replica.slot, replicaId: replica.replicaId,
            generation: replica.generation, seq: deliveredSeq,
            ...(consentRevision > 0 ? { consentRevision } : {}) };

        const remoteEnvelopes = new Map<string, unknown>();
        pathsToRead.forEach((path, index) => {
            if (snapshots[index].exists()) remoteEnvelopes.set(path, snapshots[index].data());
        });
        const staged = prepareEncryptedDocumentChanges(
            uid, ops, remoteEnvelopes, stableFrontier, writer, cloudKey,
        );

        // Preserve Protocol 3 empty-shell fencing: no physical client deletes.
        for (const [path, sealed] of staged.sealedDocuments.entries()) {
            transaction.set(refs[pathsToRead.indexOf(path)], sealed);
        }

        transaction.set(controlRef, advanceReplicaControl(control, replica, deliveredSeq, batchId));

        return { documents: staged.documents, syncMeta: staged.syncMeta };
    }, { maxAttempts: 5 });
}
