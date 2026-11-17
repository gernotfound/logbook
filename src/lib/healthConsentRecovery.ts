import type { User } from 'firebase/auth';
import { getCachedCatalog } from './catalog/catalogService';
import { UserDataSchema } from './schema';
import type { UserData } from '../types';
import { captureSession, isCurrentSession } from './sync/session';
import { readLocal, rebaseConsentRecoveryWithExplicitChoice } from './sync/localRepository';
import { applyRemoteDocuments, type DocumentData } from './sync/documentProjection';
import { normalizeCloudDocument } from './schemaEvolution';
import { collectBackupSnapshot } from './db/backupSnapshot';
import { currentHealthConsentStatus, readActiveHealthConsentRevision, refreshHealthConsent, finishHealthConsentReacceptance } from './healthConsent';

/**
 * A deliberate second choice, after consent. Never silently deliver an old
 * journal. Merge happens against an exhaustive fresh cloud read, inside a
 * guarded single-key IndexedDB transaction, while the original is archived.
 */
export async function recoverOldLocalEditsAfterConsent(user: User): Promise<void> {
  const uid = user.uid;
  if (currentHealthConsentStatus(uid) !== 'recovery-required') {
    throw new Error('Nessun recupero di consenso richiesto.');
  }
  const session = captureSession();
  if (session.owner !== 'user:' + uid) throw new Error('Account cambiato.');
  const assertCurrent = () => {
    if (!isCurrentSession(session) || currentHealthConsentStatus(uid) !== 'recovery-required') {
      throw new Error('La sessione è cambiata durante il recupero.');
    }
  };
  const serverConsent = await readActiveHealthConsentRevision(user);
  assertCurrent();
  const original = await readLocal(session.owner);
  assertCurrent();
  if (!original?.pending.length) throw new Error('Non ci sono operazioni locali da recuperare.');
  if (serverConsent.erasedBeforeRevision !== undefined
    && (original.consentRevision ?? 0) <= serverConsent.erasedBeforeRevision) {
    // Never rebase a journal whose generation was explicitly erased. The
    // existing encrypted archive stays untouched for a voluntary JSON export.
    throw new Error('Queste modifiche appartengono a dati eliminati su richiesta. Non possono essere ripristinate tramite il recupero del consenso.');
  }
  // The backup collector retries its own scan if the local envelope changes.
  const snapshot = await collectBackupSnapshot(original.data, true);
  assertCurrent();
  if (snapshot.coverage.scope !== 'cloud-and-device' || !snapshot.recovery.cloudDocuments) {
    throw new Error('Per il recupero serve una lettura cloud completa.');
  }
  const cloudDocuments = new Map<string, DocumentData>(Object.entries(snapshot.recovery.cloudDocuments));
  const normalized = new Map<string, DocumentData>();
  for (const [path, raw] of cloudDocuments) {
    normalized.set(path, normalizeCloudDocument(raw, 'Recupero cloud ' + (path || 'root')).business);
  }
  const catalog = await getCachedCatalog();
  assertCurrent();
  const cloudData = applyRemoteDocuments(
    UserDataSchema.parse({}) as unknown as UserData, normalized, catalog,
  );
  // The cloud scan is not atomic with the trusted consent record. A different
  // device can erase data or change the consent epoch while pages are read.
  // Do not turn an earlier journal into fresh edits using that stale proof.
  const latestConsent = await readActiveHealthConsentRevision(user);
  assertCurrent();
  if (latestConsent.erasedBeforeRevision !== undefined
    && (original.consentRevision ?? 0) <= latestConsent.erasedBeforeRevision) {
    throw new Error('Queste modifiche appartengono a dati eliminati su richiesta. Non possono essere ripristinate tramite il recupero del consenso.');
  }
  if (latestConsent.revision !== serverConsent.revision
    || latestConsent.erasedBeforeRevision !== serverConsent.erasedBeforeRevision) {
    throw new Error('Il consenso sul server è cambiato durante il recupero. Riprova dopo una nuova verifica.');
  }
  await rebaseConsentRecoveryWithExplicitChoice(
    session.owner, serverConsent.revision,
    original.revision, cloudData, snapshot.data, cloudDocuments, () => { assertCurrent(); return true; },
  );
  // A server refresh authoritatively confirms the revision and unlocks only
  // after local data and the original journal are durably committed.
  const status = await refreshHealthConsent(user);
  // refreshHealthConsent may legitimately update the consent marker captured
  // above. Keep the identity/epoch fence without comparing that old marker.
  const currentSession = captureSession();
  if (currentSession.owner !== session.owner || currentSession.epoch !== session.epoch) {
    throw new Error('La sessione è cambiata durante il recupero.');
  }
  if (status !== 'active') throw new Error('Recupero salvato, ma consenso non ancora verificato. Riprova.');
  finishHealthConsentReacceptance(uid);
}
