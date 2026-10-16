import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { UserDataSchema } from '../schema';
import { checkDocSize } from '../checkDocSize';
import { removeUndefinedValues } from '../utils/object';
import { normalizeCloudDocument, withCurrentDataSchema } from '../schemaEvolution';
import { rootDocument, type DocumentData } from './documentProjection';
import type { UserData } from '../../types';
import { assertHistoryMonthDocument, assertNutritionMonthDocument } from './monthlyIntegrity';
import { type SemanticOperation, type SyncMeta, applySemanticOperations, parseSyncMeta } from './semanticProjection';
import { getVerifiedHealthConsentRevision } from '../healthConsent';
import { compactSyncMetas } from './causalCompaction';
import {
    ReplicaFencedError,
    advanceReplicaControl,
    matchesReplica,
    parseReplicaControl,
    stableFrontierFromControl,
    type ReplicaIdentity,
} from './replicaProtocol';
import { distinctDocumentCount, MAX_SYNC_DOCUMENTS_PER_TRANSACTION } from './syncBatching';
import { assertCloudBusinessPreserved } from './cloudBusinessIntegrity';
export { CloudDataIntegrityError } from './cloudBusinessIntegrity';

function normalizeRemote(path: string, raw: DocumentData): DocumentData {
    if (path === '') return rootDocument(UserDataSchema.parse(raw) as unknown as UserData);
    if (path.startsWith('history_months/')) {
        const month = path.split('/')[1];
        assertHistoryMonthDocument(month, raw);
        const parsed = UserDataSchema.parse({ history: Object.values(raw) }) as unknown as UserData;
        return Object.fromEntries(Object.keys(raw).map((key, index) => [key, (parsed.history ?? [])[index]]));
    }
    const month = path.split('/')[1];
    assertNutritionMonthDocument(month, raw);
    const parsed = UserDataSchema.parse({ nutrition: raw }) as unknown as UserData;
    return parsed.nutrition as unknown as DocumentData;
}

export interface TransactionOutcome { documents: Map<string, DocumentData>; syncMeta: Record<string, SyncMeta> }

export async function applyDocumentChanges(
    db: Firestore,
    uid: string,
    ops: SemanticOperation[],
    isCurrent: () => boolean,
    replica: ReplicaIdentity,
): Promise<TransactionOutcome> {
    if (!uid || uid.includes('/')) throw new Error('Identità non valida');
    if (!isCurrent()) throw new Error('Sessione cambiata');
    if (!ops.length) return { documents: new Map(), syncMeta: {} };
    const documentCount = distinctDocumentCount(ops);
    if (documentCount > MAX_SYNC_DOCUMENTS_PER_TRANSACTION) {
        throw new Error(`Transazione sync troppo grande: ${documentCount} documenti, massimo ${MAX_SYNC_DOCUMENTS_PER_TRANSACTION}.`);
    }

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

        const baseDocs = new Map<string, DocumentData>();
        const remoteSyncMetas: Record<string, SyncMeta> = {};

        pathsToRead.forEach((path, index) => {
            const snapshot = snapshots[index];
            if (!snapshot.exists()) {
                baseDocs.set(path, {});
                return;
            }

            const normalized = normalizeCloudDocument(snapshot.data(), `Firestore ${path || 'root'} data schema`);
            remoteSyncMetas[path] = parseSyncMeta(normalized.sync);

            const remote = removeUndefinedValues(normalizeRemote(path, normalized.business));
            assertCloudBusinessPreserved(path, normalized.business, remote);
            baseDocs.set(path, remote);
        });

        const { documents: newDocs, syncMetas: mergedSyncMetas } = applySemanticOperations(baseDocs, ops, remoteSyncMetas);
        const compactedSyncMetas = compactSyncMetas(mergedSyncMetas, stableFrontier);
        const deliveredSeq = ops.reduce((max, operation) => Math.max(max, operation.seq), replicaEntry!.lastSeq);
        const writer = { slot: replica.slot, replicaId: replica.replicaId, generation: replica.generation, seq: deliveredSeq,
            ...(consentRevision > 0 ? { consentRevision } : {}) };
        const newSyncMetas: Record<string, SyncMeta> = Object.fromEntries(
            Object.entries(compactedSyncMetas).map(([path, meta]) => [path, { ...meta, writer }]),
        );

        for (const [path, docData] of newDocs.entries()) {
            let business = removeUndefinedValues(docData) as DocumentData;

            // Migration/normalization always happens before semantic merge; Zod validates the current business schema afterwards.
            business = removeUndefinedValues(normalizeRemote(path, business)) as DocumentData;

            const meta = newSyncMetas[path];
            const finalData = withCurrentDataSchema(business, meta) as DocumentData;

            checkDocSize(finalData, path || 'User Profile');

            const refIndex = pathsToRead.indexOf(path);

            // Protocol 3 never physically deletes sync-owned documents from the client.
            // Even after stable-frontier GC removes the final tombstone, the empty shell
            // carries the fenced writer identity. This prevents a stale generation from
            // turning an un-attributed Firestore delete into a causal state transition.
            transaction.set(refs[refIndex], finalData);
        }

        transaction.set(controlRef, advanceReplicaControl(control, replica, deliveredSeq));

        return { documents: newDocs, syncMeta: newSyncMetas };
    }, { maxAttempts: 5 });
}
