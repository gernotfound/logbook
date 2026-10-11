import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../accountDeletion/firebaseAdmin.js';

/**
 * A server-owned, irreversible (within this account) revocation fence.
 * Business writes are denied by Firestore Security Rules as soon as this
 * document is committed. The user may still read existing data for export.
 */
export async function recordHealthConsentWithdrawal(uid: string): Promise<void> {
  if (!uid || uid.length > 128 || uid.includes('/')) {
    throw new Error('Identificativo account non valido.');
  }

  const db = adminDb();
  const withdrawal = db.collection('health_consent_withdrawals').doc(uid);
  const deletion = db.collection('account_deletions').doc(uid);
  await db.runTransaction(async transaction => {
    // Reading both records in a transaction also serializes with a racing
    // account-deletion request. Never recreate a marker after account deletion.
    const [deletionState, existing] = await Promise.all([
      transaction.get(deletion),
      transaction.get(withdrawal),
    ]);
    if (deletionState.exists) {
      throw new Error('Cancellazione account in corso.');
    }
    if (existing.exists) return;
    transaction.create(withdrawal, {
      uid,
      status: 'withdrawn',
      withdrawnAt: Timestamp.now(),
    });
  });
}
