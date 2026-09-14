import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { UserDataSchema } from '../schema';
import { checkDocSize } from '../checkDocSize';
import { removeUndefinedValues } from '../utils/object';
import { normalizeCloudDocument, withCurrentDataSchema } from '../schemaEvolution';
import { rootDocument, type DocumentData } from './documentProjection';
import type { UserData } from '../../types';
import { type SemanticOperation, type SyncMeta, applySemanticOperations, parseSyncMeta } from './semanticProjection';
import { compactSyncMetas } from './causalCompaction';

function normalizeRemote(path: string, raw: DocumentData): DocumentData {
    if (path === '') return rootDocument(UserDataSchema.parse(raw) as unknown as UserData);
    if (path.startsWith('history_months/')) {
        const parsed = UserDataSchema.parse({ history: Object.values(raw) }) as unknown as UserData;
        return Object.fromEntries(Object.keys(raw).map((key, index) => [key, (parsed.history ?? [])[index]]));
    }
    const parsed = UserDataSchema.parse({ nutrition: raw }) as unknown as UserData;
    return parsed.nutrition as unknown as DocumentData;
}

export interface TransactionOutcome { documents: Map<string, DocumentData>; syncMeta: Record<string, SyncMeta> }

export async function applyDocumentChanges(db: Firestore, uid: string, ops: SemanticOperation[], isCurrent: () => boolean): Promise<TransactionOutcome> {
    if (!uid || uid.includes('/')) throw new Error('Identità non valida');
    if (!isCurrent()) throw new Error('Sessione cambiata');
    if (!ops.length) return { documents: new Map(), syncMeta: {} };

    return runTransaction(db, async transaction => {
        if (!isCurrent()) throw new Error('Sessione cambiata');

        const pathsToRead = [...new Set(ops.map(op => op.docPath))];
        const refs = pathsToRead.map(path => doc(db, `users/${uid}${path ? '/' + path : ''}`));
        const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));

        if (!isCurrent()) throw new Error('Sessione cambiata');

        const baseDocs = new Map<string, DocumentData>();
        const remoteSyncMetas: Record<string, SyncMeta> = {};

        pathsToRead.forEach((path, index) => {
            const raw = snapshots[index].exists() ? snapshots[index].data() : {};
            const normalized = normalizeCloudDocument(raw, `Firestore ${path || 'root'} data schema`);

            if (normalized.sync !== undefined) {
                remoteSyncMetas[path] = parseSyncMeta(normalized.sync);
            }

            const remote = removeUndefinedValues(normalizeRemote(path, normalized.business));
            baseDocs.set(path, remote);
        });

        const { documents: newDocs, syncMetas: mergedSyncMetas } = applySemanticOperations(baseDocs, ops, remoteSyncMetas);
        const newSyncMetas = compactSyncMetas(mergedSyncMetas);

        for (const [path, docData] of newDocs.entries()) {
            let business = removeUndefinedValues(docData) as DocumentData;

            // Migration/normalization always happens before semantic merge; Zod validates the current business schema afterwards.
            business = removeUndefinedValues(normalizeRemote(path, business)) as DocumentData;

            const meta = newSyncMetas[path];
            const finalData = withCurrentDataSchema(business, meta) as DocumentData;

            checkDocSize(finalData, path || 'User Profile');

            const refIndex = pathsToRead.indexOf(path);
            const hasBusinessData = Object.keys(business).length > 0;
            const hasFields = Boolean(meta && Object.keys(meta.fields).length > 0);

            if (!hasBusinessData && !hasFields) {
                transaction.delete(refs[refIndex]);
            } else {
                transaction.set(refs[refIndex], finalData);
            }
        }

        return { documents: newDocs, syncMeta: newSyncMetas };
    }, { maxAttempts: 5 });
}
