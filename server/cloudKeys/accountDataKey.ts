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

  // One fenced read-only transaction serves the common existing-key path.
  // A missing key takes the provisioning path below; secret wrapping remains
  // outside Firestore's retriable transaction callback.
  const readFencedKey = async (transaction: FirebaseFirestore.Transaction) => {
    const [stored, consent, deletion, erasure] = await Promise.all([
      transaction.get(keyRef), transaction.get(consentRef),
      transaction.get(deletionRef), transaction.get(erasureRef),
    ]);
    const consentData = consent.data();
    if (!trustedConsent(consentData, uid, purpose) || deletion.exists
        || (erasure.exists && erasure.data()?.status !== 'complete')) {
      throw new AccountKeyUnavailableError();
    }
    const consentRevision = consentData!.revision as number;
    if (!stored.exists) return { wrapped: null, consentRevision };

    const data = stored.data();
    if (!data || data.uid !== uid || data.format !== 'thelogbook-wrapped-account-key'
        || data.version !== 1 || data.keyVersion !== 1
        || typeof data.ciphertext !== 'string' || typeof data.iv !== 'string'
        || typeof data.tag !== 'string') {
      throw new AccountKeyUnavailableError();
    }
    return { wrapped: data, consentRevision };
  };

  let selected = await db.runTransaction(readFencedKey);
  if (!selected.wrapped) {
    // Rights-only access never creates keys, even if withdrawal is complete.
    if (purpose === 'rights-export') throw new AccountKeyUnavailableError();

    // Missing root documents can retain private descendants. Check before
    // wrapping; the second transaction still fences supported business writes.
    if ((await root.listCollections()).length > 0) {
      throw new CloudKeyProvisioningConflictError();
    }

    const candidate = randomBytes(32);
    let wrappedCandidate: Awaited<ReturnType<typeof wrapAccountDataKey>>;
    try {
      wrappedCandidate = await wrapAccountDataKey(uid, candidate);
    } finally {
      candidate.fill(0);
    }

    // A competing provisioner may have installed the winner while we wrapped
    // our candidate. All consent/deletion fences are checked again atomically.
    selected = await db.runTransaction(async transaction => {
      const checked = await readFencedKey(transaction);
      if (checked.wrapped) return checked;

      const [rootSnap, controlSnap, history, nutrition] = await Promise.all([
        transaction.get(root),
        transaction.get(root.collection('sync_control').doc('state')),
        transaction.get(root.collection('history_months').limit(1)),
        transaction.get(root.collection('nutrition_months').limit(1)),
      ]);
      if (rootSnap.exists || controlSnap.exists || !history.empty || !nutrition.empty) {
        throw new CloudKeyProvisioningConflictError();
      }
      transaction.create(keyRef, wrappedCandidate);
      return { wrapped: wrappedCandidate, consentRevision: checked.consentRevision };
    });
  }

  if (!selected.wrapped) throw new AccountKeyUnavailableError();

  const key = await unwrapAccountDataKey(uid, selected.wrapped);
  try {
    // An admin action can revoke an account after the transaction finishes.
    // Recheck the exact consent epoch selected by the transaction before
    // releasing bytes. Active -> withdrawn -> active must not authorize an
    // ADK selected for the old generation; clients also fence later use.
    const [consent, deletion, erasure] = await Promise.all([
      readHealthConsentState(uid),
      deletionRef.get(),
      erasureRef.get(),
    ]);
    if (consent.status !== (purpose === 'sync' ? 'active' : 'withdrawn')
        || consent.revision !== selected.consentRevision
        || deletion.exists || (erasure.exists && erasure.data()?.status !== 'complete')) {
      throw new AccountKeyUnavailableError();
    }
    return key;
  } catch {
    key.fill(0);
    throw new AccountKeyUnavailableError();
  }
}
