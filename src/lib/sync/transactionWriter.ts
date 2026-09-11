import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import equal from 'fast-deep-equal';
import { UserDataSchema } from '../schema';
import { checkDocSize } from '../checkDocSize';
import { removeUndefinedValues } from '../utils/object';
import { reconcile, type DataConflict } from './reconcile';
import { rootDocument, type DocumentChange, type DocumentData } from './documentProjection';
import type { UserData } from '../../types';

function normalizeRemote(path: string, raw: DocumentData): DocumentData {
    if (path === '') return rootDocument(UserDataSchema.parse(raw) as unknown as UserData);
    if (path.startsWith('history_months/')) {
        const parsed = UserDataSchema.parse({ history: Object.values(raw) }) as unknown as UserData;
        return Object.fromEntries(Object.keys(raw).map((key, index) => [key, (parsed.history ?? [])[index]]));
    }
    const parsed = UserDataSchema.parse({ nutrition: raw }) as unknown as UserData;
    return parsed.nutrition as unknown as DocumentData;
}

export interface TransactionOutcome { documents: Map<string, DocumentData>; conflicts: DataConflict[] }
/** Pure transaction callback: retries never mutate the store or the durable queue. */
export async function applyDocumentChanges(db: Firestore, uid: string, changes: DocumentChange[], isCurrent: () => boolean): Promise<TransactionOutcome> {
    if (!uid || uid.includes('/')) throw new Error('Identità non valida');
    if (changes.length > 400) throw new Error('Importazione troppo estesa per una transazione: dati conservati nel registro locale');
    if (!isCurrent()) throw new Error('Sessione cambiata');
    if (!changes.length) return { documents: new Map(), conflicts: [] };
    return runTransaction(db, async transaction => {
        if (!isCurrent()) throw new Error('Sessione cambiata');
        const refs = changes.map(change => doc(db, `users/${uid}${change.path ? '/' + change.path : ''}`));
        const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
        if (!isCurrent()) throw new Error('Sessione cambiata');
        const documents = new Map<string, DocumentData>();
        const conflicts: DataConflict[] = [];
        const writes: Array<{ index: number; data: DocumentData }> = [];
        changes.forEach((change, index) => {
            const raw = snapshots[index].exists() ? snapshots[index].data() : {};
            const remote = removeUndefinedValues(normalizeRemote(change.path, raw));
            const merged = reconcile(change.base, change.desired, remote, change.path ? change.path.split('/') : []);
            conflicts.push(...merged.conflicts);
            const data = removeUndefinedValues(merged.value) as DocumentData;
            checkDocSize(data, change.path || 'User Profile');
            documents.set(change.path, data);
            if (!equal(raw, data)) writes.push({ index, data });
        });
        // A collision blocks the whole operation; no independent sub-write is partially applied.
        if (conflicts.length) return { documents, conflicts };
        for (const { index, data } of writes) {
            if (changes[index].path && Object.keys(data).length === 0) transaction.delete(refs[index]);
            else transaction.set(refs[index], data);
        }
        return { documents, conflicts };
    }, { maxAttempts: 5 });
}
