import { createKindeLoginProofVerifier } from './kinde-login-proof.mjs';

const UID_CONTEXT = 'thelogbook:kinde-owner:v1\0';

export class KindePrincipalProvisionError extends Error {
  constructor() {
    super('kinde-principal-unavailable');
    this.name = 'KindePrincipalProvisionError';
  }
}

/**
 * Internal callback-only boundary. The caller MUST consume its server-owned
 * OAuth state exactly once and supply the saved nonce after a successful
 * authorization-code/PKCE exchange. Never expose this to a request with a
 * client-chosen nonce or use it as a standalone login endpoint. Pass the saved
 * nonce separately from the tokens returned by the browser.
 *
 * A domain-separated digest of (issuer, subject) is the stable new-baseline
 * owner ID. It contains neither email nor health data and avoids an
 * unverified, client-provided UID or a race between separate identity tables.
 * Deleted/disabled principals are not recreated or reactivated on sign-in.
 */
export function createKindePrincipalProvisioner(configuration, keySet) {
  const verifyLoginProof = createKindeLoginProofVerifier(configuration, keySet);
  return async function provisionVerifiedPrincipal(db, oauthTokens, trustedNonce) {
    try {
      if (!db || typeof db.withSession !== 'function') throw new Error('missing-db');
      const identity = await verifyLoginProof({
        accessToken: oauthTokens?.accessToken,
        idToken: oauthTokens?.idToken,
        expectedNonce: trustedNonce,
      });
      if (identity.emailVerified !== true) throw new Error('unverified-identity');
      const bytes = new TextEncoder().encode(
        UID_CONTEXT + identity.issuer + '\0' + identity.subject,
      );
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const uid = 'k_' + btoa(String.fromCharCode(...digest))
        .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
      const nowMs = Date.now();
      if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error('clock-unavailable');

      // The read follows the insert on one primary-started D1 session.
      // An ambiguous/failed write never returns a UID or an auth success.
      const session = db.withSession('first-primary');
      const inserted = await session.prepare(`
        INSERT INTO auth_principals(uid, status, verified_at_ms, auth_epoch)
        VALUES (?, 'active', ?, 1)
        ON CONFLICT(uid) DO NOTHING
      `).bind(uid, nowMs).run();
      if (inserted?.success !== true
        || ![0, 1].includes(inserted.meta?.changes)) {
        throw new Error('unproven-insert');
      }
      const principal = await session.prepare(`
        SELECT uid, status, verified_at_ms, auth_epoch
        FROM auth_principals WHERE uid = ?
      `).bind(uid).first();
      if (principal?.uid !== uid || principal.status !== 'active'
        || !Number.isSafeInteger(principal.verified_at_ms)
        || principal.verified_at_ms <= 0 || principal.verified_at_ms > nowMs
        || !Number.isSafeInteger(principal.auth_epoch)
        || principal.auth_epoch < 1) {
        throw new Error('principal-not-active');
      }
      return Object.freeze({ uid });
    } catch {
      throw new KindePrincipalProvisionError();
    }
  };
}
