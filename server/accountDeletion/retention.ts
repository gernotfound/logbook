import { Timestamp, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import type { AccountDeletionJob } from './types.js';

const JOB_COLLECTION = 'account_deletions';
const DEVICE_COLLECTION = 'account_deletion_devices';
const RETENTION_SAFETY_BUFFER_MS = 8_000;
const INELIGIBLE_RECEIPT_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export const ACCOUNT_DELETION_COMPLETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const ACCOUNT_DELETION_RETENTION_PAGE_SIZE = 400;

/** Ephemeral pagination state for a single cron run; no user data is persisted. */
export interface AccountDeletionRetentionPage {
  lastDocument?: QueryDocumentSnapshot;
  scanned: number;
}

export function completedDeletionPurgeAfter(now = Timestamp.now()): Timestamp {
  return Timestamp.fromMillis(now.toMillis() + ACCOUNT_DELETION_COMPLETED_RETENTION_MS);
}

/** Delete the tombstone and its recovery proofs in one Firestore transaction.
 * Never invalidate a device credential while retaining its completed receipt.
 */
export async function purgeExpiredCompletedDeletionJobs(
  limitCount = ACCOUNT_DELETION_RETENTION_PAGE_SIZE,
  now = Timestamp.now(),
  deadlineMs = Number.POSITIVE_INFINITY,
  page?: AccountDeletionRetentionPage,
): Promise<number> {
  const boundedLimit = Math.max(1, Math.min(ACCOUNT_DELETION_RETENTION_PAGE_SIZE, Math.floor(limitCount)));
  const nowMs = now.toMillis();
  const db = adminDb();
  // An expired but malformed receipt may be skipped for safety. Paginate by
  // examined document, not by deletion count, or the cron can repeatedly read
  // the same full page and starve valid tombstones after it.
  let query = db.collection(JOB_COLLECTION)
    .where('status', '==', 'complete')
    .where('purgeAfter', '<=', now)
    .orderBy('purgeAfter');
  if (page?.lastDocument) query = query.startAfter(page.lastDocument);
  const snapshot = await query.limit(boundedLimit).get();

  let deleted = 0;
  if (page) page.scanned = 0;
  for (const item of snapshot.docs) {
    if (Date.now() + RETENTION_SAFETY_BUFFER_MS >= deadlineMs) break;
    if (page) {
      page.lastDocument = item;
      page.scanned += 1;
    }
    const jobRef: DocumentReference = item.ref;
    const deviceRef = db.collection(DEVICE_COLLECTION).doc(item.id);
    const removed = await db.runTransaction(async transaction => {
      const [currentJobSnapshot, deviceSnapshot] = await Promise.all([
        transaction.get(jobRef), transaction.get(deviceRef),
      ]);
      if (!currentJobSnapshot.exists) return false;
      const current = currentJobSnapshot.data() as AccountDeletionJob;
      if (current.status !== 'complete' || !(current.purgeAfter instanceof Timestamp)
        || current.purgeAfter.toMillis() > nowMs) return false;
      // Only the final leased worker transition produces this proof. A stray
      // "complete" status or mismatched UID must never erase recovery credentials.
      if (current.uid !== item.id || current.cursor?.phase !== 'complete') {
        // Preserve the unsafe receipt. Moving it beyond the query cutoff lets
        // later valid owners progress across separate cron invocations too.
        transaction.update(jobRef, {
          purgeAfter: Timestamp.fromMillis(Math.max(Date.now(), nowMs) + INELIGIBLE_RECEIPT_RETRY_MS),
        });
        return false;
      }
      if (deviceSnapshot.exists) transaction.delete(deviceRef);
      transaction.delete(jobRef);
      return true;
    });
    if (removed) deleted += 1;
  }
  return deleted;
}
