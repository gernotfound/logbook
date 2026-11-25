import {
  reconcileAccountErasureHealthFence, requireIndependentAccountErasureDenial,
} from '../recovery/account-erasure-denials.mjs';
import {
  recordVerifiedTerminalErasure, requireIndependentOwnerFence,
} from '../recovery/independent-owner-fence.mjs';

import { ACCOUNT_AUTH_CLEANUP_TABLES, HEALTH_CHILD_TABLES } from './erasure-tables.mjs';

const CHUNK_SIZE = 16;
const JOB_SOURCE = `
  FROM kinde_account_erasure_requests r
  JOIN kinde_account_erasure_intents i ON i.uid = r.uid
  JOIN auth_principals p ON p.uid = r.uid
`;
const SCOPE = `
  WHERE r.uid = ? AND r.receipt_hash = ? AND i.auth_epoch = ?
    AND p.status = 'disabled' AND p.auth_epoch = r.prior_auth_epoch + 1
`;

function deleteSessionRowsSql({ name, key }) {
  // Identifiers are drawn only from ACCOUNT_AUTH_CLEANUP_TABLES, never from external input.
  return `
    DELETE FROM ${name}
    WHERE uid = ? AND ${key} IN (
      SELECT ${key} FROM ${name} WHERE uid = ? ORDER BY ${key} LIMIT ${CHUNK_SIZE}
    ) AND EXISTS (SELECT 1 ${JOB_SOURCE} ${SCOPE})
  `;
}

/**
 * One bounded step before any Management API call. An accepted request alone
 * does not prove that sessions, ciphertext or the wrapped health key are gone.
 * @param {{withSession: (policy: 'first-primary') => any}} appDb
 * @param {Parameters<typeof requireIndependentAccountErasureDenial>[0]} recoveryDb
 * @param {Parameters<typeof requireIndependentAccountErasureDenial>[1]} intent
 */
export async function runKindeAccountErasureAppStep(appDb, recoveryDb, intent) {
  if (!appDb || !recoveryDb || appDb === recoveryDb) throw new Error('kinde-erasure-application-unavailable');
  await requireIndependentAccountErasureDenial(recoveryDb, intent);
  const scope = [intent.uid, intent.receiptHash, intent.authEpoch];
  const primary = appDb.withSession('first-primary');
  const accepted = await primary.prepare(`SELECT r.uid ${JOB_SOURCE} ${SCOPE}`).bind(...scope).first();
  if (accepted?.uid !== intent.uid) return { outcome: 'contended' };

  for (const table of ACCOUNT_AUTH_CLEANUP_TABLES) {
    const result = await primary.prepare(deleteSessionRowsSql(table)).bind(intent.uid, intent.uid, ...scope).run();
    const removed = result?.meta?.changes;
    if (result?.success !== true || !Number.isSafeInteger(removed) || removed < 0 || removed > CHUNK_SIZE) {
      throw new Error('kinde-erasure-application-unavailable');
    }
    if (removed > 0) return { outcome: 'progress', removed };
  }

  return verifyKindeAccountErasureAppComplete(appDb, recoveryDb, intent);
}

/**
 * Recertify cleanup and the current independent floor immediately before a
 * provider request. A restored application database cannot reuse old proof.
 * @param {Parameters<typeof runKindeAccountErasureAppStep>[0]} appDb
 * @param {Parameters<typeof runKindeAccountErasureAppStep>[1]} recoveryDb
 * @param {Parameters<typeof runKindeAccountErasureAppStep>[2]} intent
 */
export async function verifyKindeAccountErasureAppComplete(appDb, recoveryDb, intent) {
  if (!appDb || !recoveryDb || appDb === recoveryDb) throw new Error('kinde-erasure-application-unavailable');
  const scope = [intent.uid, intent.receiptHash, intent.authEpoch];
  const observed = await appDb.withSession('first-primary').prepare(`
    SELECT r.uid, s.status, s.consent_revision, s.fence_epoch, s.erased_before_revision,
      CASE WHEN s.uid IS NULL AND (
        ${HEALTH_CHILD_TABLES.map(name => `EXISTS (SELECT 1 FROM ${name} WHERE uid = r.uid)`).join(' OR ')}
      ) THEN 1 ELSE 0 END AS orphan_health_rows
    ${JOB_SOURCE}
    LEFT JOIN sync_subjects s ON s.uid = r.uid
    ${SCOPE}
      ${ACCOUNT_AUTH_CLEANUP_TABLES.map(({ name }) => `AND NOT EXISTS (SELECT 1 FROM ${name} WHERE uid = r.uid)`).join('\n')}
  `).bind(...scope).first();
  if (observed?.uid !== intent.uid) return { outcome: 'contended' };
  if (observed.orphan_health_rows !== 0) throw new Error('kinde-erasure-application-unavailable');
  if (observed.status !== null) {
    if (observed.status !== 'withdrawn' || !Number.isSafeInteger(observed.consent_revision)
      || observed.consent_revision < 2 || observed.erased_before_revision !== observed.consent_revision) {
      if (observed.status === 'withdrawn' && observed.consent_revision === 1
        && observed.erased_before_revision === 0) {
        await reconcileAccountErasureHealthFence(appDb, recoveryDb, intent);
      }
      return { outcome: 'health-pending' };
    }
    const floor = await recordVerifiedTerminalErasure(appDb, recoveryDb, intent.uid, {
      uid: intent.uid, consent_revision: observed.consent_revision - 1, fence_epoch: observed.fence_epoch - 1,
    });
    await requireIndependentOwnerFence(recoveryDb, floor, 'terminal');
  }
  await requireIndependentAccountErasureDenial(recoveryDb, intent);
  return { outcome: 'application-complete' };
}
