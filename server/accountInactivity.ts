import { randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './accountDeletion/firebaseAdmin.js';
import { hashReceipt, validateUid } from './accountDeletion/jobStore.js';
import type { AccountDeletionJob } from './accountDeletion/types.js';

const ACTIVITY_COLLECTION = 'account_activity';
const DELETION_COLLECTION = 'account_deletions';
const SERVER_TOUCH_MIN_INTERVAL_MS = 10 * 60 * 1000;
const MAX_CANDIDATES_PER_RUN = 12;
const MAX_PAGES_PER_RUN = 4;

export class AccountDeletionAlreadyScheduledError extends Error {
  constructor() {
    super('Cancellazione account già avviata.');
    this.name = 'AccountDeletionAlreadyScheduledError';
  }
}

function storedMillis(value: unknown): number | null {
  if (!(value instanceof Timestamp)) return null;
  const millis = value.toMillis();
  return Number.isFinite(millis) ? millis : null;
}

/** Twelve calendar months in UTC, preserving the time of day and clamping February 29. */
export function inactivityCutoffMillis(nowMs: number): number {
  if (!Number.isFinite(nowMs)) throw new Error('Invalid inactivity clock.');
  const date = new Date(nowMs);
  const year = date.getUTCFullYear() - 1;
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(
    year, month, Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds(),
  );
}

/** A trusted, foreground request is the only source of online activity.
 * Server clock and a Firestore transaction ensure that a cron cannot race an acknowledged visit.
 */
export async function recordAccountActivity(uidValue: string, now = Timestamp.now()): Promise<void> {
  const uid = validateUid(uidValue);
  const db = adminDb();
  const activityRef = db.collection(ACTIVITY_COLLECTION).doc(uid);
  const deletionRef = db.collection(DELETION_COLLECTION).doc(uid);
  await db.runTransaction(async tx => {
    const [deletion, existing] = await Promise.all([tx.get(deletionRef), tx.get(activityRef)]);
    if (deletion.exists) throw new AccountDeletionAlreadyScheduledError();
    if (!existing.exists) {
      tx.create(activityRef, { uid, firstSeenAt: now, lastSeenAt: now });
      return;
    }
    const previous = existing.data();
    const lastSeen = storedMillis(previous?.lastSeenAt);
    if (previous?.uid !== uid || lastSeen === null || lastSeen > now.toMillis()) {
      throw new Error('Activity record invalid; refusing to overwrite it.');
    }
    if (now.toMillis() - lastSeen >= SERVER_TOUCH_MIN_INTERVAL_MS) {
      tx.update(activityRef, { lastSeenAt: now });
    }
  });
}

/** Only records actually acknowledged by the trusted endpoint are eligible.
 * The live activity marker and deletion fence are re-read in the same transaction.
 * Never infer inactivity from missing records, Auth lastSignInTime or offline silence.
 */
export async function queueInactiveAccountDeletions(
  now = Timestamp.now(), maxCandidates = MAX_CANDIDATES_PER_RUN,
): Promise<{ scanned: number; queued: number }> {
  const db = adminDb();
  const cutoffMs = inactivityCutoffMillis(now.toMillis());
  const limit = Math.max(1, Math.min(MAX_CANDIDATES_PER_RUN, Math.floor(maxCandidates)));
  const candidates = await db.collection(ACTIVITY_COLLECTION)
    .where('lastSeenAt', '<=', Timestamp.fromMillis(cutoffMs))
    .orderBy('lastSeenAt', 'asc').limit(limit).get();

  let queued = 0;
  for (const candidate of candidates.docs) {
    const uid = candidate.id;
    try { validateUid(uid); } catch { continue; }
    if (candidate.data().uid !== uid) continue;

    const activityRef = db.collection(ACTIVITY_COLLECTION).doc(uid);
    const deletionRef = db.collection(DELETION_COLLECTION).doc(uid);
    const created = await db.runTransaction(async tx => {
      const [activity, existingJob] = await Promise.all([tx.get(activityRef), tx.get(deletionRef)]);
      if (existingJob.exists || !activity.exists) return false;
      const state = activity.data();
      const lastSeen = storedMillis(state?.lastSeenAt);
      if (state?.uid !== uid || lastSeen === null || lastSeen > cutoffMs) return false;
      const receiptHash = hashReceipt(randomBytes(32).toString('base64url'));
      const job: AccountDeletionJob = {
        uid,
        requestedAt: now,
        updatedAt: now,
        status: 'requested',
        cursor: { phase: 'requested' },
        attempts: 0,
        receiptHash,
        receiptHashes: [],
        reason: 'inactivity',
        inactivityLastSeenAt: state.lastSeenAt,
      };
      // One atomic fence: retire the eligibility marker when the deletion job
      // is created. This avoids repeatedly starving newer candidates on each cron.
      tx.delete(activityRef);
      tx.create(deletionRef, job);
      return true;
    });
    if (created) queued++;
  }
  return { scanned: candidates.size, queued };
}
