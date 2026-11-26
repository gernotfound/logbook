import { D1_NOW_MS } from '../sql/d1-time.mjs';
import { readOpenRecoveryGeneration } from '../recovery/independent-owner-fence.mjs';
import { runOneKindeAccountErasureStep } from './kinde-account-erasure-runner.mjs';

const UID = /^k_[A-Za-z0-9_-]{43}$/;
const LEASE_MS = 60_000;
const RETRYABLE_OUTCOMES = new Set([
  'blocked', 'contended', 'health-pending', 'provider-pending', 'provider-unconfirmed', 'application-complete',
]);

// A failed owner moves behind other owners without a hot retry after the
// cursor wraps. Only a live sweep lease may change retry state. The server
// clock and bounded exponent also prevent a worker clock from extending it.
async function updateOwnerRetry(db, uid, result, lease) {
  if (uid === null || result.outcome === 'idle' || result.outcome === 'already-recorded'
    || result.outcome === 'deferred') return;
  const primary = db.withSession('first-primary');
  const scope = [uid, lease.lease_epoch, lease.lease_token];
  if (RETRYABLE_OUTCOMES.has(result.outcome)) {
    const retry = await primary.prepare(`
      INSERT INTO kinde_account_erasure_retries (uid, failure_count, retry_after_ms)
      SELECT i.uid, 1, ${D1_NOW_MS} + 60000
      FROM kinde_account_erasure_intents i
      WHERE i.uid = ?
        AND NOT EXISTS (SELECT 1 FROM kinde_account_erasure_completions WHERE uid = i.uid)
        AND EXISTS (
          SELECT 1 FROM kinde_account_erasure_scheduler s
          WHERE s.singleton = 1 AND s.lease_epoch = ? AND s.lease_token = ?
            AND s.lease_until_ms > ${D1_NOW_MS}
        )
      ON CONFLICT(uid) DO UPDATE SET
        failure_count = MIN(7, failure_count + 1),
        retry_after_ms = ${D1_NOW_MS} +
          CASE WHEN failure_count >= 6 THEN 3600000 ELSE 60000 * (1 << failure_count) END
      RETURNING uid, failure_count, retry_after_ms
    `).bind(...scope).first();
    if (retry?.uid !== uid || !Number.isSafeInteger(retry.failure_count)
      || retry.failure_count < 1 || retry.failure_count > 7
      || !Number.isSafeInteger(retry.retry_after_ms) || retry.retry_after_ms <= 0) {
      throw new Error('kinde-erasure-retry-unavailable');
    }
    return;
  }
  if (!['accepted', 'progress', 'provider-acknowledged', 'complete'].includes(result.outcome)) {
    throw new Error('kinde-erasure-retry-unavailable');
  }
  const cleared = await primary.prepare(`
    DELETE FROM kinde_account_erasure_retries
    WHERE uid = ? AND EXISTS (
      SELECT 1 FROM kinde_account_erasure_scheduler s
      WHERE s.singleton = 1 AND s.lease_epoch = ? AND s.lease_token = ?
        AND s.lease_until_ms > ${D1_NOW_MS}
    )
  `).bind(...scope).run();
  if (cleared?.success !== true || ![0, 1].includes(cleared.meta?.changes)) {
    throw new Error('kinde-erasure-retry-unavailable');
  }
}

function newLeaseToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  bytes.fill(0);
  return token;
}

/**
 * One candidate sweep tick with durable progress and a primary-clock lease.
 * A crash or lost claim cannot skip work: the cursor only moves after the
 * owner step returns and while this exact lease remains current. A replay
 * may repeat an owner step; its own SQL/recovery/provider fences, not this
 * traversal lease, protect the irreversible operation.
 *
 * @param {Parameters<typeof runOneKindeAccountErasureStep>[0]} db
 * @param {Parameters<typeof runOneKindeAccountErasureStep>[1]} recoveryDb
 * @param {number} expectedRecoveryGeneration trusted external pin; never inferred from restorable D1
 * @param {Parameters<typeof runOneKindeAccountErasureStep>[3]} [provider]
 */
export async function runKindeAccountErasureSweepTick(db, recoveryDb, expectedRecoveryGeneration, provider = null) {
  if (!db || !recoveryDb || db === recoveryDb || !Number.isSafeInteger(expectedRecoveryGeneration)
    || expectedRecoveryGeneration < 1) throw new Error('kinde-erasure-scheduler-unavailable');
  const generation = await readOpenRecoveryGeneration(recoveryDb, expectedRecoveryGeneration);
  const token = newLeaseToken();
  const primary = db.withSession('first-primary');
  const lease = await primary.prepare(`
    UPDATE kinde_account_erasure_scheduler
    SET lease_epoch = lease_epoch + 1, lease_token = ?, lease_until_ms = ${D1_NOW_MS} + ?
    WHERE singleton = 1 AND lease_until_ms <= ${D1_NOW_MS}
      AND lease_epoch < 9007199254740991
    RETURNING cursor_uid, lease_epoch, lease_token, lease_until_ms
  `).bind(token, LEASE_MS).first();
  if (lease === null) return { outcome: 'not-claimed' };
  if (lease?.lease_token !== token || !Number.isSafeInteger(lease.lease_epoch) || lease.lease_epoch < 1
    || !Number.isSafeInteger(lease.lease_until_ms) || lease.lease_until_ms <= 0
    || (lease.cursor_uid !== null && (typeof lease.cursor_uid !== 'string' || !UID.test(lease.cursor_uid)))) {
    throw new Error('kinde-erasure-scheduler-unavailable');
  }
  const step = await runOneKindeAccountErasureStep(db, recoveryDb, lease.cursor_uid, provider, generation);
  // A per-owner failure is retryable; a sealed/reopened recovery registry is
  // not. The dispatcher intentionally absorbs owner errors, so the sweep
  // must independently recheck the captured global generation.
  await readOpenRecoveryGeneration(recoveryDb, generation);
  await updateOwnerRetry(db, step.nextCursor, step.result, lease);

  let writeProven = false;
  try {
    const write = await db.withSession('first-primary').prepare(`
      UPDATE kinde_account_erasure_scheduler SET cursor_uid = ?, lease_until_ms = 0
      WHERE singleton = 1 AND cursor_uid IS ? AND lease_epoch = ? AND lease_token = ?
        AND lease_until_ms > ${D1_NOW_MS}
    `).bind(step.nextCursor, lease.cursor_uid, lease.lease_epoch, token).run();
    writeProven = write?.success === true && [0, 1].includes(write.meta?.changes);
  } catch {
    // A lost response may have committed the cursor; only primary readback
    // of this exact epoch/token can distinguish it from an interrupted tick.
  }
  const current = await db.withSession('first-primary').prepare(`
    SELECT cursor_uid, lease_epoch, lease_token, lease_until_ms
    FROM kinde_account_erasure_scheduler WHERE singleton = 1
  `).bind().first();
  await readOpenRecoveryGeneration(recoveryDb, generation);
  if (current?.lease_epoch === lease.lease_epoch && current.lease_token === token
    && current.lease_until_ms === 0 && current.cursor_uid === step.nextCursor) {
    return { outcome: 'checkpointed', result: step.result };
  }
  if (!writeProven) throw new Error('kinde-erasure-scheduler-unavailable');
  return { outcome: 'contended' };
}
