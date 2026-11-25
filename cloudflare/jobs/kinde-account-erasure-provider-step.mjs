import { D1_NOW_MS } from '../sql/d1-time.mjs';
import { requireIndependentAccountErasureDenial } from '../recovery/account-erasure-denials.mjs';
import { runKindeAccountErasureAppStep, verifyKindeAccountErasureAppComplete } from './kinde-account-erasure-app-step.mjs';
import { createKindeErasureManagement } from './kinde-erasure-management.mjs';
import { KINDE_ERASURE_TARGET_FORMAT } from './kinde-erasure-target.mjs';

import { INTENT_SCOPE, intentScopeArgs } from './kinde-erasure-intent.mjs';

const LEASE_MS = 30_000;

const LIVE_LEASE = `
  uid = ? AND lease_epoch = ? AND lease_token = ? AND lease_until_ms > ${D1_NOW_MS}
`;

/** @param {any} db @param {Parameters<typeof requireIndependentAccountErasureDenial>[1]} intent */
async function readCompletion(db, intent) {
  const row = await db.withSession('first-primary').prepare(`
    SELECT c.completed_at_ms
    FROM kinde_account_erasure_completions c
    JOIN kinde_account_erasure_requests r ON r.uid = c.uid
    JOIN kinde_account_erasure_intents i ON i.uid = r.uid
    JOIN auth_principals p ON p.uid = r.uid
    WHERE ${INTENT_SCOPE}
      AND p.status = 'deleted' AND p.auth_epoch = r.prior_auth_epoch + 1
      AND NOT EXISTS (SELECT 1 FROM kinde_erasure_targets t WHERE t.uid = c.uid)
  `).bind(...intentScopeArgs(intent)).first();
  return Number.isSafeInteger(row?.completed_at_ms) && row.completed_at_ms > 0 ? row.completed_at_ms : null;
}

/** @param {any} primary @param {string} uid */
async function claimProviderLease(primary, uid) {
  const seeded = await primary.prepare(`
    INSERT INTO kinde_account_erasure_provider_progress (uid)
    SELECT ? WHERE EXISTS (SELECT 1 FROM kinde_account_erasure_requests WHERE uid = ?)
      AND NOT EXISTS (SELECT 1 FROM kinde_account_erasure_provider_progress WHERE uid = ?)
  `).bind(uid, uid, uid).run();
  if (seeded?.success !== true || ![0, 1].includes(seeded.meta?.changes)) {
    throw new Error('kinde-erasure-provider-unavailable');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  bytes.fill(0);
  return primary.prepare(`
    UPDATE kinde_account_erasure_provider_progress
    SET lease_epoch = lease_epoch + 1, lease_token = ?, lease_until_ms = ${D1_NOW_MS} + ?
    WHERE uid = ? AND lease_until_ms <= ${D1_NOW_MS}
      AND lease_epoch < 9007199254740991
      AND NOT EXISTS (SELECT 1 FROM kinde_account_erasure_completions WHERE uid = ?)
    RETURNING lease_epoch, lease_token, delete_acknowledged_at_ms
  `).bind(token, LEASE_MS, uid, uid).first();
}

/**
 * Candidate worker step. The caller supplies a short-lived scoped Management
 * token from trusted deployment configuration, never from a browser request.
 * No acknowledgement, timeout or unqualified absence alone is terminal proof.
 * @param {Parameters<typeof runKindeAccountErasureAppStep>[0]} db
 * @param {Parameters<typeof runKindeAccountErasureAppStep>[1]} recoveryDb
 * @param {Parameters<typeof runKindeAccountErasureAppStep>[2]} intent
 * @param {{
 *   issuer: string, accessToken: string, fetchImpl: typeof fetch,
 *   codec: ReturnType<typeof import('./kinde-erasure-target.mjs').createKindeErasureTargetCodec>,
 * }} dependencies
 */
export async function runKindeAccountErasureProviderStep(db, recoveryDb, intent, dependencies) {
  if (!db || !recoveryDb || db === recoveryDb) throw new Error('kinde-erasure-provider-unavailable');
  await requireIndependentAccountErasureDenial(recoveryDb, intent);
  const completedAtMs = await readCompletion(db, intent);
  if (completedAtMs !== null) return { outcome: 'complete', completedAtMs };
  const app = await runKindeAccountErasureAppStep(db, recoveryDb, intent);
  if (app.outcome !== 'application-complete') return app;

  const { uid } = intent;
  const primary = db.withSession('first-primary');
  const lease = await claimProviderLease(primary, uid);
  if (!lease || !Number.isSafeInteger(lease.lease_epoch) || lease.lease_epoch < 1
    || !/^[a-f0-9]{64}$/.test(lease.lease_token)
    || (lease.delete_acknowledged_at_ms !== null
      && (!Number.isSafeInteger(lease.delete_acknowledged_at_ms) || lease.delete_acknowledged_at_ms <= 0))) {
    return { outcome: 'contended' };
  }
  const leaseScope = [uid, lease.lease_epoch, lease.lease_token];
  const row = await primary.prepare(`
    SELECT uid, format_version AS version, key_id AS keyId, iv, ciphertext
    FROM kinde_erasure_targets WHERE uid = ?
  `).bind(uid).first();
  if (row?.uid !== uid) throw new Error('kinde-erasure-provider-unavailable');
  const subject = await dependencies.codec.open(uid, { ...row, format: KINDE_ERASURE_TARGET_FORMAT });
  const management = createKindeErasureManagement({
    issuer: dependencies.issuer,
    fetchImpl: dependencies.fetchImpl,
    async proveTerminalFence(currentUid) {
      if (currentUid !== uid
        || (await verifyKindeAccountErasureAppComplete(db, recoveryDb, intent)).outcome !== 'application-complete') return false;
      const live = await db.withSession('first-primary').prepare(`
        SELECT uid FROM kinde_account_erasure_provider_progress WHERE ${LIVE_LEASE}
      `).bind(...leaseScope).first();
      return live?.uid === uid;
    },
  });
  const target = { uid, subject, accessToken: dependencies.accessToken };
  const presence = await management.readPresence(target);

  if (lease.delete_acknowledged_at_ms !== null) {
    if (presence !== 'absent') return { outcome: 'provider-pending' };
    let uncertain = false;
    try {
      const write = await primary.prepare(`
        INSERT INTO kinde_account_erasure_completions (uid, completed_at_ms, lease_epoch, lease_token)
        SELECT uid, ${D1_NOW_MS}, lease_epoch, lease_token
        FROM kinde_account_erasure_provider_progress WHERE ${LIVE_LEASE}
      `).bind(...leaseScope).run();
      uncertain = write?.success !== true || ![0, 1].includes(write.meta?.changes);
    } catch {
      // A lost final response may already have committed the atomic receipt.
      uncertain = true;
    }
    await requireIndependentAccountErasureDenial(recoveryDb, intent);
    const proof = await readCompletion(db, intent);
    if (proof !== null) return { outcome: 'complete', completedAtMs: proof };
    if (uncertain) throw new Error('kinde-erasure-provider-unavailable');
    return { outcome: 'contended' };
  }

  if (presence !== 'present') return { outcome: 'provider-unconfirmed' };
  const started = await primary.prepare(`
    UPDATE kinde_account_erasure_provider_progress
    SET present_at_ms = COALESCE(present_at_ms, ${D1_NOW_MS}),
      delete_started_at_ms = COALESCE(delete_started_at_ms, ${D1_NOW_MS})
    WHERE ${LIVE_LEASE} AND delete_acknowledged_at_ms IS NULL
    RETURNING uid
  `).bind(...leaseScope).first();
  if (started?.uid !== uid) return { outcome: 'contended' };
  if (await management.requestErasure(target) !== 'acknowledged') return { outcome: 'provider-unconfirmed' };
  const acknowledged = await primary.prepare(`
    UPDATE kinde_account_erasure_provider_progress
    SET delete_acknowledged_at_ms = ${D1_NOW_MS}, lease_until_ms = 0
    WHERE ${LIVE_LEASE} AND delete_acknowledged_at_ms IS NULL
    RETURNING uid
  `).bind(...leaseScope).first();
  return { outcome: acknowledged?.uid === uid ? 'provider-acknowledged' : 'contended' };
}
