import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createKindeCodeExchangeAccessTokenVerifier, KindeAccessTokenError } from './kinde-token-verifier.mjs';
import { deriveKindeOwnerId } from './kinde-owner-id.mjs';

const MAX_ID_TOKEN_BYTES = 8192;
const MAX_ID_TOKEN_AGE_SECONDS = 3600;
const CLOCK_TOLERANCE_SECONDS = 5;
const MAX_DELETION_REAUTH_AGE_MS = 5 * 60 * 1000;
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const OAUTH_NONCE = /^[A-Za-z0-9_-]{43}$/;

export class KindeLoginProofError extends Error {
  constructor(phase) {
    super('invalid-kinde-login-proof');
    this.name = 'KindeLoginProofError';
    this.phase = phase;
  }
}

// Only classify jose's own structured error codes. Do not echo .message,
// payloads, headers, claims or URL details across the public OAuth boundary.
function idTokenFailurePhase(error) {
  switch (error?.code) {
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      if (error.claim === 'aud') return 'id-token-audience';
      if (error.claim === 'iss') return 'id-token-issuer';
      return 'id-token';
    case 'ERR_JWT_EXPIRED':
      return 'id-token-expired';
    case 'ERR_JWKS_NO_MATCHING_KEY':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
    case 'ERR_JWKS_TIMEOUT':
      return 'id-token-key';
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return 'id-token-signature';
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
      return 'id-token-algorithm';
    default:
      return 'id-token';
  }
}

async function sha256AtHash(accessToken) {
  const bytes = new TextEncoder().encode(accessToken);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return btoa(String.fromCharCode(...digest.subarray(0, digest.length / 2)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * This identity proof is for an already completed, trusted OAuth code+PKCE exchange.
 * The caller MUST first consume server-owned state once and retrieve its
 * original nonce; never take expectedNonce from untrusted callback input.
 * A successful identity proof alone grants neither verified-email privileges
 * nor a D1 session; the ordinary login wrapper retains its verified-only gate.
 * The code-exchanged access token is only used here, immediately with
 * signed ID-token nonce, email and client proofs. It is never a reusable
 * API authorization credential; the API verifier retains its 15-minute cap.
 * OpenID Connect binds an ID token to this application's client_id; it is
 * never bound to the API audience or an independently configured issuer URL.
 * This helper does not create D1 sessions.
 *
 * @param {{issuer: string, apiAudience: string, clientId: string}} configuration
 * @param {(header: import('jose').JWSHeaderParameters, token: import('jose').FlattenedJWSInput) => Promise<CryptoKey | Uint8Array>} [keySet]
 */
function createSignedKindeProofVerifier(configuration, keySet) {
  const { issuer, apiAudience, clientId } = configuration ?? {};
  if (typeof issuer !== 'string' || typeof clientId !== 'string'
    || clientId.length < 8 || clientId.length > 256 || /\s/.test(clientId)) {
    throw new TypeError('invalid-kinde-login-configuration');
  }
  const jwks = keySet ?? createRemoteJWKSet(new URL(issuer + '/.well-known/jwks'), {
    timeoutDuration: 3000,
    cooldownDuration: 30000,
    cacheMaxAge: 600000,
  });
  const verifyAccessToken = createKindeCodeExchangeAccessTokenVerifier(
    { issuer, audience: apiAudience, clientId }, jwks,
  );
  /** @param {{accessToken?: string, idToken?: string, expectedNonce?: string}} [proof] */
  return async function verifyKindeIdentityProof({ accessToken, idToken, expectedNonce } = {}) {
    if (typeof expectedNonce !== 'string' || !OAUTH_NONCE.test(expectedNonce)
      || typeof accessToken !== 'string'
      || typeof idToken !== 'string'
      || idToken.length > MAX_ID_TOKEN_BYTES
      || !COMPACT_JWS.test(idToken)) {
      throw new KindeLoginProofError('identity-input');
    }
    let access;
    try { access = await verifyAccessToken(accessToken); }
    catch (error) {
      throw new KindeLoginProofError(error instanceof KindeAccessTokenError
        ? error.phase : 'access-token');
    }
    let payload;
    try {
      ({ payload } = await jwtVerify(idToken, jwks, {
        issuer, audience: clientId, algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      }));
    } catch (error) { throw new KindeLoginProofError(idTokenFailurePhase(error)); }
    // Kinde may list both the OAuth client and its issuer. OIDC requires
    // rejecting any additional audience not explicitly trusted by this RP.
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (audiences.some(audience => audience !== clientId && audience !== issuer)) {
      throw new KindeLoginProofError('id-token-audience');
    }
    try {
      const now = Math.floor(Date.now() / 1000);
      if (payload.azp !== clientId || payload.nonce !== expectedNonce
        || payload.sub !== access.subject || typeof payload.email_verified !== 'boolean'
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
        throw new KindeLoginProofError('token-binding');
      }
      return Object.freeze({
        identity: Object.freeze({
          issuer: access.issuer, subject: access.subject, emailVerified: payload.email_verified,
        }),
        authenticatedAtSeconds: payload.auth_time,
      });
    } catch (error) {
      if (error instanceof KindeLoginProofError) throw error;
      throw new KindeLoginProofError('id-claims');
    }
  };
}

/** @param {Parameters<typeof createSignedKindeProofVerifier>} args */
export function createKindeIdentityProofVerifier(...args) {
  const verify = createSignedKindeProofVerifier(...args);
  /** @param {Parameters<typeof verify>[0]} proof */
  return async (proof) => (await verify(proof)).identity;
}

/**
 * Candidate proof for an already consumed, server-owned deletion attempt.
 * Its nonce, owner and start time must come from the trusted attempt record.
 * A freshly issued token on an old SSO session does not prove a fresh login.
 * A same-owner reauthentication only authorizes the deletion request path.
 * It never creates an ordinary D1 session or a fitness authorization.
 *
 * @param {Parameters<typeof createSignedKindeProofVerifier>} args
 */
export function createKindeDeletionReauthVerifier(...args) {
  const verify = createSignedKindeProofVerifier(...args);
  /**
   * @param {Parameters<typeof verify>[0]} proof
   * @param {{ expectedUid: string, startedAtMs: number }} attempt
   */
  return async function verifyDeletionReauthentication(proof, { expectedUid, startedAtMs }) {
    const { identity, authenticatedAtSeconds } = await verify(proof);
    const uid = await deriveKindeOwnerId(identity.issuer, identity.subject);
    const authenticatedAtMs = authenticatedAtSeconds * 1000;
    const now = Date.now();
    // auth_time has whole-second resolution. A second that began before
    // the attempt cannot prove which event happened first.
    if (uid !== expectedUid || !Number.isSafeInteger(startedAtMs) || startedAtMs <= 0
      || authenticatedAtMs < startedAtMs || authenticatedAtMs > now
      || now - authenticatedAtMs > MAX_DELETION_REAUTH_AGE_MS) {
      throw new KindeLoginProofError('deletion-reauthentication');
    }
    return Object.freeze({ uid, authenticatedAtMs });
  };
}

/**
 * Existing verified-only boundary used by principal provisioning and the
 * regular OAuth callback. Never issue an ordinary session from identity proof
 * alone: a signed false email_verified must remain denied here.
 */
export function createKindeLoginProofVerifier(configuration, keySet) {
  const verifyIdentity = createKindeIdentityProofVerifier(configuration, keySet);
  return async function verifyKindeLoginProof(proof) {
    const identity = await verifyIdentity(proof);
    if (identity.emailVerified !== true) throw new KindeLoginProofError('id-claims');
    return identity;
  };
}
