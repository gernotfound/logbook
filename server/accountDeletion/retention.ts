import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import type { AccountDeletionJob } from './types.js';
import { purgeDeletionRecoveryDevices } from './deviceRecovery.js';

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
    .where('status', '==', 'complete')
    .where('purgeAfter', '<=', now)
    .limit(boundedLimit)
    .get();

  if (snapshot.empty) return 0;

  const eligible: Array<{ uid: string; ref: DocumentReference }> = [];
  for (const item of snapshot.docs) {
    const job = item.data() as AccountDeletionJob;
    const purgeAtMs = timestampMillis(job.purgeAfter);
    if (job.status !== 'complete' || purgeAtMs === null || purgeAtMs > nowMs) continue;
    eligible.push({ uid: job.uid, ref: item.ref });
  }

  if (eligible.length === 0) return 0;

  // Purge the recovery credential first. If this fails, keep the tombstone so a
  // later cron run can retry; deleting the tombstone first could orphan the
  // server-only recovery registry permanently.
  for (const item of eligible) {
    await purgeDeletionRecoveryDevices(item.uid);
  }

  const batch = adminDb().batch();
  for (const item of eligible) batch.delete(item.ref);
  await batch.commit();
  return eligible.length;
}
