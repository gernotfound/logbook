import { D1_NOW_MS } from '../sql/d1-time.mjs';
import { readOpenRecoveryGeneration } from '../recovery/independent-owner-fence.mjs';
import { scanKindeInactivityEnqueueStep } from './kinde-inactivity-enqueue-scan.mjs';

const UID = /^k_[A-Za-z0-9_-]{43}$/;
const LEASE_MS = 60_000;

function newLeaseToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  bytes.fill(0);
  return token;
}

/**
 * Candidate enqueue sweep only. Its own durable lease fences cursor progress
 * and new decisions; the SQL intent still verifies the owner and policy.
 * No cleanup or independent deny is performed here.
 * @param {Parameters<typeof scanKindeInactivityEnqueueStep>[0]} db
 * @param {Parameters<typeof readOpenRecoveryGeneration>[0]} recoveryDb
 * @param {number} expectedRecoveryGeneration trusted external pin, never refreshed automatically
 */
export async function runKindeInactivityEnqueueTick(db, recoveryDb, expectedRecoveryGeneration) {
  if (!db || !recoveryDb || db === recoveryDb || !Number.isSafeInteger(expectedRecoveryGeneration)
    || expectedRecoveryGeneration < 1) throw new Error('kinde-inactivity-enqueue-scheduler-unavailable');
  await readOpenRecoveryGeneration(recoveryDb, expectedRecoveryGeneration);
  const token = newLeaseToken();
  const lease = await db.withSession('first-primary').prepare(`
    UPDATE kinde_inactivity_enqueue_checkpoint AS p
    SET policy_generation = c.generation, recovery_generation = ?,
      cursor_last_recorded_at_ms = CASE WHEN p.policy_generation = c.generation AND p.recovery_generation = ?
        THEN p.cursor_last_recorded_at_ms ELSE NULL END,
      cursor_uid = CASE WHEN p.policy_generation = c.generation AND p.recovery_generation = ?
        THEN p.cursor_uid ELSE NULL END,
      lease_epoch = p.lease_epoch + 1, lease_token = ?, lease_until_ms = ${D1_NOW_MS} + ?
    FROM kinde_inactivity_control c
    WHERE p.singleton = 1 AND c.singleton = 1 AND c.mode = 'enabled'
      AND p.lease_until_ms <= ${D1_NOW_MS} AND p.lease_epoch < 9007199254740991
      AND c.generation BETWEEN 1 AND 9007199254740991 AND p.recovery_generation <= ?
    RETURNING policy_generation, recovery_generation, cursor_last_recorded_at_ms, cursor_uid,
      lease_epoch, lease_token, lease_until_ms
  `).bind(expectedRecoveryGeneration, expectedRecoveryGeneration, expectedRecoveryGeneration,
    token, LEASE_MS, expectedRecoveryGeneration).first();
  await readOpenRecoveryGeneration(recoveryDb, expectedRecoveryGeneration);
  if (lease === null) return { outcome: 'not-claimed' };
  if (lease?.lease_token !== token || lease.recovery_generation !== expectedRecoveryGeneration
    || !Number.isSafeInteger(lease.policy_generation) || lease.policy_generation < 1
    || !Number.isSafeInteger(lease.lease_epoch) || lease.lease_epoch < 1
    || !Number.isSafeInteger(lease.lease_until_ms) || lease.lease_until_ms <= 0
    || (lease.cursor_uid === null ? lease.cursor_last_recorded_at_ms !== null
      : typeof lease.cursor_uid !== 'string' || !UID.test(lease.cursor_uid) || !Number.isSafeInteger(lease.cursor_last_recorded_at_ms)
        || lease.cursor_last_recorded_at_ms <= 0)) throw new Error('kinde-inactivity-enqueue-scheduler-unavailable');

  const after = lease.cursor_uid === null ? null
    : { uid: lease.cursor_uid, lastRecordedAtMs: lease.cursor_last_recorded_at_ms };
  const step = await scanKindeInactivityEnqueueStep(db, recoveryDb, lease.policy_generation,
    expectedRecoveryGeneration, after === null ? null : { policyGeneration: lease.policy_generation,
      recoveryGeneration: expectedRecoveryGeneration, after }, { epoch: lease.lease_epoch, token });
  await readOpenRecoveryGeneration(recoveryDb, expectedRecoveryGeneration);
  const next = step.nextCursor?.after ?? null;
  let writeProven = false;
  try {
    const write = await db.withSession('first-primary').prepare(`
      UPDATE kinde_inactivity_enqueue_checkpoint
      SET cursor_uid = ?, cursor_last_recorded_at_ms = ?, lease_until_ms = 0
      WHERE singleton = 1 AND lease_epoch = ? AND lease_token = ? AND lease_until_ms > ${D1_NOW_MS}
        AND policy_generation = ? AND recovery_generation = ?
        AND cursor_uid IS ? AND cursor_last_recorded_at_ms IS ?
        AND EXISTS (SELECT 1 FROM kinde_inactivity_control c
          WHERE c.singleton = 1 AND c.mode = 'enabled' AND c.generation = ?)
    `).bind(next?.uid ?? null, next?.lastRecordedAtMs ?? null, lease.lease_epoch, token,
      lease.policy_generation, expectedRecoveryGeneration, lease.cursor_uid, lease.cursor_last_recorded_at_ms,
      lease.policy_generation).run();
    writeProven = write?.success === true && [0, 1].includes(write.meta?.changes);
  } catch {
    // A lost checkpoint reply may have committed the exact cursor.
  }
  const current = await db.withSession('first-primary').prepare(`
    SELECT p.*, c.mode, c.generation FROM kinde_inactivity_enqueue_checkpoint p
    CROSS JOIN kinde_inactivity_control c WHERE p.singleton = 1 AND c.singleton = 1
  `).bind().first();
  await readOpenRecoveryGeneration(recoveryDb, expectedRecoveryGeneration);
  if (current?.lease_epoch === lease.lease_epoch && current.lease_token === token
    && current.lease_until_ms === 0 && current.policy_generation === lease.policy_generation
    && current.recovery_generation === expectedRecoveryGeneration
    && current.mode === 'enabled' && current.generation === lease.policy_generation
    && current.cursor_uid === (next?.uid ?? null)
    && current.cursor_last_recorded_at_ms === (next?.lastRecordedAtMs ?? null)) {
    return { outcome: 'checkpointed', decision: step.decision, endOfSweep: next === null };
  }
  if (!writeProven) throw new Error('kinde-inactivity-enqueue-scheduler-unavailable');
  return { outcome: 'contended' };
}
