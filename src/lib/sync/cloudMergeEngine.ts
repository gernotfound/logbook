import { UserDataSchema } from '../schema';
import { removeUndefinedValuesForFirestore } from '../utils/object';
import { rootDocument, type DocumentData } from './documentProjection';
import type { UserData } from '../../types';
import { assertHistoryMonthDocument, assertNutritionMonthDocument } from './monthlyIntegrity';
import { type SemanticOperation, type SyncMeta, applySemanticOperations, parseSyncMeta } from './semanticProjection';
import type { ReplicaWriter, VectorClock } from './semanticProjection/contracts';
import { compactSyncMetas } from './causalCompaction';
import { assertCloudBusinessPreserved } from './cloudBusinessIntegrity';
import { CloudCiphertextError, sealCloudDocument, type SealedCloudDocument } from './cloudDocumentCipher';
import { readAccountCloudDocument } from './cloudDocumentRead';

function normalizeRemote(path: string, raw: DocumentData): DocumentData {
    if (path === '') {
        const root = rootDocument(UserDataSchema.parse(raw) as unknown as UserData);
        // A missing plan must not be promoted to a synthetic nested plan on retry.
        if (raw.nutritionPlanning === null || raw.nutritionPlanning === undefined) root.nutritionPlanning = null;
        return root;
    }
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

export interface PreparedEncryptedDocumentChanges {
    documents: Map<string, DocumentData>;
    syncMeta: Record<string, SyncMeta>;
    sealedDocuments: Map<string, SealedCloudDocument>;
}

/**
 * Single semantic/cipher boundary for Firestore and the isolated D1 candidate.
 * The caller must verify the account session, replica, consent and stable
 * frontier from its own trusted control snapshot BEFORE invoking this function.
 * No network/IndexedDB access or journal ACK is performed here.
 */
export function prepareEncryptedDocumentChanges(
    uid: string,
    operations: SemanticOperation[],
    remoteEnvelopes: ReadonlyMap<string, unknown>,
    stableFrontier: VectorClock,
    writer: ReplicaWriter,
    accountKey: Uint8Array,
): PreparedEncryptedDocumentChanges {
    if (!(accountKey instanceof Uint8Array) || accountKey.length !== 32) throw new CloudCiphertextError();
    if (!uid || uid.includes('/')) throw new CloudCiphertextError();

    const paths = [...new Set(operations.map(operation => operation.docPath))];
    const baseDocs = new Map<string, DocumentData>();
    const remoteMetas: Record<string, SyncMeta> = {};
    for (const path of paths) {
        if (!remoteEnvelopes.has(path)) {
            baseDocs.set(path, {});
            continue;
        }
        const normalized = readAccountCloudDocument(
            remoteEnvelopes.get(path), 'Cloud document data schema', uid, path, accountKey,
        );
        remoteMetas[path] = parseSyncMeta(normalized.sync);
        const remote = removeUndefinedValuesForFirestore(normalizeRemote(path, normalized.business));
        assertCloudBusinessPreserved(path, normalized.business, remote);
        baseDocs.set(path, remote);
    }
    const { documents: merged, syncMetas } = applySemanticOperations(baseDocs, operations, remoteMetas);
    const compacted = compactSyncMetas(syncMetas, stableFrontier);
    const syncMeta: Record<string, SyncMeta> = Object.fromEntries(
        Object.entries(compacted).map(([path, meta]) => [path, { ...meta, writer }]),
    );

    const documents = new Map<string, DocumentData>();
    const sealedDocuments = new Map<string, SealedCloudDocument>();
    for (const [path, docData] of merged.entries()) {
        const business = removeUndefinedValuesForFirestore(normalizeRemote(path, docData)) as DocumentData;
        // Tolerant normalization may not silently discard authenticated fields.
        assertCloudBusinessPreserved(path, docData, business);
        documents.set(path, business);
        sealedDocuments.set(path, sealCloudDocument(accountKey, uid, path, business, syncMeta[path]));
    }
    return { documents, syncMeta, sealedDocuments };
}
