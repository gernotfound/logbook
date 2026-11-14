// Candidate same-origin HTTP boundary for Kinde. Not mounted on the public
// Static Assets Worker: enabling routes needs a separate provider/runtime GO.
import { createKindeOAuthFlow } from './kinde-oauth-flow.mjs';
import logoutWorker from '../api/logout-worker.mjs';

const ROUTES = new Map([
  ['/api/auth/kinde/start', 'POST'],
  ['/api/auth/kinde/callback', 'GET'],
  ['/api/auth/session', 'POST'],
  ['/api/auth/logout', 'POST'],
]);
const INTERNAL_AUTH = 'https://auth-gate.internal/__internal/authorize';
const UID = /^k_[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;

function json(error, status) {
  return Response.json({ error }, { status, headers: {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  } });
}

function sameOrigin(request, origin) {
  if (request.headers.get('origin') !== origin) return false;
  const fetchSite = request.headers.get('sec-fetch-site');
  return fetchSite === null || fetchSite === 'same-origin';
}

function originConfiguration(env) {
  if (typeof env?.APP_ORIGIN !== 'string') return false;
  try {
    const url = new URL(env.APP_ORIGIN);
    return url.protocol === 'https:' && url.origin === env.APP_ORIGIN
      && !url.username && !url.password && !url.port;
  } catch { return false; }
}

function validateClaims(claims) {
  return !!claims && typeof claims === 'object' && !Array.isArray(claims)
    && claims.authenticated === true && claims.rateGatePassed === true
    && claims.emailVerified === true && UID.test(claims.uid)
    && Number.isSafeInteger(claims.fenceEpoch) && claims.fenceEpoch >= 1
    && Number.isSafeInteger(claims.healthConsentRevision)
    && claims.healthConsentRevision >= 0
    && typeof claims.sessionHash === 'string' && HASH.test(claims.sessionHash);
}

// Native empty HTML forms may expose a body stream even when their payload is
// zero bytes. Drain only this OAuth-start request before creating state; do
// not accept arbitrary form fields or trust a forged Content-Length: 0.
async function strictlyEmptyFormPost(request) {
  const length = request.headers.get('content-length');
  if (length !== null && length !== '0') return false;
  if (!request.body) return true;
  const reader = request.body.getReader();
  let timer;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => resolve(null), 2000);
  });
  try {
    for (let count = 0; count < 4; count += 1) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk === null) return false;
      if (chunk.done) return true;
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > 0) return false;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* A timed-out stream may have a pending read. */ }
  }
}

async function sessionStatus(request, env) {
  if (!env.AUTH_GATE || typeof env.AUTH_GATE.fetch !== 'function') return json('unavailable', 503);
  try {
    const response = await env.AUTH_GATE.fetch(new Request(INTERNAL_AUTH, {
      method: 'POST',
      headers: {
        origin: env.APP_ORIGIN,
        'x-original-method': 'POST',
        'x-original-route': '/v1/consent/status',
        cookie: request.headers.get('cookie') ?? '',
      },
    }));
    if (!response.ok) {
      return json(response.status === 401 || response.status === 403
        ? 'unauthorized' : response.status === 429 ? 'rate-limited' : 'unavailable',
      [401, 403, 429].includes(response.status) ? response.status : 503);
    }
    const claims = await response.json();
    if (!validateClaims(claims)) return json('unavailable', 503);
    return Response.json({
      authenticated: true, uid: claims.uid, emailVerified: true,
      fenceEpoch: claims.fenceEpoch,
      healthConsentRevision: claims.healthConsentRevision,
    }, { headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    } });
  } catch { return json('unavailable', 503); }
}

async function logout(request, env) {
  if (!env.AUTH_GATE || typeof env.AUTH_GATE.fetch !== 'function'
    || !env.DB || typeof env.DB.prepare !== 'function'
    || typeof env.DB.withSession !== 'function') return json('unavailable', 503);
  try {
    const delegated = new Request(env.APP_ORIGIN + '/v1/auth/logout', {
      method: 'POST',
      headers: {
        origin: env.APP_ORIGIN,
        cookie: request.headers.get('cookie') ?? '',
        'x-csrf-token': request.headers.get('x-csrf-token') ?? '',
      },
    });
    // Existing logout verifies the current principal epoch and session CSRF
    // using the private AuthGate, then the conditional D1 session revocation.
    // It is NOT a Kinde SSO logout and never purges the device vault.
    return await logoutWorker.fetch(delegated, {
      DB: env.DB, AUTH_GATE: env.AUTH_GATE, API_ORIGIN: env.APP_ORIGIN,
    });
  } catch { return json('unavailable', 503); }
}

/**
 * @param {{
 *  fetchImpl?: typeof fetch,
 *  keySet?: (header: import('jose').JWSHeaderParameters, token: import('jose').FlattenedJWSInput) => Promise<import('jose').KeyLike | Uint8Array>,
 * }} [dependencies]
 */
export function createKindeHttpHandler({ fetchImpl = fetch, keySet } = {}) {
  return async function fetchKindeHttp(request, env) {
    let url;
    try { url = new URL(request.url); } catch { return json('not-found', 404); }
    const expectedMethod = ROUTES.get(url.pathname);
    if (!expectedMethod) return json('not-found', 404);
    if (request.method !== expectedMethod) return json('method-not-allowed', 405);
    if (!originConfiguration(env) || url.origin !== env.APP_ORIGIN || url.hash) {
      return json('unavailable', 503);
    }
    const callback = url.pathname === '/api/auth/kinde/callback';
    if (!callback && (url.search !== ''
      || (request.body !== null && url.pathname !== '/api/auth/kinde/start')
      || (request.headers.has('content-length')
        && request.headers.get('content-length') !== '0')
      || !sameOrigin(request, env.APP_ORIGIN))) {
      return json('origin-or-input-rejected', 403);
    }
    if (callback && request.body !== null) return json('origin-or-input-rejected', 403);
    if (url.pathname === '/api/auth/kinde/start' && request.body !== null) {
      if (!await strictlyEmptyFormPost(request)) return json('origin-or-input-rejected', 403);
      // The OAuth flow's direct-call boundary accepts no body at all.
      request = new Request(request.url, { method: 'POST', headers: request.headers });
    }

    if (url.pathname === '/api/auth/session') return sessionStatus(request, env);
    if (url.pathname === '/api/auth/logout') return logout(request, env);

    if (!env.DB || typeof env.DB.withSession !== 'function'
      || !env.AUTH_RATE_LIMITER || typeof env.AUTH_RATE_LIMITER.limit !== 'function') {
      return json('unavailable', 503);
    }
    try {
      const flow = createKindeOAuthFlow({
        issuer: env.KINDE_ISSUER, clientId: env.KINDE_CLIENT_ID,
        clientSecret: env.KINDE_CLIENT_SECRET,
        apiAudience: env.KINDE_API_AUDIENCE,
        idTokenAudience: env.KINDE_ID_TOKEN_AUDIENCE,
        appOrigin: env.APP_ORIGIN,
      }, {
        fetchImpl, keySet,
        rateLimit: async candidate => {
          // Stable location-scoped cap without trusting a client-supplied IP.
          // This alone is not a globally enforced abuse quota or WAF policy.
          const limiter = await env.AUTH_RATE_LIMITER.limit({
            key: candidate.method === 'GET' ? 'oauth:callback' : 'oauth:start',
          });
          return limiter?.success === true;
        },
      });
      return callback ? flow.complete(env.DB, request) : flow.start(env.DB, request);
    } catch { return json('unavailable', 503); }
  };
}

export default {
  fetch: createKindeHttpHandler(),
};
