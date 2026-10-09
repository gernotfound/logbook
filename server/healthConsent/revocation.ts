import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../accountDeletion/firebaseAdmin.js';

export class RevocationAccountDeletingError extends Error {
  constructor() {
    super('La cancellazione account è già in corso.');
    this.name = 'RevocationAccountDeletingError';
  }
}

export async function recordHealthConsentRevocation(uid: string): Promise<void> {
  if (!uid || uid.includes('/')) throw new Error('Invalid authenticated UID.');

  const db = adminDb();
  const marker = db.collection('health_consent_revocations').doc(uid);
  const deletionJob = db.collection('account_deletions').doc(uid);

  await db.runTransaction(async transaction => {
    const [revoked, deleting] = await Promise.all([
      transaction.get(marker),
      transaction.get(deletionJob),
    ]);
    if (deleting.exists) throw new RevocationAccountDeletingError();
    if (revoked.exists) return;
    transaction.create(marker, {
      schemaVersion: 1,
      revokedAt: Timestamp.now(),
      eraseStatus: 'requested',
      erasePhase: 'requested',
    });
  });
}
