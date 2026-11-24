import { D1_NOW_MS } from '../sql/d1-time.mjs';

const UID = /^k_[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;

/**
 * Persist a candidate request after an explicit, consumed reauthentication
 * intent. Require proof of an already persisted independent denial.
 * A positive result means the owner is fenced and any active health consent
 * withdrawn in the same write. It never proves terminal erasure.
 *
 * @param {{ withSession: (policy: 'first-primary') => any }} db
 * @param {{ uid: string, authEpoch: number, authenticatedAtMs: number, sessionHash: string, receiptHash: string }} proof
 * @param {(uid: string, authEpoch: number) => Promise<boolean>} proveIndependentDenial
 */
export async function requestKindeAccountErasure(db, proof, proveIndependentDenial) {
  const { uid, authEpoch, authenticatedAtMs, sessionHash, receiptHash } = proof;
  if (!UID.test(uid) || !Number.isSafeInteger(authEpoch) || authEpoch < 1 || authEpoch >= Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(authenticatedAtMs) || authenticatedAtMs <= 0 || authenticatedAtMs % 1000 !== 0
    || ![sessionHash, receiptHash].every(value => typeof value === 'string' && HASH.test(value))) {
    throw new TypeError('invalid-kinde-erasure-request');
  }
  try {
    if (await proveIndependentDenial(uid, authEpoch) !== true) return false;
  } catch { throw new Error('kinde-erasure-request-unavailable'); }
  let writeError;
  try {
    const result = await db.withSession('first-primary').prepare(`
      INSERT INTO kinde_account_erasure_requests
        (uid, prior_auth_epoch, receipt_hash, reauthenticated_at_ms, requested_at_ms)
      SELECT p.uid, p.auth_epoch, ?, ?, ${D1_NOW_MS}
      FROM auth_principals p
      JOIN auth_sessions t ON t.uid = p.uid AND t.auth_epoch = p.auth_epoch
      JOIN kinde_erasure_targets target ON target.uid = p.uid
      WHERE t.token_hash = ? AND p.uid = ? AND p.auth_epoch = ?
        AND p.status = 'active' AND t.revoked_at_ms IS NULL
        AND t.issued_at_ms <= ${D1_NOW_MS}
        AND t.idle_expires_at_ms > ${D1_NOW_MS} AND t.absolute_expires_at_ms > ${D1_NOW_MS}
        AND ? BETWEEN ${D1_NOW_MS} - 300000 AND ${D1_NOW_MS}
        AND NOT EXISTS (SELECT 1 FROM kinde_account_erasure_requests WHERE uid = p.uid)
    `).bind(receiptHash, authenticatedAtMs, sessionHash, uid, authEpoch, authenticatedAtMs).run();
    if (result?.success !== true || ![0, 1].includes(result.meta?.changes)) {
      throw new Error('kinde-erasure-request-unavailable');
    }
  } catch (error) { writeError = error; }

  try {
    const accepted = await db.withSession('first-primary').prepare(`
      SELECT j.uid, j.requested_at_ms
      FROM kinde_account_erasure_requests j JOIN auth_principals p ON p.uid = j.uid
      WHERE j.uid = ? AND j.receipt_hash = ? AND j.reauthenticated_at_ms = ?
        AND j.prior_auth_epoch = ? AND p.status = 'disabled'
        AND p.auth_epoch = j.prior_auth_epoch + 1
        AND NOT EXISTS (SELECT 1 FROM sync_subjects s WHERE s.uid = j.uid AND s.status = 'active')
    `).bind(uid, receiptHash, authenticatedAtMs, authEpoch).first();
    if (accepted?.uid === uid && Number.isSafeInteger(accepted.requested_at_ms)
      && accepted.requested_at_ms >= authenticatedAtMs
      && accepted.requested_at_ms - authenticatedAtMs <= 300000) return true;
    if (!writeError) return false;
  } catch {
    // Do not expose database errors or treat an unavailable primary as absent.
  }
  throw new Error('kinde-erasure-request-unavailable');
}
