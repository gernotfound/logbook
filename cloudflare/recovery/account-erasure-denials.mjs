import { IndependentFenceUnavailableError } from './independent-owner-fence.mjs';

const UID = /^k_[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
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

/** @param {{ uid: string, authEpoch: number, receiptHash: string, authenticatedAtMs: number, confirmedAtMs: number }} intent */
async function digestForIntent(intent) {
  const { uid, authEpoch, receiptHash, authenticatedAtMs, confirmedAtMs } = intent;
  if (!UID.test(uid) || !HASH.test(receiptHash) || !Number.isSafeInteger(authEpoch) || authEpoch < 1
    || !Number.isSafeInteger(authenticatedAtMs) || authenticatedAtMs < 1
    || !Number.isSafeInteger(confirmedAtMs) || confirmedAtMs < authenticatedAtMs
    || confirmedAtMs - authenticatedAtMs > 300_000) throw new IndependentFenceUnavailableError();

  const bytes = new TextEncoder().encode(JSON.stringify(
    [INTENT_CONTEXT, uid, authEpoch, receiptHash, authenticatedAtMs, confirmedAtMs],
  ));
  const hashed = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashed), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** @param {any} recoveryDb @param {string} uid @param {string} digest */
async function verifyStoredDenial(recoveryDb, uid, digest) {
  try {
    const stored = await recoveryDb.withSession('first-primary').prepare(`
      SELECT d.uid, d.intent_digest FROM recovery_account_erasure_denials d
      CROSS JOIN recovery_control r
      WHERE d.uid = ? AND r.singleton = 1 AND r.mode = 'open'
    `).bind(uid).first();
    if (stored?.uid === uid && stored.intent_digest === digest) return true;
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
 */
export async function armIndependentAccountErasureDenial(recoveryDb, intent) {
  const { uid } = intent;
  const digest = await digestForIntent(intent);
  try {
    await recoveryDb.withSession('first-primary').prepare(`
      INSERT INTO recovery_account_erasure_denials (uid, intent_digest)
      SELECT ?, ? WHERE EXISTS (SELECT 1 FROM recovery_control WHERE singleton = 1 AND mode = 'open')
        AND NOT EXISTS (SELECT 1 FROM recovery_account_erasure_denials WHERE uid = ?)
    `).bind(uid, digest, uid).run();
  } catch {
    // A lost write response does not distinguish commit from failure.
  }
  return verifyStoredDenial(recoveryDb, uid, digest);
}

/**
 * Read-only proof for a runner that is already processing the accepted job.
 * @param {Parameters<typeof armIndependentAccountErasureDenial>[0]} recoveryDb
 * @param {Parameters<typeof digestForIntent>[0]} intent
 */
export async function requireIndependentAccountErasureDenial(recoveryDb, intent) {
  return verifyStoredDenial(recoveryDb, intent.uid, await digestForIntent(intent));
}
