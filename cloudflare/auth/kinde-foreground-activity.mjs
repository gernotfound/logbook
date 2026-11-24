import { D1_NOW_MS } from '../sql/d1-time.mjs';
import { ACTIVITY_WRITE_INTERVAL_MS } from '../jobs/kinde-inactivity-time.mjs';

const UID = /^k_[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
const SESSION_SOURCE = 'FROM auth_principals p JOIN auth_sessions t ON p.uid = t.uid AND p.auth_epoch = t.auth_epoch';
const AUTHENTICATED_SESSION = `
  WHERE p.uid = ? AND p.auth_epoch = ? AND t.token_hash = ?
    AND p.status = 'active' AND t.revoked_at_ms IS NULL
    AND t.issued_at_ms <= ${D1_NOW_MS}
    AND t.idle_expires_at_ms > ${D1_NOW_MS} AND t.absolute_expires_at_ms > ${D1_NOW_MS}
`;

/**
 * Called only by a dedicated, same-origin foreground endpoint after private
 * Auth Gate and CSRF verification. Sync, token refresh and service workers
 * must not call this boundary. The browser supplies no activity timestamp.
 * @param {{withSession: (policy: 'first-primary') => any}} db
 * @param {{uid: string, fenceEpoch: number, sessionHash: string,
 *  authenticated: boolean, rateGatePassed: boolean, csrfVerified: boolean}} claims
 */
export async function recordKindeForegroundActivity(db, claims) {
  const { uid, fenceEpoch, sessionHash } = claims;
  if (claims.authenticated !== true || claims.rateGatePassed !== true || claims.csrfVerified !== true
    || !UID.test(uid) || !Number.isSafeInteger(fenceEpoch) || fenceEpoch < 1
    || typeof sessionHash !== 'string' || !HASH.test(sessionHash)) return { outcome: 'unauthorized' };
  let result;
  try {
    result = await db.withSession('first-primary').prepare(`
      INSERT INTO kinde_account_activity (uid, first_observed_at_ms, last_recorded_at_ms)
      SELECT p.uid, ${D1_NOW_MS}, ${D1_NOW_MS} ${SESSION_SOURCE} ${AUTHENTICATED_SESSION}
      ON CONFLICT(uid) DO UPDATE SET last_recorded_at_ms = excluded.last_recorded_at_ms
      WHERE excluded.last_recorded_at_ms - kinde_account_activity.last_recorded_at_ms >= ?
      RETURNING uid
    `).bind(uid, fenceEpoch, sessionHash, ACTIVITY_WRITE_INTERVAL_MS).first();
  } catch {
    // Resolve an ambiguous write only from a still-authorized recent marker.
  }
  if (result?.uid === uid) return { outcome: 'recorded' };

  try {
    const state = await db.withSession('first-primary').prepare(`
      SELECT p.uid, a.last_recorded_at_ms, ${D1_NOW_MS} AS observed_at_ms
      ${SESSION_SOURCE}
      LEFT JOIN kinde_account_activity a ON a.uid = p.uid
      ${AUTHENTICATED_SESSION}
    `).bind(uid, fenceEpoch, sessionHash).first();
    if (!state) return { outcome: 'unauthorized' };
    if (state.uid === uid && Number.isSafeInteger(state.last_recorded_at_ms)
      && state.last_recorded_at_ms > 0 && Number.isSafeInteger(state.observed_at_ms)
      && state.observed_at_ms >= state.last_recorded_at_ms
      && state.observed_at_ms - state.last_recorded_at_ms < ACTIVITY_WRITE_INTERVAL_MS) {
      return { outcome: 'observed' };
    }
  } catch {
    // Without primary clock and session evidence there is no acknowledgement.
  }
  return { outcome: 'unavailable' };
}
