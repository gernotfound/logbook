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
  if (!db || typeof db.withSession !== 'function' ||
    typeof authenticatedUid !== 'string' || authenticatedUid.length < 1 ||
    authenticatedUid.length > 128 || authenticatedUid.includes('/') ||
    authenticatedUid.trim() !== authenticatedUid) {
    throw new SessionIssuanceError();
  }

  const sessionToken = randomToken();
  const csrfToken = randomToken();
  try {
    const tokenHash = await hashSessionSecret(sessionToken);
    const csrfHash = await hashSessionSecret(csrfToken);
    const primary = db.withSession('first-primary');
    if (!primary || typeof primary.prepare !== 'function' || typeof primary.batch !== 'function') {
      throw new SessionIssuanceError();
    }
    // D1 batch is one SQLite transaction. A later login revokes prior sessions
    // for this owner only AFTER its own conditional issuance succeeds; failed
    // issuance rolls everything back. Concurrent Workers serialize these writes
    // on the primary so they cannot leave two active browser sessions.
    const statements = [primary.prepare(`
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
    `).bind(
      tokenHash, csrfHash,
      IDLE_TTL_MS, ABSOLUTE_TTL_MS, authenticatedUid, Number.MAX_SAFE_INTEGER - ABSOLUTE_TTL_MS,
    ), primary.prepare(`
      UPDATE auth_sessions SET revoked_at_ms = MAX(issued_at_ms, ${D1_NOW_MS})
      WHERE uid = ? AND token_hash != ? AND revoked_at_ms IS NULL
        AND EXISTS (SELECT 1 FROM auth_sessions issued
          WHERE issued.token_hash = ? AND issued.uid = ? AND issued.revoked_at_ms IS NULL)
    `).bind(authenticatedUid, tokenHash, tokenHash, authenticatedUid), primary.prepare(`
      SELECT t.issued_at_ms, t.idle_expires_at_ms, t.absolute_expires_at_ms
      FROM auth_sessions t JOIN auth_principals p ON p.uid = t.uid
      WHERE t.token_hash = ? AND t.uid = ? AND t.csrf_hash = ? AND t.revoked_at_ms IS NULL
        AND p.status = 'active' AND p.auth_epoch = t.auth_epoch
        AND p.verified_at_ms > 0 AND p.verified_at_ms <= ${D1_NOW_MS}
        AND NOT EXISTS (SELECT 1 FROM auth_sessions older
          WHERE older.uid = t.uid AND older.token_hash != t.token_hash AND older.revoked_at_ms IS NULL)
    `).bind(tokenHash, authenticatedUid, csrfHash)];
    const results = await primary.batch(statements);
    const confirmed = results?.[2]?.results;
    const result = Array.isArray(confirmed) && confirmed.length === 1 ? confirmed[0] : null;
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
    // Lost batch responses must never produce a cookie. A committed new login
    // can invalidate an older session even if its own response is lost; the
    // browser must start a fresh verified login, never infer success.
    throw new SessionIssuanceError();
  }
}
