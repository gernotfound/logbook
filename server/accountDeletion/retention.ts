import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import type { AccountDeletionJob } from './types.js';

const JOB_COLLECTION = 'account_deletions';

export const ACCOUNT_DELETION_COMPLETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const ACCOUNT_DELETION_RETENTION_PAGE_SIZE = 400;

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

export async function purgeExpiredCompletedDeletionJobs(
  limitCount = ACCOUNT_DELETION_RETENTION_PAGE_SIZE,
  now = Timestamp.now(),
): Promise<number> {
  const boundedLimit = Math.max(1, Math.min(ACCOUNT_DELETION_RETENTION_PAGE_SIZE, Math.floor(limitCount)));
  const nowMs = now.toMillis();
  const snapshot = await adminDb().collection(JOB_COLLECTION)
    .where('purgeAfter', '<=', now)
    .limit(boundedLimit)
    .get();

  if (snapshot.empty) return 0;

  const batch = adminDb().batch();
  let deleted = 0;
  for (const item of snapshot.docs) {
    const job = item.data() as AccountDeletionJob;
    const purgeAtMs = timestampMillis(job.purgeAfter);
    if (job.status !== 'complete' || purgeAtMs === null || purgeAtMs > nowMs) continue;
    batch.delete(item.ref);
    deleted += 1;
  }

  if (deleted === 0) return 0;
  await batch.commit();
  return deleted;
}
