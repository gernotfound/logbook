import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createKindeAccessTokenVerifier } from './kinde-token-verifier.mjs';

const MAX_ID_TOKEN_BYTES = 8192;
const MAX_ID_TOKEN_AGE_SECONDS = 3600;
const CLOCK_TOLERANCE_SECONDS = 5;
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const OAUTH_NONCE = /^[A-Za-z0-9_-]{43}$/;

async function sha256AtHash(accessToken) {
  const bytes = new TextEncoder().encode(accessToken);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return btoa(String.fromCharCode(...digest.subarray(0, digest.length / 2)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * This proof is for an already completed, trusted OAuth code+PKCE exchange.
 * The caller MUST first consume server-owned state once and retrieve its
 * original nonce; never take expectedNonce from untrusted callback input.
 * The ID token audience can differ from the API audience in Kinde and
 * therefore is pinned independently. This helper does not create D1 sessions.
 *
 * @param {{issuer: string, apiAudience: string, idTokenAudience: string, clientId: string}} configuration
 * @param {(header: import('jose').JWSHeaderParameters, token: import('jose').FlattenedJWSInput) => Promise<import('jose').KeyLike | Uint8Array>} [keySet]
 */
export function createKindeLoginProofVerifier(configuration, keySet) {
  const { issuer, apiAudience, idTokenAudience, clientId } = configuration ?? {};
  if (typeof issuer !== 'string'
    || typeof idTokenAudience !== 'string'
    || !idTokenAudience.trim()
    || idTokenAudience.length > 512
    || idTokenAudience.trim() !== idTokenAudience) {
    throw new TypeError('invalid-kinde-login-configuration');
  }
  const jwks = keySet ?? createRemoteJWKSet(new URL(issuer + '/.well-known/jwks'), {
    timeoutDuration: 3000,
    cooldownDuration: 30000,
    cacheMaxAge: 600000,
  });
  const verifyAccessToken = createKindeAccessTokenVerifier(
    { issuer, audience: apiAudience, clientId }, jwks,
  );
  return async function verifyKindeLoginProof({ accessToken, idToken, expectedNonce } = {}) {
    if (typeof expectedNonce !== 'string' || !OAUTH_NONCE.test(expectedNonce)
      || typeof accessToken !== 'string'
      || typeof idToken !== 'string'
      || idToken.length > MAX_ID_TOKEN_BYTES
      || !COMPACT_JWS.test(idToken)) {
      throw new Error('invalid-kinde-login-proof');
    }
    try {
      const access = await verifyAccessToken(accessToken);
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer, audience: idTokenAudience, algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      const now = Math.floor(Date.now() / 1000);
      if (payload.azp !== clientId || payload.nonce !== expectedNonce
        || payload.sub !== access.subject || payload.email_verified !== true
        || typeof payload.email !== 'string'
        || payload.email.length < 3 || payload.email.length > 320
        || !payload.email.includes('@') || /\s/.test(payload.email)
        || typeof payload.auth_time !== 'number'
        || !Number.isSafeInteger(payload.auth_time)
        || payload.auth_time <= 0
        || payload.auth_time > now + CLOCK_TOLERANCE_SECONDS
        || !Number.isSafeInteger(payload.iat)
        || !Number.isSafeInteger(payload.exp)
        || payload.iat > now + CLOCK_TOLERANCE_SECONDS
        || payload.auth_time > payload.iat + CLOCK_TOLERANCE_SECONDS
        || payload.exp <= now
        || payload.exp <= payload.iat
        || payload.exp - payload.iat > MAX_ID_TOKEN_AGE_SECONDS) {
        throw new Error('invalid-kinde-id-claims');
      }
      // at_hash is optional for the Authorization Code flow. If supplied,
      // validate its binding to the access token instead of ignoring it.
      if (payload.at_hash !== undefined
        && (typeof payload.at_hash !== 'string'
          || payload.at_hash !== await sha256AtHash(accessToken))) {
        throw new Error('invalid-kinde-token-binding');
      }
      return Object.freeze({
        issuer: access.issuer, subject: access.subject, emailVerified: true,
      });
    } catch {
      throw new Error('invalid-kinde-login-proof');
    }
  };
}
