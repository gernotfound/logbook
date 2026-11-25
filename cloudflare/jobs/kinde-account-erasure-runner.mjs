import { acceptKindeAccountErasure } from './kinde-account-erasure-requests.mjs';
import { runKindeAccountErasureAppStep } from './kinde-account-erasure-app-step.mjs';
import { runKindeAccountErasureProviderStep } from './kinde-account-erasure-provider-step.mjs';

const UID = /^k_[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;

/**
 * Candidate-only dispatcher: one intent row per tick, including terminal
 * rows. Keyset traversal of the primary key bounds reads even if most
 * historical intents are already complete. The scheduler must persist its
 * cursor, advance on blocked rows and start a new sweep at null. The cursor
 * is not an authorization, lease, or proof of completion.
 *
 * @param {Parameters<typeof acceptKindeAccountErasure>[0]} db
 * @param {Parameters<typeof acceptKindeAccountErasure>[1]} recoveryDb
 * @param {string | null} [after]
 * @param {Parameters<typeof runKindeAccountErasureProviderStep>[3] | null} [provider]
 */
export async function runOneKindeAccountErasureStep(db, recoveryDb, after = null, provider = null) {
  if (!db || !recoveryDb || db === recoveryDb) throw new Error('kinde-erasure-runner-unavailable');
  if (after !== null && (typeof after !== 'string' || !UID.test(after))) {
    throw new TypeError('invalid-kinde-erasure-runner-cursor');
  }
  const row = await db.withSession('first-primary').prepare(`
    SELECT i.uid, i.auth_epoch, i.receipt_hash, i.reauthenticated_at_ms, i.confirmed_at_ms,
      CASE WHEN r.uid IS NULL THEN 0 ELSE 1 END AS accepted,
      CASE WHEN c.uid IS NULL THEN 0 ELSE 1 END AS recorded
    FROM kinde_account_erasure_intents i
    LEFT JOIN kinde_account_erasure_requests r ON r.uid = i.uid
    LEFT JOIN kinde_account_erasure_completions c ON c.uid = i.uid
    WHERE i.uid > ?
    ORDER BY i.uid LIMIT 1
  `).bind(after ?? '').first();
  if (row === null) return { nextCursor: null, result: { outcome: 'idle' } };
  if (typeof row?.uid !== 'string' || !UID.test(row.uid) || row.uid <= (after ?? '')
    || typeof row.receipt_hash !== 'string' || !HASH.test(row.receipt_hash)
    || !Number.isSafeInteger(row.auth_epoch) || row.auth_epoch < 1 || row.auth_epoch >= Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(row.reauthenticated_at_ms) || row.reauthenticated_at_ms <= 0
    || row.reauthenticated_at_ms % 1000 !== 0
    || !Number.isSafeInteger(row.confirmed_at_ms) || row.confirmed_at_ms < row.reauthenticated_at_ms
    || row.confirmed_at_ms - row.reauthenticated_at_ms > 300000
    || ![0, 1].includes(row.accepted) || ![0, 1].includes(row.recorded)
    || (row.recorded === 1 && row.accepted !== 1)) {
    throw new Error('kinde-erasure-runner-unavailable');
  }
  const nextCursor = row.uid;
  // A recorded terminal row is skipped, not exposed as a fresh receipt.
  if (row.recorded === 1) return { nextCursor, result: { outcome: 'already-recorded' } };
  const intent = {
    uid: row.uid, authEpoch: row.auth_epoch, receiptHash: row.receipt_hash,
    authenticatedAtMs: row.reauthenticated_at_ms, confirmedAtMs: row.confirmed_at_ms,
  };
  try {
    if (row.accepted === 0) {
      const accepted = await acceptKindeAccountErasure(db, recoveryDb, intent);
      return { nextCursor, result: { outcome: accepted ? 'accepted' : 'contended' } };
    }
    const result = provider === null
      ? await runKindeAccountErasureAppStep(db, recoveryDb, intent)
      : await runKindeAccountErasureProviderStep(db, recoveryDb, intent, provider);
    return { nextCursor, result };
  } catch {
    // A blocked owner must not starve the rest of the sweep. Its durable
    // intent remains for the next sweep; no failure becomes a receipt.
    return { nextCursor, result: { outcome: 'blocked' } };
  }
}
