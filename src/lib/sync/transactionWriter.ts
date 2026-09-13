import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { UserDataSchema } from '../schema';
import { checkDocSize } from '../checkDocSize';
import { removeUndefinedValues } from '../utils/object';
import { rootDocument, type DocumentData } from './documentProjection';
import type { UserData } from '../../types';
import { type SemanticOperation, type VectorClock, applySemanticOperations } from './semanticProjection';

function normalizeRemote(path: string, raw: DocumentData): DocumentData {
    if (path === '') return rootDocument(UserDataSchema.parse(raw) as unknown as UserData);
    if (path.startsWith('history_months/')) {
        const parsed = UserDataSchema.parse({ history: Object.values(raw) }) as unknown as UserData;
        return Object.fromEntries(Object.keys(raw).map((key, index) => [key, (parsed.history ?? [])[index]]));
    }
    const parsed = UserDataSchema.parse({ nutrition: raw }) as unknown as UserData;
    return parsed.nutrition as unknown as DocumentData;
}

export interface TransactionOutcome { documents: Map<string, DocumentData>; syncMeta: Record<string, { clock: VectorClock }> }

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
        const oldRawDocs = new Map<string, DocumentData>();
        const remoteSyncMetas: Record<string, { clock: VectorClock }> = {};

        pathsToRead.forEach((path, index) => {
            const raw = snapshots[index].exists() ? snapshots[index].data() : {};
            oldRawDocs.set(path, raw);
            
            if (raw._sync) {
                remoteSyncMetas[path] = { clock: raw._sync.clock };
                delete raw._sync;
            }

            const remote = removeUndefinedValues(normalizeRemote(path, raw));
            baseDocs.set(path, remote);
        });

        const newDocs = applySemanticOperations(baseDocs, ops);
        const newSyncMetas: Record<string, { clock: VectorClock }> = {};

        for (const [path, docData] of newDocs.entries()) {
            const opsForDoc = ops.filter(op => op.docPath === path);
            if (!opsForDoc.length) continue;

            const oldClock = remoteSyncMetas[path]?.clock || {};
            const newClock = { ...oldClock };
            for (const op of opsForDoc) {
                for (const [actor, seq] of Object.entries(op.clock)) {
                    newClock[actor] = Math.max(newClock[actor] || 0, seq);
                }
            }
            newSyncMetas[path] = { clock: newClock };

            const data = removeUndefinedValues(docData) as DocumentData;
            data._sync = { clock: newClock };

            checkDocSize(data, path || 'User Profile');
            
            const refIndex = pathsToRead.indexOf(path);
            
            if (path && Object.keys(data).length === 1 && data._sync) {
                transaction.delete(refs[refIndex]);
            } else {
                transaction.set(refs[refIndex], data);
            }
        }

        return { documents: newDocs, syncMeta: newSyncMetas };
    }, { maxAttempts: 5 });
}
