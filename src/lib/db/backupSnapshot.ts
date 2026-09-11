import { collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, orderBy, query, startAfter, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getDb, ensureAppCheck } from '../firebase';
import { captureSession, isCurrentSession } from '../sync/session';
import { readLocal } from '../sync/localRepository';
import { getCachedCatalog } from '../catalog/catalogService';
import { applyRemoteDocuments, type DocumentData } from '../sync/documentProjection';
import { reconcile } from '../sync/reconcile';
import { UserDataSchema } from '../schema';
import { withTimeout } from './db_core';
import type { UserData } from '../../types';
import type { BackupCoverage } from '../backup';

export async function collectBackupSnapshot(fallback: UserData, includeCloud: boolean) {
    const session = captureSession();
    const assertCurrent = () => { if (!isCurrentSession(session)) throw new Error('Sessione cambiata durante il backup.'); };
    const coverage: BackupCoverage = { scope: 'device', months: [] };
    const documents = new Map<string, DocumentData>();
    let cloud: UserData | undefined;
    if (includeCloud && session.owner !== 'guest') {
        coverage.readStartedAt = new Date().toISOString();
        await ensureAppCheck();
        assertCurrent();
        const db = getDb();
        const uid = session.owner.slice(5);
        const root = await withTimeout(getDocFromServer(doc(db, 'users', uid)), 10000, 'Cloud non disponibile per il backup completo.');
        assertCurrent();
        documents.set('', root.exists() ? root.data() : {});
        for (const name of ['history_months', 'nutrition_months']) {
            let cursor: QueryDocumentSnapshot | undefined;
            do {
                const constraints = [orderBy(documentId()), limit(50)];
                const page = await withTimeout(getDocsFromServer(query(collection(db, 'users', uid, name), ...constraints, ...(cursor ? [startAfter(cursor)] : []))), 10000, 'Lettura dello storico interrotta.');
                assertCurrent();
                for (const item of page.docs) documents.set(name + '/' + item.id, item.data());
                cursor = page.size === 50 ? page.docs[page.docs.length - 1] : undefined;
            } while (cursor);
        }
        const catalog = await getCachedCatalog();
        assertCurrent();
        cloud = applyRemoteDocuments(UserDataSchema.parse({}) as unknown as UserData, documents, catalog);
        coverage.scope = 'cloud-and-device';
        coverage.months = [...new Set([...documents.keys()].filter(Boolean).map(path => path.split('/')[1]))].sort();
        coverage.readCompletedAt = new Date().toISOString();
    }
    // Capture the latest durable revision after the network scan, including edits
    // made during pagination. Cross-document reads are not a point-in-time snapshot.
    const envelope = await readLocal(session.owner);
    assertCurrent();
    const local = envelope?.data ?? fallback;
    const merged = cloud ? reconcile(envelope?.baseline ?? local, local, cloud) : { value: local, conflicts: [] };
    if (!includeCloud) coverage.months = envelope?.completeMonths ?? [];
    const device: Record<string, string> = {};
    const prefix = 'logbook:v2:' + session.owner + ':';
    for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith(prefix)) {
            const value = localStorage.getItem(key);
            if (value !== null) device[key.slice(prefix.length)] = value;
        }
    }
    assertCurrent();
    return { owner: session.owner, data: UserDataSchema.parse(merged.value) as unknown as UserData, coverage,
        recovery: { envelope, device, conflicts: merged.conflicts, cloudDocuments: Object.fromEntries(documents) } };
}
