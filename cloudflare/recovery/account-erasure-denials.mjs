import { IndependentFenceUnavailableError, readOpenRecoveryGeneration, requireIndependentOwnerFence } from './independent-owner-fence.mjs';

import { INTENT_SCOPE, intentScopeArgs, validErasureIntent } from '../jobs/kinde-erasure-intent.mjs';

const UID = /^k_[A-Za-z0-9_-]{43}$/;

const INTENT_CONTEXT = 'thelogbook:kinde-erasure-intent:v1';

/**
 * The candidate Auth boundary must check this even when the application's
 * restored database still presents an active principal or session.
 * @param {{ withSession: (policy: 'first-primary') => any }} recoveryDb
 * @param {string} uid
 */
export async function requireIndependentAccountAccess(recoveryDb, uid) {
  if (!UID.test(uid)) throw new IndependentFenceUnavailableError();
  try {
    const row = await recoveryDb.withSession('first-primary').prepare(`
      SELECT mode, EXISTS (
        SELECT 1 FROM recovery_account_erasure_denials WHERE uid = ?
      ) AS denied FROM recovery_control WHERE singleton = 1
    `).bind(uid).first();
    if (row?.mode === 'open' && row.denied === 0) return;
  } catch {
    // Sealed, unknown or unavailable registry must stop access.
  }
  throw new IndependentFenceUnavailableError();
}

/** @param {import('../jobs/kinde-erasure-intent.mjs').ErasureIntent} intent */
export async function digestForIntent(intent) {
  const { uid, authEpoch, receiptHash, authenticatedAtMs, confirmedAtMs } = intent;
  if (!validErasureIntent(intent)) throw new IndependentFenceUnavailableError();
  const fields = intent.inactivity
    ? ['thelogbook:kinde-inactivity-intent:v1', uid, authEpoch, receiptHash, confirmedAtMs,
      intent.inactivity.generation, intent.inactivity.lastRecordedAtMs, intent.inactivity.eligibleAtMs]
    : [INTENT_CONTEXT, uid, authEpoch, receiptHash, authenticatedAtMs, confirmedAtMs];
  const bytes = new TextEncoder().encode(JSON.stringify(fields));
  const hashed = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashed), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** @param {any} recoveryDb @param {string} uid @param {string} digest @param {number | null} expected */
async function verifyStoredDenial(recoveryDb, uid, digest, expected = null) {
  try {
    const stored = await recoveryDb.withSession('first-primary').prepare(`
      SELECT d.uid, d.intent_digest, r.generation FROM recovery_account_erasure_denials d
      CROSS JOIN recovery_control r
      WHERE d.uid = ? AND r.singleton = 1 AND r.mode = 'open'
    `).bind(uid).first();
    if (stored?.uid === uid && stored.intent_digest === digest
      && Number.isSafeInteger(stored.generation) && stored.generation >= 1
      && (expected === null || stored.generation === expected)) return stored.generation;
  } catch {
    // A primary read failure cannot prove a denial.
  }
  throw new IndependentFenceUnavailableError();
}

/**
 * Record an already verified, durable application intent. In production
 * the caller must pass the two primary D1 bindings with independent IAM.
 * @param {{ withSession: (policy: 'first-primary') => any }} recoveryDb
 * @param {Parameters<typeof digestForIntent>[0]} intent
 * @param {number | null} [expected]
 */
export async function armIndependentAccountErasureDenial(recoveryDb, intent, expected = null) {
  const generation = await readOpenRecoveryGeneration(recoveryDb, expected);
  const { uid } = intent;
  const digest = await digestForIntent(intent);
  try {
    await recoveryDb.withSession('first-primary').prepare(`
      INSERT INTO recovery_account_erasure_denials (uid, intent_digest)
      SELECT ?, ? WHERE EXISTS (SELECT 1 FROM recovery_control WHERE singleton = 1 AND mode = 'open' AND generation = ?)
        AND NOT EXISTS (SELECT 1 FROM recovery_account_erasure_denials WHERE uid = ?)
    `).bind(uid, digest, generation, uid).run();
  } catch {
    // A lost write response does not distinguish commit from failure.
  }
  await verifyStoredDenial(recoveryDb, uid, digest, generation);
  return true;
}

/**
 * Read-only proof for a runner that is already processing the accepted job.
 * @param {Parameters<typeof armIndependentAccountErasureDenial>[0]} recoveryDb
 * @param {Parameters<typeof digestForIntent>[0]} intent
 * @param {number | null} [expected]
 */
export async function readIndependentAccountErasureGeneration(recoveryDb, intent, expected = null) {
  return verifyStoredDenial(recoveryDb, intent.uid, await digestForIntent(intent), expected);
}

/** @param {Parameters<typeof readIndependentAccountErasureGeneration>[0]} recoveryDb
 * @param {Parameters<typeof readIndependentAccountErasureGeneration>[1]} intent
 * @param {number | null} [expected]
 */
export async function requireIndependentAccountErasureDenial(recoveryDb, intent, expected = null) {
  await readIndependentAccountErasureGeneration(recoveryDb, intent, expected);
  return true;
}

/**
 * A first consent can commit in the application D1 before its independent
 * pending floor is promoted. Account denial already blocks access, but the
 * health runner also needs the exact withdrawn generation. Never promote to
 * active to repair this gap. The accepted account request, original consent
 * and queued health job are the authority for this one-way transition.
 * @param {{ withSession: (policy: 'first-primary') => any }} appDb
 * @param {Parameters<typeof armIndependentAccountErasureDenial>[0]} recoveryDb
 * @param {Parameters<typeof digestForIntent>[0]} intent
 * @param {number | null} [expected]
 */
export async function reconcileAccountErasureHealthFence(appDb, recoveryDb, intent, expected = null) {
  if (!appDb || !recoveryDb || appDb === recoveryDb) throw new IndependentFenceUnavailableError();
  const { uid } = intent;
  const digest = await digestForIntent(intent);
  try {
    const generation = await verifyStoredDenial(recoveryDb, uid, digest, expected);
    const subject = await appDb.withSession('first-primary').prepare(`
      SELECT s.uid, s.fence_epoch
      FROM kinde_account_erasure_requests r
      JOIN kinde_account_erasure_intents i ON i.uid = r.uid
      JOIN auth_principals p ON p.uid = r.uid
      JOIN sync_subjects s ON s.uid = r.uid
      JOIN health_consent_acceptances c ON c.uid = s.uid
      JOIN health_erasure_jobs j ON j.uid = s.uid AND j.consent_revision = s.consent_revision
      WHERE ${INTENT_SCOPE}
        AND p.status = 'disabled' AND p.auth_epoch = r.prior_auth_epoch + 1
        AND s.status = 'withdrawn' AND s.consent_revision = 1 AND s.erased_before_revision = 0
        AND c.consent_revision = 1 AND c.over_18_confirmed = 1
        AND j.fence_epoch = s.fence_epoch AND j.status IN ('pending', 'processing')
    `).bind(...intentScopeArgs(intent)).first();
    if (subject?.uid !== uid || !Number.isSafeInteger(subject.fence_epoch) || subject.fence_epoch < 1) {
      throw new IndependentFenceUnavailableError();
    }
    try {
      await recoveryDb.withSession('first-primary').prepare(`
        UPDATE recovery_owner_fences SET status = 'blocked', consent_revision = 1,
          change_seq = change_seq + 1
        WHERE uid = ? AND status = 'pending' AND consent_revision = 0
          AND fence_epoch = ? AND erased_before_revision = 0
          AND EXISTS (SELECT 1 FROM recovery_account_erasure_denials WHERE uid = ? AND intent_digest = ?)
          AND EXISTS (SELECT 1 FROM recovery_control WHERE singleton = 1 AND mode = 'open' AND generation = ?)
      `).bind(uid, subject.fence_epoch, uid, digest, generation).run();
    } catch {
      // A lost reply may have committed the monotone denial transition.
    }
    await requireIndependentOwnerFence(recoveryDb, {
      uid, status: 'withdrawn', consentRevision: 1, fenceEpoch: subject.fence_epoch,
      erasedBeforeRevision: 0,
    }, 'erasure');
    await verifyStoredDenial(recoveryDb, uid, digest, generation);
  } catch {
    throw new IndependentFenceUnavailableError();
  }
}
