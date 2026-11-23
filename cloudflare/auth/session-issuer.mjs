import { hashSessionSecret } from './session-gate.mjs';
import { D1_NOW_MS } from '../sql/d1-time.mjs';

const SESSION_COOKIE = '__Host-logbook_session';
const IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class SessionIssuanceError extends Error {
  constructor() {
    super('session-issuance-unavailable');
    this.name = 'SessionIssuanceError';
  }
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const base64 = btoa(String.fromCharCode(...bytes));
  bytes.fill(0);
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Called ONLY after trusted password/Google authentication and confirmed email
 * ownership. It does not prove credentials itself, and must never be mounted
 * as a public endpoint accepting an arbitrary uid. Sessions are valid only for
 * the current principal epoch; the separate sync gate also requires consent.
 */
export async function issueVerifiedSession(db, authenticatedUid) {
  if (!db || typeof db.prepare !== 'function' ||
    typeof authenticatedUid !== 'string' || authenticatedUid.length < 1 ||
    authenticatedUid.length > 128 || authenticatedUid.includes('/') ||
    authenticatedUid.trim() !== authenticatedUid) {
    throw new SessionIssuanceError();
  }

  const sessionToken = randomToken();
  const csrfToken = randomToken();
  try {
    // A single conditional INSERT is atomic with a concurrent principal
    // revocation: a stale epoch either cannot be inserted or is rejected by
    // the read-side session gate. No unverified or disabled principal can mint.
    // Use the same clock as the subsequent D1 authorization predicates.
    // SQLite resolves 'now' once per statement, including both TTL boundaries.
    const result = await db.prepare(`
      WITH clock(now_ms) AS (SELECT ${D1_NOW_MS})
      INSERT INTO auth_sessions (
        token_hash, uid, auth_epoch, csrf_hash,
        issued_at_ms, idle_expires_at_ms, absolute_expires_at_ms
      )
      SELECT ?, p.uid, p.auth_epoch, ?, clock.now_ms, clock.now_ms + ?, clock.now_ms + ?
      FROM auth_principals p CROSS JOIN clock
      WHERE p.uid = ? AND p.status = 'active'
        AND p.verified_at_ms > 0 AND p.verified_at_ms <= clock.now_ms
        AND clock.now_ms > 0 AND clock.now_ms <= ?
      RETURNING issued_at_ms, idle_expires_at_ms, absolute_expires_at_ms
    `).bind(
      await hashSessionSecret(sessionToken), await hashSessionSecret(csrfToken),
      IDLE_TTL_MS, ABSOLUTE_TTL_MS, authenticatedUid, Number.MAX_SAFE_INTEGER - ABSOLUTE_TTL_MS,
    ).first();
    if (!result || !Number.isSafeInteger(result.issued_at_ms) || result.issued_at_ms <= 0
      || !Number.isSafeInteger(result.idle_expires_at_ms)
      || !Number.isSafeInteger(result.absolute_expires_at_ms)
      || result.idle_expires_at_ms - result.issued_at_ms !== IDLE_TTL_MS
      || result.absolute_expires_at_ms - result.issued_at_ms !== ABSOLUTE_TTL_MS) {
      throw new SessionIssuanceError();
    }
    return {
      // The non-HttpOnly, host-only CSRF cookie survives reload/new tabs;
      // browser code sends its value in X-CSRF-Token. Only the session cookie
      // grants authentication, and its corresponding CSRF hash is in D1.
      setCookies: [
        SESSION_COOKIE + '=' + sessionToken +
          '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + IDLE_TTL_MS / 1000,
        '__Host-logbook_csrf=' + csrfToken +
          '; Path=/; Secure; SameSite=Lax; Max-Age=' + IDLE_TTL_MS / 1000,
      ],
      idleExpiresAtMs: result.idle_expires_at_ms,
      absoluteExpiresAtMs: result.absolute_expires_at_ms,
    };
  } catch {
    // The caller must not return an auth success or cookie after a failed or
    // ambiguous insert. A lost response may leave an expiring orphan session,
    // but cannot authorize a different principal or fabricated login.
    throw new SessionIssuanceError();
  }
}
