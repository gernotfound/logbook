import { acceptKindeAccountErasure } from './kinde-account-erasure-requests.mjs';
import { runKindeAccountErasureAppStep } from './kinde-account-erasure-app-step.mjs';
import { runKindeAccountErasureProviderStep } from './kinde-account-erasure-provider-step.mjs';

import { QUALIFIED_INTENT_COLUMNS, intentFromRow } from './kinde-erasure-intent.mjs';
import { D1_NOW_MS } from '../sql/d1-time.mjs';

const UID = /^k_[A-Za-z0-9_-]{43}$/;


/**
 * Candidate-only dispatcher: one intent row per tick, including terminal
 * rows. Keyset traversal of the primary key bounds reads even if most
 * historical intents are already complete. The separate durable sweep
 * checkpoint advances on blocked rows and starts a new sweep at null. The cursor
 * is not an authorization, lease, or proof of completion.
 *
 * @param {Parameters<typeof acceptKindeAccountErasure>[0]} db
 * @param {Parameters<typeof acceptKindeAccountErasure>[1]} recoveryDb
 * @param {string | null} [after]
 * @param {Parameters<typeof runKindeAccountErasureProviderStep>[3] | null} [provider]
 * @param {number | null} [expectedRecoveryGeneration]
 */
export async function runOneKindeAccountErasureStep(db, recoveryDb, after = null, provider = null, expectedRecoveryGeneration = null) {
  if (!db || !recoveryDb || db === recoveryDb) throw new Error('kinde-erasure-runner-unavailable');
  if (after !== null && (typeof after !== 'string' || !UID.test(after))) {
    throw new TypeError('invalid-kinde-erasure-runner-cursor');
  }
  const row = await db.withSession('first-primary').prepare(`
    SELECT ${QUALIFIED_INTENT_COLUMNS},
      CASE WHEN r.uid IS NULL THEN 0 ELSE 1 END AS accepted,
      CASE WHEN c.uid IS NULL THEN 0 ELSE 1 END AS recorded,
      CASE WHEN retry.retry_after_ms > ${D1_NOW_MS} THEN 1 ELSE 0 END AS deferred
    FROM kinde_account_erasure_intents i
    LEFT JOIN kinde_account_erasure_requests r ON r.uid = i.uid
    LEFT JOIN kinde_account_erasure_completions c ON c.uid = i.uid
    LEFT JOIN kinde_account_erasure_retries retry ON retry.uid = i.uid
    WHERE i.uid > ?
    ORDER BY i.uid LIMIT 1
  `).bind(after ?? '').first();
  if (row === null) return { nextCursor: null, result: { outcome: 'idle' } };
  const intent = intentFromRow(row);
  if (!intent || intent.uid <= (after ?? '') || ![0, 1].includes(row.accepted) || ![0, 1].includes(row.recorded)
    || ![0, 1].includes(row.deferred)
    || (row.recorded === 1 && row.accepted !== 1)) {
    throw new Error('kinde-erasure-runner-unavailable');
  }
  const nextCursor = row.uid;
  // A recorded terminal row is skipped, not exposed as a fresh receipt.
  if (row.recorded === 1) return { nextCursor, result: { outcome: 'already-recorded' } };
  if (row.deferred === 1) return { nextCursor, result: { outcome: 'deferred' } };
  try {
    if (row.accepted === 0) {
      const accepted = await acceptKindeAccountErasure(db, recoveryDb, intent, expectedRecoveryGeneration);
      return { nextCursor, result: { outcome: accepted ? 'accepted' : 'contended' } };
    }
    const result = provider === null
      ? await runKindeAccountErasureAppStep(db, recoveryDb, intent, expectedRecoveryGeneration)
      : await runKindeAccountErasureProviderStep(db, recoveryDb, intent, provider, expectedRecoveryGeneration);
    return { nextCursor, result };
  } catch {
    // A blocked owner must not starve the rest of the sweep. Its durable
    // intent remains for the next sweep; no failure becomes a receipt.
    return { nextCursor, result: { outcome: 'blocked' } };
  }
}
