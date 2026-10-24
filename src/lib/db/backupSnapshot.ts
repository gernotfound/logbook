import { collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, orderBy, query, startAfter, type QueryDocumentSnapshot } from 'firebase/firestore';
import { auth, getDb, ensureAppCheck } from '../firebase';
import { captureSession, isCurrentSession } from '../sync/session';
import { readLocal } from '../sync/localRepository';
import { readDeviceValueStrict } from '../sync/deviceStorage';
import { stableStorageKeyInventory } from '../sync/stableStorageKeyInventory';
import { getCachedCatalog } from '../catalog/catalogService';
import { applyRemoteDocuments, projectDocuments, type DocumentData } from '../sync/documentProjection';
import { applySemanticOperations, coversVectorClock, parseSyncMeta, type SyncMeta } from '../sync/semanticProjection';
import { readAccountCloudDocument } from '../sync/cloudDocumentRead';
import { requireCloudAccountDataKey, requireRightsExportAccountDataKey } from '../sync/cloudAccountKeyAccess';

import { UserDataSchema } from '../schema';
import { withTimeout } from './db_core';
import type { UserData } from '../../types';
import type { BackupCoverage } from '../backup';
import equal from 'fast-deep-equal';
import { sameCloudControlState } from '../sync/cloudReadConsistency';
import { currentHealthConsentStatus, hasUnreconciledOfflineReaccept, readHealthConsentServerStatus } from '../healthConsent';
import { fetchWithdrawnCloudBackup } from './withdrawnBackupTransport';
import { requireCompleteHistoryMonthDocument, requireCompleteNutritionMonthDocument } from '../sync/monthlyIntegrity';

const RECOVERY_DEVICE_KEYS = new Set([
    'workout', 'timer', 'draft_exercise', 'draft_routine', 'history-editor-context',
]);
const isRecoveryDeviceKey = (name: string) =>
    RECOVERY_DEVICE_KEYS.has(name) || name.startsWith('draft:')
    || /^workout-intent:[a-f0-9]{32}$/.test(name);

// Private write-ahead witnesses and suspended editor context are included as
// raw recovery evidence only. Import never replays them as a causal journal.
function deviceRecoveryName(key: string | null, owner: string): string | null {
    const prefix = 'logbook:v2:' + owner + ':';
    if (!key?.startsWith(prefix)) return null;
    const raw = key.slice(prefix.length);
    const name = raw.startsWith('sealed:') ? raw.slice('sealed:'.length) : raw;
    return isRecoveryDeviceKey(name) ? name : null;
}

/**
 * The backup is a user-visible claim that every device recovery witness was
 * included. Scanning localStorage by a live numeric index can skip keys when
 * another tab adds/removes one, even though each individual read succeeds.
 *
 * Capture names first; validate exact physical membership and decoded values
 * after the copy. This detects observable races without claiming a
 * transactional snapshot across browser realms.
 */
function readStableDeviceRecovery(owner: string): Record<string, string> {
    const physicalKeys = (): Set<string> => {
        const inventory = stableStorageKeyInventory('Le copie di recupero sono cambiate durante il backup. Riprova senza chiudere altre schede.');
        return new Set([...inventory].filter(key => deviceRecoveryName(key, owner) !== null));
    };
    const before = physicalKeys();
    const device: Record<string, string> = {};
    for (const physicalKey of before) {
        const name = deviceRecoveryName(physicalKey, owner)!;
        // Strict read validates owner, vault state, ciphertext and purge
        // fences; a vanished key cannot silently become an omitted witness.
        const value = readDeviceValueStrict(name, owner);
        if (value === null || Object.hasOwn(device, name)) {
            throw new Error('Le copie di recupero sono cambiate durante il backup. Riprova senza chiudere altre schede.');
        }
        device[name] = value;
    }
    const after = physicalKeys();
    if (after.size !== before.size || [...before].some(key => !after.has(key))) {
        throw new Error('Le copie di recupero sono cambiate durante il backup. Riprova senza chiudere altre schede.');
    }
    for (const physicalKey of before) {
        const name = deviceRecoveryName(physicalKey, owner)!;
        if (readDeviceValueStrict(name, owner) !== device[name]) {
            throw new Error('I valori di recupero sono cambiati durante il backup. Riprova senza chiudere altre schede.');
        }
    }
    return device;
}

export function hasDeviceRecoveryBackupSource(owner: string): boolean {
    // The existence preflight must be as race-aware as the export itself.
    // A shifting localStorage index must not hide the only recovery witness.
    return Object.keys(readStableDeviceRecovery(owner)).length > 0;
}

export async function collectBackupSnapshot(fallback: UserData, includeCloud: boolean, consistencyAttempt = 0, accountKey?: Uint8Array) {
    const session = captureSession();
    const assertCurrent = () => { if (!isCurrentSession(session)) throw new Error('Sessione cambiata durante il backup.'); };
    const coverage: BackupCoverage = { scope: 'device', months: [] };
    let effectiveCloudKey = accountKey;
    const documents = new Map<string, DocumentData>();
    const businessDocuments = new Map<string, DocumentData>();
    const syncMetaByDocument: Record<string, SyncMeta> = {};
    const localBaseline = includeCloud ? await readLocal(session.owner) : undefined;
    assertCurrent();

    const addRawDoc = (path: string, raw: unknown) => {
        const normalized = readAccountCloudDocument(raw ?? {}, `Backup ${path || 'root'} data schema`, session.owner.slice(5), path, effectiveCloudKey);
        // Explicit exported recovery remains readable JSON by user choice;
        // no encrypted envelope is stored in the human-readable backup.
        documents.set(path, structuredClone({ ...normalized.business, _schemaVersion: normalized.dataSchemaVersion, _sync: normalized.sync }));
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
            // The Admin export deliberately transports ciphertext only.
            // Decryption happens after the authenticated, revision-bracketed
            // scan, solely in the owner's browser. The rights-specific key
            // endpoint permits *existing* ADK retrieval while withdrawn but
            // never provisions a new key or re-enables cloud writes.
            effectiveCloudKey = await requireRightsExportAccountDataKey(uid, assertCurrent);
            assertCurrent();
            const withdrawnDocuments = await fetchWithdrawnCloudBackup(uid, assertCurrent);
            for (const [path, raw] of withdrawnDocuments) { assertCurrent(); addRawDoc(path, raw); }
        } else {
            effectiveCloudKey = await requireCloudAccountDataKey(uid, assertCurrent);
            assertCurrent();
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
            if (!sameCloudControlState(beforeControl, afterControl)) {
                if (consistencyAttempt === 0) return collectBackupSnapshot(fallback, includeCloud, 1, accountKey);
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
            return collectBackupSnapshot(fallback, includeCloud, 1, accountKey);
        }
        throw new Error('I dati locali sono cambiati durante il backup. Riprova quando le modifiche sono stabili.');
    }
    const local = envelope?.data ?? fallback;
    if (cloud && envelope) {
        if (envelope.cloudIntegrityFence) {
            throw new Error('Backup cloud sospeso: divergenza con la copia locale ancora da verificare. Esporta la copia del dispositivo.');
        }
        for (const [path, durableMeta] of Object.entries(envelope.syncMetaByDocument)) {
            const observed = syncMetaByDocument[path];
            if (!observed || !coversVectorClock(observed.clock, durableMeta.clock)) {
                throw new Error('Backup cloud incompleto rispetto ai dati confermati sul dispositivo. Esporta la copia locale.');
            }
        }
    }
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
    // Recovery payloads contain plaintext only in the EXPLICIT backup.
    // A resurfaced old-tab key or cross-tab edit must fail closed rather
    // than disappear silently from an otherwise successful export.
    const device = readStableDeviceRecovery(session.owner);
    assertCurrent();
    return { owner: session.owner, data: UserDataSchema.parse(mergedValue) as unknown as UserData, coverage,
        recovery: { envelope, device, cloudDocuments: Object.fromEntries(documents) } };
}
