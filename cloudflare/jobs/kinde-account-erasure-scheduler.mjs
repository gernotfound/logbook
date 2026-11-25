import { D1_NOW_MS } from '../sql/d1-time.mjs';
import { runOneKindeAccountErasureStep } from './kinde-account-erasure-runner.mjs';

const UID = /^k_[A-Za-z0-9_-]{43}$/;
const LEASE_MS = 60_000;

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
 * @param {Parameters<typeof runOneKindeAccountErasureStep>[3]} [provider]
 */
export async function runKindeAccountErasureSweepTick(db, recoveryDb, provider = null) {
  if (!db || !recoveryDb || db === recoveryDb) throw new Error('kinde-erasure-scheduler-unavailable');
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
  const step = await runOneKindeAccountErasureStep(db, recoveryDb, lease.cursor_uid, provider);

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
  if (current?.lease_epoch === lease.lease_epoch && current.lease_token === token
    && current.lease_until_ms === 0 && current.cursor_uid === step.nextCursor) {
    return { outcome: 'checkpointed', result: step.result };
  }
  if (!writeProven) throw new Error('kinde-erasure-scheduler-unavailable');
  return { outcome: 'contended' };
}
