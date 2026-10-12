import type { User } from 'firebase/auth';
import { getCachedCatalog } from './catalog/catalogService';
import { UserDataSchema } from './schema';
import type { UserData } from '../types';
import { captureSession, isCurrentSession } from './sync/session';
import { readLocal, rebaseConsentRecoveryWithExplicitChoice } from './sync/localRepository';
import { applyRemoteDocuments, type DocumentData } from './sync/documentProjection';
import { normalizeCloudDocument } from './schemaEvolution';
import { collectBackupSnapshot } from './db/backupSnapshot';
import { currentHealthConsentStatus, refreshHealthConsent, finishHealthConsentReacceptance } from './healthConsent';

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
  const original = await readLocal(session.owner);
  assertCurrent();
  if (!original?.pending.length) throw new Error('Non ci sono operazioni locali da recuperare.');
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
  await rebaseConsentRecoveryWithExplicitChoice(
    session.owner, original.consentRevision === undefined ? 0 : original.consentRevision + 1,
    original.revision, cloudData, snapshot.data, cloudDocuments, assertCurrent,
  );
  // A server refresh authoritatively confirms the revision and unlocks only
  // after local data and the original journal are durably committed.
  const status = await refreshHealthConsent(user);
  if (status !== 'active') throw new Error('Recupero salvato, ma consenso non ancora verificato. Riprova.');
  finishHealthConsentReacceptance(uid);
}
