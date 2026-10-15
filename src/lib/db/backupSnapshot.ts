import { collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, orderBy, query, startAfter, type QueryDocumentSnapshot } from 'firebase/firestore';
import { auth, getDb, ensureAppCheck } from '../firebase';
import { captureSession, isCurrentSession } from '../sync/session';
import { readLocal } from '../sync/localRepository';
import { readDeviceValueStrict } from '../sync/deviceStorage';
import { getCachedCatalog } from '../catalog/catalogService';
import { applyRemoteDocuments, projectDocuments, type DocumentData } from '../sync/documentProjection';
import { applySemanticOperations, parseSyncMeta, type SyncMeta } from '../sync/semanticProjection';
import { normalizeCloudDocument } from '../schemaEvolution';
import { UserDataSchema } from '../schema';
import { withTimeout } from './db_core';
import type { UserData } from '../../types';
import type { BackupCoverage } from '../backup';
import equal from 'fast-deep-equal';
import { currentHealthConsentStatus, hasUnreconciledOfflineReaccept, readHealthConsentServerStatus } from '../healthConsent';
import { fetchWithdrawnCloudBackup } from './withdrawnBackupTransport';
import { requireCompleteHistoryMonthDocument, requireCompleteNutritionMonthDocument } from '../sync/monthlyIntegrity';

const RECOVERY_DEVICE_KEYS = new Set(['workout', 'timer', 'draft_exercise', 'draft_routine']);
const isRecoveryDeviceKey = (name: string) => RECOVERY_DEVICE_KEYS.has(name) || name.startsWith('draft:');

export async function collectBackupSnapshot(fallback: UserData, includeCloud: boolean, consistencyAttempt = 0) {
    const session = captureSession();
    const assertCurrent = () => { if (!isCurrentSession(session)) throw new Error('Sessione cambiata durante il backup.'); };
    const coverage: BackupCoverage = { scope: 'device', months: [] };
    const documents = new Map<string, DocumentData>();
    const businessDocuments = new Map<string, DocumentData>();
    const syncMetaByDocument: Record<string, SyncMeta> = {};
    const localBaseline = includeCloud ? await readLocal(session.owner) : undefined;
    assertCurrent();

    const addRawDoc = (path: string, raw: unknown) => {
        documents.set(path, structuredClone((raw ?? {}) as DocumentData));
        const normalized = normalizeCloudDocument(raw ?? {}, `Backup ${path || 'root'} data schema`);
        const business = path.startsWith('history_months/')
            ? requireCompleteHistoryMonthDocument(path.slice('history_months/'.length), normalized.business)
            : path.startsWith('nutrition_months/')
                ? requireCompleteNutritionMonthDocument(path.slice('nutrition_months/'.length), normalized.business)
                : normalized.business;
        businessDocuments.set(path, business);
        try {
            syncMetaByDocument[path] = parseSyncMeta(normalized.sync);
        } catch (error) {
            throw new Error(`Metadati _sync non validi nel backup per ${path || 'root'}`, { cause: error });
        }
    };

    let cloud: UserData | undefined;
    if (includeCloud && session.owner !== 'guest') {
        // Explicit offline reacceptance does not authorize any cloud read.
        // Only the separate recovery-required path, following a confirmed
        // server reacceptance, may scan the cloud to rebase a stale journal.
        if (hasUnreconciledOfflineReaccept(session.owner.slice(5))
            && currentHealthConsentStatus(session.owner.slice(5)) !== 'recovery-required') {
            throw new Error('Consenso riattivato solo sul dispositivo: il backup cloud richiede la riconciliazione online. Esporta una copia locale.');
        }
        coverage.readStartedAt = new Date().toISOString();
        await ensureAppCheck();
        assertCurrent();
        const uid = session.owner.slice(5);
        let useTrustedExport = false;
        if (currentHealthConsentStatus(uid) !== 'active') {
            // The local suspended state may be behind another device. During
            // reacceptance the server can be either withdrawn OR active; only
            // the former is eligible for the dedicated Admin export endpoint.
            const user = auth.currentUser;
            if (!user || user.uid !== uid) throw new Error('Account cambiato durante esportazione.');
            useTrustedExport = await readHealthConsentServerStatus(user) === 'withdrawn';
            assertCurrent();
        }
        if (useTrustedExport) {
            // Rules deny direct reads while the server is withdrawn. Rights
            // export uses a separate authenticated, paginated Admin boundary.
            const withdrawnDocuments = await fetchWithdrawnCloudBackup(uid, assertCurrent);
            for (const [path, raw] of withdrawnDocuments) { assertCurrent(); addRawDoc(path, raw); }
        } else {
            const db = getDb();
            // Every supported client business transaction also advances the
            // replica control. Compare it around this non-atomic page scan so
            // that a concurrent device write cannot yield a mixed-state backup.
            const controlRef = doc(db, 'users', uid, 'sync_control', 'state');
            const beforeControl = await withTimeout(getDocFromServer(controlRef), 10000, 'Controllo versione cloud non disponibile.');
            assertCurrent();
            const root = await withTimeout(getDocFromServer(doc(db, 'users', uid)), 10000, 'Cloud non disponibile per il backup completo.');
            assertCurrent();
            if (root.exists()) addRawDoc('', root.data());
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
            const afterControl = await withTimeout(getDocFromServer(controlRef), 10000, 'Controllo versione cloud non disponibile.');
            assertCurrent();
            if (beforeControl.exists() !== afterControl.exists()
                || (beforeControl.exists() && !equal(beforeControl.data(), afterControl.data()))) {
                if (consistencyAttempt === 0) return collectBackupSnapshot(fallback, includeCloud, 1);
                throw new Error('Il cloud è cambiato durante il backup: non è possibile garantire una copia completa coerente. Riprova quando gli altri dispositivi sono inattivi.');
            }
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
    if (includeCloud && !equal(localBaseline, envelope)) {
        if (consistencyAttempt === 0) {
            return collectBackupSnapshot(fallback, includeCloud, 1);
        }
        throw new Error('I dati locali sono cambiati durante il backup. Riprova quando le modifiche sono stabili.');
    }
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
            const rawName = key.slice(prefix.length);
            const name = rawName.startsWith('sealed:') ? rawName.slice('sealed:'.length) : rawName;
            if (!isRecoveryDeviceKey(name)) continue;
            // Recovery payloads contain plaintext only in the EXPLICIT backup.
            // The archive itself remains sealed. A resurfaced old-tab legacy key
            // must fail the read rather than disappear from the backup silently.
            const value = readDeviceValueStrict(name, session.owner);
            if (value !== null) device[name] = value;
        }
    }
    assertCurrent();
    return { owner: session.owner, data: UserDataSchema.parse(mergedValue) as unknown as UserData, coverage,
        recovery: { envelope, device, cloudDocuments: Object.fromEntries(documents) } };
}
