import { earliestKindeInactivityErasureAt } from './kinde-inactivity-time.mjs';

/** @typedef {{generation: number, lastRecordedAtMs: number, eligibleAtMs: number}} InactivityEvidence */
/** @typedef {{uid: string, authEpoch: number, receiptHash: string, authenticatedAtMs: number | null, confirmedAtMs: number, inactivity?: InactivityEvidence}} ErasureIntent */
const UID = /^k_[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
export const INTENT_COLUMNS = 'uid, auth_epoch, receipt_hash, reauthenticated_at_ms, confirmed_at_ms, inactivity_generation, inactivity_recorded_at_ms, inactivity_eligible_at_ms';
export const QUALIFIED_INTENT_COLUMNS = INTENT_COLUMNS.split(', ').map(column => 'i.' + column).join(', ');

// Bind the exact immutable decision at each irreversible boundary.
export const INTENT_SCOPE = `i.uid = ? AND i.auth_epoch = ? AND i.receipt_hash = ?
  AND i.reauthenticated_at_ms IS ? AND i.confirmed_at_ms = ?
  AND i.inactivity_generation IS ? AND i.inactivity_recorded_at_ms IS ?
  AND i.inactivity_eligible_at_ms IS ?`;

/** @param {ErasureIntent} intent */
export function intentScopeArgs(intent) {
  return [intent.uid, intent.authEpoch, intent.receiptHash, intent.authenticatedAtMs, intent.confirmedAtMs,
    intent.inactivity?.generation ?? null, intent.inactivity?.lastRecordedAtMs ?? null,
    intent.inactivity?.eligibleAtMs ?? null];
}

/** @param {ErasureIntent} intent */
export function validErasureIntent(intent) {
  if (!intent || typeof intent.uid !== 'string' || !UID.test(intent.uid)
    || typeof intent.receiptHash !== 'string' || !HASH.test(intent.receiptHash)
    || !Number.isSafeInteger(intent.authEpoch) || intent.authEpoch < 1 || intent.authEpoch >= Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(intent.confirmedAtMs) || intent.confirmedAtMs <= 0) return false;
  if (intent.authenticatedAtMs !== null) {
    return intent.inactivity === undefined && Number.isSafeInteger(intent.authenticatedAtMs)
      && intent.authenticatedAtMs > 0 && intent.authenticatedAtMs % 1000 === 0
      && intent.confirmedAtMs >= intent.authenticatedAtMs
      && intent.confirmedAtMs - intent.authenticatedAtMs <= 300000;
  }
  const evidence = intent.inactivity;
  return !!evidence && Number.isSafeInteger(evidence.generation) && evidence.generation >= 1
    && Number.isSafeInteger(evidence.eligibleAtMs)
    && earliestKindeInactivityErasureAt(evidence.lastRecordedAtMs) === evidence.eligibleAtMs
    && intent.confirmedAtMs >= evidence.eligibleAtMs;
}

/** @param {any} row @returns {ErasureIntent | null} */
export function intentFromRow(row) {
  if (!row) return null;
  /** @type {ErasureIntent} */
  const intent = { uid: row.uid, authEpoch: row.auth_epoch, receiptHash: row.receipt_hash,
    authenticatedAtMs: row.reauthenticated_at_ms, confirmedAtMs: row.confirmed_at_ms };
  if (row.reauthenticated_at_ms === null) {
    intent.inactivity = { generation: row.inactivity_generation,
      lastRecordedAtMs: row.inactivity_recorded_at_ms, eligibleAtMs: row.inactivity_eligible_at_ms };
  } else if ([row.inactivity_generation, row.inactivity_recorded_at_ms, row.inactivity_eligible_at_ms]
    .some(value => value !== null)) return null;
  return validErasureIntent(intent) ? intent : null;
}

/** @param {ErasureIntent} intent @param {any} row */
export function matchesErasureIntent(intent, row) {
  const stored = intentFromRow(row);
  return !!stored && validErasureIntent(intent)
    && intentScopeArgs(intent).every((value, index) => value === intentScopeArgs(stored)[index]);
}

/** @param {any} db @param {string} uid @param {number} epoch @param {string} receipt */
export async function readErasureIntent(db, uid, epoch, receipt) {
  return db.withSession('first-primary').prepare(`
    SELECT ${INTENT_COLUMNS} FROM kinde_account_erasure_intents
    WHERE uid = ? AND auth_epoch = ? AND receipt_hash = ?
  `).bind(uid, epoch, receipt).first();
}
