import { randomBytes } from 'node:crypto';
import { adminDb } from '../accountDeletion/firebaseAdmin.js';
import { readHealthConsentState } from '../healthConsent/withdrawal.js';
import { AccountKeyUnavailableError, unwrapAccountDataKey, wrapAccountDataKey } from './accountKeyEnvelope.js';

const KEY_COLLECTION = 'user_data_keys';

export class CloudKeyProvisioningConflictError extends Error {
  constructor() {
    super('Esistono dati cloud senza la relativa chiave account: sincronizzazione sospesa e dati preservati.');
    this.name = 'CloudKeyProvisioningConflictError';
  }
}

function validIdentity(uid: string): void {
  if (!uid || uid.length > 128 || uid.includes('/')) throw new AccountKeyUnavailableError();
}

function trustedConsent(data: FirebaseFirestore.DocumentData | undefined, uid: string, purpose: 'sync' | 'rights-export'): boolean {
  return data?.uid === uid && data.status === (purpose === 'sync' ? 'active' : 'withdrawn')
    && Number.isSafeInteger(data.revision) && data.revision > 0
    && (purpose === 'rights-export' || (typeof data.acceptedAt === 'string'
      && typeof data.privacyVersion === 'string' && data.privacyVersion.length > 0
      && typeof data.termsVersion === 'string' && data.termsVersion.length > 0));
}

/**
 * The existing consent/deletion transactions write the same documents we
 * read here. Firestore retries this transaction when a revocation races key
 * provisioning; a revoked account never silently creates a new key.
 */
export async function releaseAccountDataKey(uid: string, purpose: 'sync' | 'rights-export' = 'sync'): Promise<Buffer> {
  validIdentity(uid);
  const db = adminDb();
  const keyRef = db.collection(KEY_COLLECTION).doc(uid);
  const consentRef = db.collection('health_consent_withdrawals').doc(uid);
  const deletionRef = db.collection('account_deletions').doc(uid);
  const erasureRef = db.collection('health_data_erasures').doc(uid);
  const root = db.collection('users').doc(uid);

  // Normal unlock reads the existing wrapped ADK, without deriving another
  // account key. The versioned server-only KEK must stay available for as
  // long as any account envelope was encrypted under it.
  const [existingKey, preflightConsent, preflightDeletion, preflightErasure] = await Promise.all([
    keyRef.get(), consentRef.get(), deletionRef.get(), erasureRef.get(),
  ]);
  // Avoid unnecessary key generation for withdrawn, unregistered or
  // deleting accounts. The transaction below MUST still recheck these same
  // documents to fence any concurrent revocation/erasure after preflight.
  if (!trustedConsent(preflightConsent.data(), uid, purpose)
      || preflightDeletion.exists
      || (preflightErasure.exists && preflightErasure.data()?.status !== 'complete')) {
    throw new AccountKeyUnavailableError();
  }
  let wrappedCandidate: Awaited<ReturnType<typeof wrapAccountDataKey>> | null = null;
  if (!existingKey.exists && purpose === 'sync') {
    // Secret-dependent operations MUST stay outside the Firestore retry callback.
    // A race loser discards its candidate and uses the persisted winner.
    const candidate = randomBytes(32);
    try {
      wrappedCandidate = await wrapAccountDataKey(uid, candidate);
    } finally {
      candidate.fill(0);
    }
  }

  const selected = await db.runTransaction(async transaction => {
    const [stored, consent, deletion, erasure] = await Promise.all([
      transaction.get(keyRef), transaction.get(consentRef), transaction.get(deletionRef),
      transaction.get(erasureRef),
    ]);
    if (!trustedConsent(consent.data(), uid, purpose) || deletion.exists
        || (erasure.exists && erasure.data()?.status !== 'complete')) throw new AccountKeyUnavailableError();
    if (stored.exists) {
      const data = stored.data();
      if (!data || data.uid !== uid || data.format !== 'thelogbook-wrapped-account-key'
          || data.version !== 1 || data.keyVersion !== 1
          || typeof data.ciphertext !== 'string' || typeof data.iv !== 'string'
          || typeof data.tag !== 'string') {
        throw new AccountKeyUnavailableError();
      }
      return data;
    }
    // Rights-only access NEVER provisions keys: withdrawal may export existing
    // ciphertext, but cannot create fresh cloud storage or re-enable sync.
    if (purpose === 'rights-export') throw new AccountKeyUnavailableError();
    // This is NOT a migration: if any existing cloud business state is
    // present, creating a new key would make it appear that an existing
    // plaintext/ciphertext archive belonged to the newly generated ADK.
    const [rootSnap, controlSnap, history, nutrition] = await Promise.all([
      transaction.get(root),
      transaction.get(root.collection('sync_control').doc('state')),
      transaction.get(root.collection('history_months').limit(1)),
      transaction.get(root.collection('nutrition_months').limit(1)),
    ]);
    if (rootSnap.exists || controlSnap.exists || !history.empty || !nutrition.empty) {
      throw new CloudKeyProvisioningConflictError();
    }
    if (!wrappedCandidate) throw new AccountKeyUnavailableError();
    transaction.create(keyRef, wrappedCandidate);
    return wrappedCandidate;
  });

  const key = await unwrapAccountDataKey(uid, selected);
  try {
    // An admin action can revoke an account after the transaction finishes.
    // Recheck immediately before releasing bytes; the browser must still
    // enforce session+consent fences on subsequent cloud operations.
    const [consent, deletion, erasure] = await Promise.all([
      readHealthConsentState(uid),
      deletionRef.get(),
      erasureRef.get(),
    ]);
    if (consent.status !== (purpose === 'sync' ? 'active' : 'withdrawn') || deletion.exists
        || (erasure.exists && erasure.data()?.status !== 'complete')) throw new AccountKeyUnavailableError();
    return key;
  } catch {
    key.fill(0);
    throw new AccountKeyUnavailableError();
  }
}
