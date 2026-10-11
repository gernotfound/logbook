import { Timestamp, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import type { AccountDeletionJob } from './types.js';

const JOB_COLLECTION = 'account_deletions';
const DEVICE_COLLECTION = 'account_deletion_devices';
const RETENTION_SAFETY_BUFFER_MS = 8_000;

export const ACCOUNT_DELETION_COMPLETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const ACCOUNT_DELETION_RETENTION_PAGE_SIZE = 400;

/** Ephemeral pagination state for a single cron run; no user data is persisted. */
export interface AccountDeletionRetentionPage {
  lastDocument?: QueryDocumentSnapshot;
  scanned: number;
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === 'object' && 'toMillis' in value
    && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    try { return (value as { toMillis: () => number }).toMillis(); }
    catch { return null; }
  }
  return null;
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
    const job = item.data() as AccountDeletionJob;
    // The document ID is the canonical owner; a corrupted UID must not delete
    // an unrelated device registry.
    if (job.uid !== item.id || job.status !== 'complete'
      || (timestampMillis(job.purgeAfter) ?? Number.POSITIVE_INFINITY) > nowMs) continue;

    const jobRef: DocumentReference = item.ref;
    const deviceRef = db.collection(DEVICE_COLLECTION).doc(item.id);
    const removed = await db.runTransaction(async transaction => {
      const [currentJobSnapshot, deviceSnapshot] = await Promise.all([
        transaction.get(jobRef), transaction.get(deviceRef),
      ]);
      if (!currentJobSnapshot.exists) return false;
      const current = currentJobSnapshot.data() as AccountDeletionJob;
      if (current.uid !== item.id || current.status !== 'complete'
        || (timestampMillis(current.purgeAfter) ?? Number.POSITIVE_INFINITY) > nowMs) return false;
      if (deviceSnapshot.exists) transaction.delete(deviceRef);
      transaction.delete(jobRef);
      return true;
    });
    if (removed) deleted += 1;
  }
  return deleted;
}
