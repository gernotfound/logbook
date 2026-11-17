import { createRemoteJWKSet, jwtVerify } from 'jose';

const MAX_TOKEN_LENGTH = 8192;
const MAX_ACCESS_TOKEN_SECONDS = 15 * 60;
const MAX_CODE_EXCHANGE_ACCESS_TOKEN_SECONDS = 24 * 60 * 60;
const CLOCK_TOLERANCE_SECONDS = 5;
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// The callback exposes only fixed error categories after a browser-bound,
// one-use OAuth state has been consumed. Never propagate provider error text,
// JWT headers, claims, signature material or an underlying cause.
export class KindeAccessTokenError extends Error {
  constructor(phase = 'access-token') {
    super('invalid-kinde-token');
    this.name = 'KindeAccessTokenError';
    this.phase = phase;
  }
}

function jwtFailurePhase(error) {
  switch (error?.code) {
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      if (error.claim === 'aud') return 'access-token-audience';
      if (error.claim === 'iss') return 'access-token-issuer';
      return 'access-token';
    case 'ERR_JWT_EXPIRED':
      return 'access-token-expired';
    case 'ERR_JWKS_NO_MATCHING_KEY':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
    case 'ERR_JWKS_TIMEOUT':
      return 'access-token-key';
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return 'access-token-signature';
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
      return 'access-token-algorithm';
    default:
      return 'access-token';
  }
}

/** @param {{issuer?: string, audience?: string, clientId?: string}} [config] */
function requireConfiguration({ issuer, audience, clientId } = {}) {
  if (typeof issuer !== 'string' || typeof audience !== 'string'
    || typeof clientId !== 'string' || audience.length === 0
    || audience.length > 512 || clientId.length < 8 || clientId.length > 256) {
    throw new TypeError('invalid-kinde-configuration');
  }
  let url;
  try { url = new URL(issuer); }
  catch { throw new TypeError('invalid-kinde-configuration'); }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search
    || url.hash || url.username || url.password || url.port
    || issuer !== url.origin) {
    throw new TypeError('invalid-kinde-configuration');
  }
  return { issuer: url.origin, audience, clientId };
}

/**
 * Cryptographic *token* verifier only. Its result must never be used directly
 * to issue a D1 session: first prove a human user + verified email via a
 * trusted Kinde identity flow, then apply owner/consent/revocation fences.
 * Restrict JWT audience and authorized party to prevent a token for another
 * application from being accepted by the TheLogBook API.
 */
function createVerifiedAccessToken(configuration, keySet, maxLifetimeSeconds) {
  const { issuer, audience, clientId } = requireConfiguration(configuration);
  const jwks = keySet ?? createRemoteJWKSet(new URL(issuer + '/.well-known/jwks'), {
    timeoutDuration: 3000,
    cooldownDuration: 30000,
    cacheMaxAge: 600000,
  });
  if (typeof jwks !== 'function') throw new TypeError('invalid-kinde-keyset');
  return async function verifyKindeAccessToken(token) {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH
      || !COMPACT_JWS.test(token)) throw new KindeAccessTokenError('access-token-format');
    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer, audience, algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      }));
    } catch (error) {
      throw new KindeAccessTokenError(jwtFailurePhase(error));
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.azp !== clientId) {
      throw new KindeAccessTokenError('access-token-client');
    }
    if (typeof payload.sub !== 'string'
      || !/^kp[_:][A-Za-z0-9_:-]{1,125}$/.test(payload.sub)) {
      throw new KindeAccessTokenError('access-token-subject');
    }
    // Kinde documents gty as an array in M2M JWTs. A machine grant cannot
    // establish a user session even if it has a correctly signed JWT.
    if (payload.gty === 'client_credentials'
      || (Array.isArray(payload.gty) && payload.gty.includes('client_credentials'))) {
      throw new KindeAccessTokenError('access-token-grant');
    }
    if (!Number.isSafeInteger(payload.iat)
      || !Number.isSafeInteger(payload.exp)
      || payload.iat > now + CLOCK_TOLERANCE_SECONDS
      || payload.exp <= payload.iat) {
      throw new KindeAccessTokenError('access-token-timestamps');
    }
    if (payload.exp <= now) {
      throw new KindeAccessTokenError('access-token-expired');
    }
    if (payload.exp - payload.iat > maxLifetimeSeconds) {
      throw new KindeAccessTokenError('access-token-lifetime');
    }

    // The subject is scoped by the exact issuer. An access token does not
    // establish email verification or revoke an existing D1 session.
    return Object.freeze({
      issuer,
      subject: payload.sub,
      issuedAtSeconds: payload.iat,
      expiresAtSeconds: payload.exp,
    });
  };
}

/**
 * The API credential verifier deliberately keeps a 15-minute ceiling. A
 * token from this function must never by itself grant email verification,
 * consent, an owner session or access to health data.
 */
export function createKindeAccessTokenVerifier(configuration, keySet) {
  return createVerifiedAccessToken(configuration, keySet, MAX_ACCESS_TOKEN_SECONDS);
}

/**
 * Kinde defaults to 24-hour access tokens. After a one-time, server-side
 * authorization-code+PKCE exchange, the access token is used immediately
 * alongside a separate signed, nonce-bound and email-verified ID token,
 * and is neither returned to the browser nor used as an API credential.
 * Accept the provider's documented maximum only in this login-proof path.
 * The ordinary API verifier stays bounded to 15 minutes.
 */
export function createKindeCodeExchangeAccessTokenVerifier(configuration, keySet) {
  return createVerifiedAccessToken(configuration, keySet, MAX_CODE_EXCHANGE_ACCESS_TOKEN_SECONDS);
}
