import { createRemoteJWKSet, jwtVerify } from 'jose';

const MAX_TOKEN_LENGTH = 8192;
const MAX_ACCESS_TOKEN_SECONDS = 15 * 60;
const CLOCK_TOLERANCE_SECONDS = 5;
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

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
export function createKindeAccessTokenVerifier(configuration, keySet) {
  const { issuer, audience, clientId } = requireConfiguration(configuration);
  const jwks = keySet ?? createRemoteJWKSet(new URL(issuer + '/.well-known/jwks'), {
    timeoutDuration: 3000,
    cooldownDuration: 30000,
    cacheMaxAge: 600000,
  });
  if (typeof jwks !== 'function') throw new TypeError('invalid-kinde-keyset');
  return async function verifyKindeAccessToken(token) {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH
      || !COMPACT_JWS.test(token)) throw new Error('invalid-kinde-token');
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer, audience, algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      const now = Math.floor(Date.now() / 1000);
      if (payload.azp !== clientId
        || typeof payload.sub !== 'string'
        || !/^[A-Za-z0-9_:-]{2,128}$/.test(payload.sub)
        || !Number.isSafeInteger(payload.iat)
        || !Number.isSafeInteger(payload.exp)
        || payload.iat > now + CLOCK_TOLERANCE_SECONDS
        || payload.exp <= now
        || payload.exp <= payload.iat
        || payload.exp - payload.iat > MAX_ACCESS_TOKEN_SECONDS) {
        throw new Error('invalid-kinde-claims');
      }
      // The subject is scoped by the exact issuer. An access token does not
      // establish email verification or revoke an existing D1 session.
      return Object.freeze({
        issuer,
        subject: payload.sub,
        issuedAtSeconds: payload.iat,
        expiresAtSeconds: payload.exp,
      });
    } catch {
      throw new Error('invalid-kinde-token');
    }
  };
}
