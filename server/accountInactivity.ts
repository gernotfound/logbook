import { randomBytes } from 'node:crypto';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './accountDeletion/firebaseAdmin.js';
import { hashReceipt, validateUid } from './accountDeletion/jobStore.js';
import type { AccountDeletionJob } from './accountDeletion/types.js';

const ACTIVITY_COLLECTION = 'account_activity';
const DELETION_COLLECTION = 'account_deletions';
const SCAN_COLLECTION = 'account_inactivity_scan';
const SERVER_TOUCH_MIN_INTERVAL_MS = 10 * 60 * 1000;
const MAX_CANDIDATES_PER_RUN = 12;
const MAX_PAGES_PER_RUN = 4;


type ScanCursor = { lastSeenAt: unknown; uid: string };
type ScanProgress = { revision: number; cursor: ScanCursor | null };

function parseScanProgress(data: Record<string, unknown> | undefined): ScanProgress {
  if (!data || !Number.isSafeInteger(data.revision) || Number(data.revision) < 1 || !('cursor' in data)) {
    throw new Error('Invalid account inactivity scan checkpoint.');
  }
  if (data.cursor === null) return { revision: Number(data.revision), cursor: null };
  if (!data.cursor || typeof data.cursor !== 'object' || Array.isArray(data.cursor)) {
    throw new Error('Invalid account inactivity scan cursor.');
  }
  const cursor = data.cursor as Record<string, unknown>;
  // Query cursors include malformed owners: document IDs may not pass UID validation.
  if (typeof cursor.uid !== 'string' || cursor.uid.length === 0 || cursor.uid.length > 1500
    || cursor.uid.includes('/') || !('lastSeenAt' in cursor) || cursor.lastSeenAt === undefined) {
    throw new Error('Invalid account inactivity scan cursor.');
  }
  return { revision: Number(data.revision), cursor: { uid: cursor.uid, lastSeenAt: cursor.lastSeenAt } };
}

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
    const firstSeen = storedMillis(previous?.firstSeenAt);
    const lastSeen = storedMillis(previous?.lastSeenAt);
    if (previous?.uid !== uid || firstSeen === null || lastSeen === null
      || firstSeen > lastSeen || lastSeen > now.toMillis()) {
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
  deadlineMs = Number.POSITIVE_INFINITY,
): Promise<{ scanned: number; queued: number }> {
  if (Number.isNaN(deadlineMs) || deadlineMs === Number.NEGATIVE_INFINITY) {
    throw new Error('Invalid inactivity scheduling deadline.');
  }
  // The deadline stops NEW work; never cancel an in-flight Firestore transaction.
  // The caller reserves time for the final durable scan checkpoint.
  const outOfBudget = () => Date.now() >= deadlineMs;
  if (outOfBudget()) return { scanned: 0, queued: 0 };
  const db = adminDb();
  // An acknowledged foreground visit may be newer than lastSeenAt by almost
  // the write-throttle interval. Preserve the full twelve months from that
  // visit, even when the throttled request did not write a new timestamp.
  const cutoffMs = inactivityCutoffMillis(now.toMillis()) - SERVER_TOUCH_MIN_INTERVAL_MS;
  const limit = Math.max(1, Math.min(MAX_CANDIDATES_PER_RUN, Math.floor(maxCandidates)));
  let queued = 0;
  let scanned = 0;
  const progressRef = db.collection(SCAN_COLLECTION).doc('state');
  const progressSnap = await progressRef.get();
  const previous: ScanProgress = progressSnap.exists
    ? parseScanProgress(progressSnap.data())
    : { revision: 0, cursor: null };
  let cursor: ScanCursor | null = previous.cursor;

  // Preserve the scan position across cron invocations: permanently malformed
  // records must not occupy the entire bounded window on every daily run.
  scan: for (let page = 0; page < MAX_PAGES_PER_RUN && queued < limit; page++) {
    if (outOfBudget()) break;
    let query = db.collection(ACTIVITY_COLLECTION)
      .where('lastSeenAt', '<=', Timestamp.fromMillis(cutoffMs))
      .orderBy('lastSeenAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc').limit(limit);
    if (cursor) query = query.startAfter(cursor.lastSeenAt, cursor.uid);
    const candidates = await query.get();
    if (outOfBudget()) break;
    if (candidates.size === 0) {
      // On reaching EOF, wrap to records that arrived behind the saved cursor.
      if (cursor) { cursor = null; continue; }
      break;
    }
    for (const candidate of candidates.docs) {
      if (outOfBudget()) break scan;
      const lastSeenAt = candidate.data().lastSeenAt;
      if (lastSeenAt === undefined) throw new Error('Inactivity query returned a record without lastSeenAt.');
      cursor = { lastSeenAt, uid: candidate.id };
      scanned++;
      const uid = candidate.id;
      try { validateUid(uid); } catch { continue; }
      if (candidate.data().uid !== uid) continue;

      const activityRef = db.collection(ACTIVITY_COLLECTION).doc(uid);
      const deletionRef = db.collection(DELETION_COLLECTION).doc(uid);
      const created = await db.runTransaction(async tx => {
        const [activity, existingJob] = await Promise.all([tx.get(activityRef), tx.get(deletionRef)]);
        if (existingJob.exists || !activity.exists) return false;
        const state = activity.data();
        const firstSeen = storedMillis(state?.firstSeenAt);
        const lastSeen = storedMillis(state?.lastSeenAt);
        if (state?.uid !== uid || firstSeen === null || lastSeen === null
          || firstSeen > lastSeen || lastSeen > cutoffMs) return false;
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
        // Acknowledged activity and scheduling contend on the same document.
        // This transaction also removes the old scan marker, so queued owners
        // cannot starve other eligible accounts on subsequent cron executions.
        tx.delete(activityRef);
        tx.create(deletionRef, job);
        return true;
      });
      if (created) queued++;
      if (queued >= limit) break;
    }
    if (candidates.size < limit) {
      cursor = null;
      break;
    }
  }
  if (cursor || previous.cursor) {
    await db.runTransaction(async tx => {
      const latest = await tx.get(progressRef);
      const revision = latest.exists ? parseScanProgress(latest.data()).revision : 0;
      // A second cron cannot roll the checkpoint backwards after a concurrent update.
      if (revision !== previous.revision) return;
      const next = { revision: revision + 1, cursor };
      if (latest.exists) tx.update(progressRef, next);
      else tx.create(progressRef, next);
    });
  }
  return { scanned, queued };
}
