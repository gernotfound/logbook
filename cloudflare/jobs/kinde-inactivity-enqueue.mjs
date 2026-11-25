import { D1_NOW_MS } from '../sql/d1-time.mjs';
import { earliestKindeInactivityErasureAt } from './kinde-inactivity-time.mjs';
import { INTENT_COLUMNS, intentFromRow, readErasureIntent } from './kinde-erasure-intent.mjs';

const UID = /^k_[A-Za-z0-9_-]{43}$/;

/** @param {Awaited<ReturnType<typeof import('./kinde-inactivity-candidates.mjs').readKindeInactivityCandidates>>['candidates'][number]} candidate */
async function receiptFor(candidate) {
  const bytes = new TextEncoder().encode(JSON.stringify(['thelogbook:inactivity-decision:v1',
    candidate.uid, candidate.authEpoch, candidate.generation, candidate.lastRecordedAtMs, candidate.eligibleAtMs]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Trusted scanner only. SQL rechecks the observation and freezes access in
 * the same transaction as recording the decision. The independent deny is
 * still required for acceptance and cleanup. Pause never undoes a commit.
 * @param {{withSession: (policy: 'first-primary') => any}} db
 * @param {Parameters<typeof receiptFor>[0]} candidate
 */
export async function recordKindeInactivityErasureIntent(db, candidate) {
  if (!candidate || typeof candidate.uid !== 'string' || !UID.test(candidate.uid)
    || !Number.isSafeInteger(candidate.authEpoch) || candidate.authEpoch < 1 || candidate.authEpoch >= Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(candidate.generation) || candidate.generation < 1
    || !Number.isSafeInteger(candidate.eligibleAtMs)
    || earliestKindeInactivityErasureAt(candidate.lastRecordedAtMs) !== candidate.eligibleAtMs) {
    throw new TypeError('invalid-kinde-inactivity-decision');
  }
  const { uid, authEpoch, generation, lastRecordedAtMs, eligibleAtMs } = candidate;
  const receiptHash = await receiptFor(candidate);
  let uncertain = false;
  try {
    const result = await db.withSession('first-primary').prepare(`
      INSERT INTO kinde_account_erasure_intents (${INTENT_COLUMNS})
      SELECT p.uid, p.auth_epoch, ?, NULL, ${D1_NOW_MS}, c.generation, a.last_recorded_at_ms, ?
      FROM auth_principals p JOIN kinde_account_activity a ON a.uid = p.uid
      JOIN kinde_erasure_targets target ON target.uid = p.uid
      CROSS JOIN kinde_inactivity_control c
      WHERE p.uid = ? AND p.auth_epoch = ? AND p.status = 'active'
        AND c.singleton = 1 AND c.mode = 'enabled' AND c.generation = ?
        AND a.last_recorded_at_ms = ? AND ? <= ${D1_NOW_MS}
        AND NOT EXISTS (SELECT 1 FROM kinde_account_erasure_intents i WHERE i.uid = p.uid)
        AND NOT EXISTS (SELECT 1 FROM auth_sessions t WHERE t.uid = p.uid AND t.auth_epoch = p.auth_epoch
          AND t.revoked_at_ms IS NULL AND t.issued_at_ms <= ${D1_NOW_MS}
          AND t.idle_expires_at_ms > ${D1_NOW_MS} AND t.absolute_expires_at_ms > ${D1_NOW_MS})
    `).bind(receiptHash, eligibleAtMs, uid, authEpoch, generation, lastRecordedAtMs, eligibleAtMs).run();
    uncertain = result?.success !== true || ![0, 1].includes(result.meta?.changes);
  } catch { uncertain = true; }
  try {
    const intent = intentFromRow(await readErasureIntent(db, uid, authEpoch, receiptHash));
    if (intent?.inactivity?.generation === generation && intent.inactivity.lastRecordedAtMs === lastRecordedAtMs
      && intent.inactivity.eligibleAtMs === eligibleAtMs) {
      const principal = await db.withSession('first-primary').prepare(`
        SELECT status FROM auth_principals WHERE uid = ? AND auth_epoch >= ?
      `).bind(uid, authEpoch).first();
      if (principal?.status === 'disabled' || principal?.status === 'deleted') return intent;
      throw new Error('unproven-freeze');
    }
    if (!uncertain) return null;
  } catch {
    // Without current primary evidence, no decision receipt is returned.
  }
  throw new Error('kinde-inactivity-decision-unavailable');
}
