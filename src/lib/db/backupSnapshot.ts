import { collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, orderBy, query, startAfter, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getDb, ensureAppCheck } from '../firebase';
import { captureSession, isCurrentSession } from '../sync/session';
import { readLocal } from '../sync/localRepository';
import { getCachedCatalog } from '../catalog/catalogService';
import { applyRemoteDocuments, projectDocuments, type DocumentData } from '../sync/documentProjection';
import { applySemanticOperations, parseSyncMeta, type SyncMeta } from '../sync/semanticProjection';
import { normalizeCloudDocument } from '../schemaEvolution';
import { UserDataSchema } from '../schema';
import { withTimeout } from './db_core';
import type { UserData } from '../../types';
import type { BackupCoverage } from '../backup';

export async function collectBackupSnapshot(fallback: UserData, includeCloud: boolean) {
    const session = captureSession();
    const assertCurrent = () => { if (!isCurrentSession(session)) throw new Error('Sessione cambiata durante il backup.'); };
    const coverage: BackupCoverage = { scope: 'device', months: [] };
    const documents = new Map<string, DocumentData>();
    const businessDocuments = new Map<string, DocumentData>();
    const syncMetaByDocument: Record<string, SyncMeta> = {};

    const addRawDoc = (path: string, raw: unknown) => {
        documents.set(path, structuredClone((raw ?? {}) as DocumentData));
        const normalized = normalizeCloudDocument(raw ?? {}, `Backup ${path || 'root'} data schema`);
        businessDocuments.set(path, normalized.business);
        if (normalized.sync !== undefined) {
            try {
                syncMetaByDocument[path] = parseSyncMeta(normalized.sync);
            } catch (error) {
                throw new Error(`Metadati _sync non validi nel backup per ${path || 'root'}`, { cause: error });
            }
        }
    };

    let cloud: UserData | undefined;
    if (includeCloud && session.owner !== 'guest') {
        coverage.readStartedAt = new Date().toISOString();
        await ensureAppCheck();
        assertCurrent();
        const db = getDb();
        const uid = session.owner.slice(5);
        const root = await withTimeout(getDocFromServer(doc(db, 'users', uid)), 10000, 'Cloud non disponibile per il backup completo.');
        assertCurrent();
        addRawDoc('', root.exists() ? root.data() : {});
        for (const name of ['history_months', 'nutrition_months']) {
            let cursor: QueryDocumentSnapshot | undefined;
            do {
                const constraints = [orderBy(documentId()), limit(50)];
                const page = await withTimeout(getDocsFromServer(query(collection(db, 'users', uid, name), ...constraints, ...(cursor ? [startAfter(cursor)] : []))), 10000, 'Lettura dello storico interrotta.');
                assertCurrent();
                for (const item of page.docs) addRawDoc(name + '/' + item.id, item.data());
                cursor = page.size === 50 ? page.docs[page.docs.length - 1] : undefined;
            } while (cursor);
        }
        const catalog = await getCachedCatalog();
        assertCurrent();
        cloud = applyRemoteDocuments(UserDataSchema.parse({}) as unknown as UserData, businessDocuments, catalog);
        coverage.scope = 'cloud-and-device';
        coverage.months = [...new Set([...documents.keys()].filter(Boolean).map(path => path.split('/')[1]))].sort();
        coverage.readCompletedAt = new Date().toISOString();
    }
    // Capture the latest durable revision after the network scan, including edits
    // made during pagination. Cross-document reads are not a point-in-time snapshot.
    const envelope = await readLocal(session.owner);
    assertCurrent();
    const local = envelope?.data ?? fallback;
    let mergedValue = local;
    if (cloud) {
        if (envelope?.pending?.length) {
            const catalog = await getCachedCatalog();
            const baseDocs = projectDocuments(cloud, catalog);
            const { documents: mergedDocs } = applySemanticOperations(baseDocs, envelope.pending, syncMetaByDocument);
            mergedValue = applyRemoteDocuments(cloud, mergedDocs, catalog);
            // Preserve specific pending conflicts like nutritionPlanning from local
            mergedValue.pendingConflicts = local.pendingConflicts;
        } else {
            mergedValue = cloud;
            mergedValue.pendingConflicts = local.pendingConflicts;
        }
    }

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
    return { owner: session.owner, data: UserDataSchema.parse(mergedValue) as unknown as UserData, coverage,
        recovery: { envelope, device, cloudDocuments: Object.fromEntries(documents) } };
}
