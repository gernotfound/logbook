import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { UserDataSchema } from '../schema';
import { checkDocSize } from '../checkDocSize';
import { removeUndefinedValues } from '../utils/object';
import { rootDocument, type DocumentData } from './documentProjection';
import type { UserData } from '../../types';
import { type SemanticOperation, type SyncMeta, applySemanticOperations } from './semanticProjection';

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
            
            if (raw._sync) {
                remoteSyncMetas[path] = raw._sync as SyncMeta;
                delete raw._sync;
            }

            const remote = removeUndefinedValues(normalizeRemote(path, raw));
            baseDocs.set(path, remote);
        });

        const { documents: newDocs, syncMetas: newSyncMetas } = applySemanticOperations(baseDocs, ops, remoteSyncMetas);

        for (const [path, docData] of newDocs.entries()) {
            const data = removeUndefinedValues(docData) as DocumentData;
            const meta = newSyncMetas[path];
            if (meta) {
                data._sync = meta as any;
            }

            checkDocSize(data, path || 'User Profile');
            
            const refIndex = pathsToRead.indexOf(path);
            
            const hasBusinessData = Object.keys(data).filter(k => k !== '_sync').length > 0;
            const hasFields = meta && Object.keys(meta.fields).length > 0;

            if (!hasBusinessData && !hasFields) {
                transaction.delete(refs[refIndex]);
            } else {
                transaction.set(refs[refIndex], data);
            }
        }

        return { documents: newDocs, syncMeta: newSyncMetas };
    }, { maxAttempts: 5 });
}
