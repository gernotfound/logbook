import { D1_NOW_MS } from '../sql/d1-time.mjs';
import { armIndependentAccountErasureDenial } from '../recovery/account-erasure-denials.mjs';

const UID = /^k_[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;

const INTENT_COLUMNS = 'uid, auth_epoch, receipt_hash, reauthenticated_at_ms, confirmed_at_ms';

/** @param {any} db @param {string} uid @param {number} authEpoch @param {string} receiptHash */
async function readIntent(db, uid, authEpoch, receiptHash) {
  try {
    return await db.withSession('first-primary').prepare(`
      SELECT ${INTENT_COLUMNS} FROM kinde_account_erasure_intents
      WHERE uid = ? AND auth_epoch = ? AND receipt_hash = ?
    `).bind(uid, authEpoch, receiptHash).first();
  } catch { throw new Error('kinde-erasure-request-unavailable'); }
}

/**
 * Record the owner's explicit decision atomically with the current primary
 * session and fresh signed reauthentication. This precedes the independent
 * deny so an interruption cannot leave a denied owner and no durable intent.
 *
 * @param {{ withSession: (policy: 'first-primary') => any }} db
 * @param {{ uid: string, authEpoch: number, authenticatedAtMs: number, sessionHash: string, receiptHash: string }} proof
 */
export async function recordKindeAccountErasureIntent(db, proof) {
  const { uid, authEpoch, authenticatedAtMs, sessionHash, receiptHash } = proof;
  if (!UID.test(uid) || !Number.isSafeInteger(authEpoch) || authEpoch < 1 || authEpoch >= Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(authenticatedAtMs) || authenticatedAtMs <= 0 || authenticatedAtMs % 1000 !== 0
    || ![sessionHash, receiptHash].every(value => typeof value === 'string' && HASH.test(value))) {
    throw new TypeError('invalid-kinde-erasure-request');
  }
  let writeError;
  try {
    const result = await db.withSession('first-primary').prepare(`
      INSERT INTO kinde_account_erasure_intents (${INTENT_COLUMNS})
      SELECT p.uid, p.auth_epoch, ?, ?, ${D1_NOW_MS}
      FROM auth_principals p
      JOIN auth_sessions t ON t.uid = p.uid AND t.auth_epoch = p.auth_epoch
      JOIN kinde_erasure_targets target ON target.uid = p.uid
      WHERE t.token_hash = ? AND p.uid = ? AND p.auth_epoch = ?
        AND p.status = 'active' AND t.revoked_at_ms IS NULL
        AND t.issued_at_ms <= ${D1_NOW_MS}
        AND t.idle_expires_at_ms > ${D1_NOW_MS} AND t.absolute_expires_at_ms > ${D1_NOW_MS}
        AND ? BETWEEN ${D1_NOW_MS} - 300000 AND ${D1_NOW_MS}
        AND NOT EXISTS (SELECT 1 FROM kinde_account_erasure_intents WHERE uid = p.uid)
    `).bind(receiptHash, authenticatedAtMs, sessionHash, uid, authEpoch, authenticatedAtMs).run();
    if (result?.success !== true || ![0, 1].includes(result.meta?.changes)) {
      throw new Error('kinde-erasure-request-unavailable');
    }
  } catch (error) { writeError = error; }

  const intent = await readIntent(db, uid, authEpoch, receiptHash);
  if (intent?.uid === uid && intent.auth_epoch === authEpoch && intent.receipt_hash === receiptHash
    && intent.reauthenticated_at_ms === authenticatedAtMs
    && Number.isSafeInteger(intent.confirmed_at_ms) && intent.confirmed_at_ms >= authenticatedAtMs
    && intent.confirmed_at_ms - authenticatedAtMs <= 300000) {
    return { uid, authEpoch, receiptHash, authenticatedAtMs, confirmedAtMs: intent.confirmed_at_ms };
  }
  if (writeError) throw new Error('kinde-erasure-request-unavailable');
  return null;
}

/**
 * Accept the exact durable intent only after the independent database denies
 * that request. Recovery can finish without an active browser session because
 * only the original, authenticated decision could record this intent.
 *
 * @param {{ withSession: (policy: 'first-primary') => any }} db
 * @param {NonNullable<Awaited<ReturnType<typeof recordKindeAccountErasureIntent>>>} intent
 * @param {(intent: NonNullable<Awaited<ReturnType<typeof recordKindeAccountErasureIntent>>>) => Promise<boolean>} proveIndependentDenial
 */
export async function requestKindeAccountErasure(db, intent, proveIndependentDenial) {
  const { uid, authEpoch, receiptHash, authenticatedAtMs, confirmedAtMs } = intent;
  const row = await readIntent(db, uid, authEpoch, receiptHash);
  if (row?.uid !== uid || row.auth_epoch !== authEpoch || row.receipt_hash !== receiptHash
    || row.reauthenticated_at_ms !== authenticatedAtMs || row.confirmed_at_ms !== confirmedAtMs) return false;
  try {
    if (await proveIndependentDenial(intent) !== true) return false;
  } catch { throw new Error('kinde-erasure-request-unavailable'); }

  let writeError;
  try {
    const result = await db.withSession('first-primary').prepare(`
      INSERT INTO kinde_account_erasure_requests
        (uid, prior_auth_epoch, receipt_hash, reauthenticated_at_ms, requested_at_ms)
      SELECT p.uid, p.auth_epoch, i.receipt_hash, i.reauthenticated_at_ms, i.confirmed_at_ms
      FROM auth_principals p JOIN kinde_account_erasure_intents i ON i.uid = p.uid
      WHERE i.uid = ? AND i.auth_epoch = ? AND i.receipt_hash = ?
        AND i.reauthenticated_at_ms = ? AND i.confirmed_at_ms = ?
        AND p.status IN ('active', 'disabled') AND p.auth_epoch >= i.auth_epoch
        AND p.auth_epoch < 9007199254740991
        AND NOT EXISTS (SELECT 1 FROM kinde_account_erasure_requests WHERE uid = p.uid)
    `).bind(uid, authEpoch, receiptHash, authenticatedAtMs, confirmedAtMs).run();
    if (result?.success !== true || ![0, 1].includes(result.meta?.changes)) {
      throw new Error('kinde-erasure-request-unavailable');
    }
  } catch (error) { writeError = error; }

  try {
    const accepted = await db.withSession('first-primary').prepare(`
      SELECT j.uid, j.requested_at_ms
      FROM kinde_account_erasure_requests j JOIN auth_principals p ON p.uid = j.uid
      JOIN kinde_account_erasure_intents i ON i.uid = j.uid
      WHERE j.uid = ? AND j.receipt_hash = ? AND j.reauthenticated_at_ms = ?
        AND i.auth_epoch = ? AND p.status = 'disabled'
        AND p.auth_epoch = j.prior_auth_epoch + 1
        AND NOT EXISTS (SELECT 1 FROM sync_subjects s WHERE s.uid = j.uid AND s.status = 'active')
    `).bind(uid, receiptHash, authenticatedAtMs, authEpoch).first();
    if (accepted?.uid === uid && accepted.requested_at_ms === confirmedAtMs) return true;
    if (!writeError) return false;
  } catch {
    // Do not expose database errors or treat an unavailable primary as absent.
  }
  throw new Error('kinde-erasure-request-unavailable');
}

/**
 * Cross-D1 transition for a durable, reauthenticated decision. Each step is
 * idempotent and remains denied if the following database is unavailable.
 * @param {Parameters<typeof requestKindeAccountErasure>[0]} db
 * @param {Parameters<typeof armIndependentAccountErasureDenial>[0]} recoveryDb
 * @param {Parameters<typeof requestKindeAccountErasure>[1]} intent
 */
export function acceptKindeAccountErasure(db, recoveryDb, intent) {
  if (!db || !recoveryDb || db === recoveryDb) throw new Error('kinde-erasure-request-unavailable');
  return requestKindeAccountErasure(db, intent, current =>
    armIndependentAccountErasureDenial(recoveryDb, current));
}
