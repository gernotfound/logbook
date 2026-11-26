// Unmounted first-party boundary for the future Kinde/D1 cutover. Its callers
// must be deliberately enabled in the frontend Worker configuration after GO.
// Never fall back to Static Assets for recognized API paths.
import { edgeOAuthRateBucket, OAUTH_RATE_BUCKET_HEADER } from './auth/oauth-rate-bucket.mjs';
import { candidateApiRoutePolicy } from './api-route-policy.mjs';

const KINDE_ROUTES = new Map([
  ['/api/auth/kinde/start', 'POST'],
  ['/api/auth/kinde/callback', 'GET'],
  ['/api/auth/session', 'POST'],
  ['/api/auth/logout', 'POST'],
]);
const MAX_CALLBACK_QUERY_BYTES = 4_096;
const FORWARDED = [
  'accept', 'accept-language', 'content-type', 'cookie', 'origin',
  'sec-fetch-site', 'x-csrf-token',
];

function denied(status) {
  return new Response(null, { status, headers: {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  } });
}

function configuredOrigin(env) {
  if (typeof env?.APP_ORIGIN !== 'string') return false;
  try {
    const url = new URL(env.APP_ORIGIN);
    return url.protocol === 'https:' && url.origin === env.APP_ORIGIN
      && url.pathname === '/' && !url.username && !url.password && !url.port;
  } catch { return false; }
}

function permittedRoute(path) {
  if (KINDE_ROUTES.has(path)) return { binding: 'KINDE_HTTP', method: KINDE_ROUTES.get(path), maxBodyBytes: 0 };
  const policy = candidateApiRoutePolicy(path);
  if (policy?.public === true && Number.isSafeInteger(policy.maxBodyBytes)
    && policy.maxBodyBytes >= 0) return { binding: 'D1_API', method: 'POST', maxBodyBytes: policy.maxBodyBytes };
  return null;
}

/**
 * Candidate service-binding gateway; it does not create identity, grant consent,
 * decrypt an ADK or acknowledge a journal. Private Workers independently check
 * AuthGate, CSRF, owner, consent and D1. Only KINDE_HTTP is publicly
 * bound for OAuth/session; the D1_API fitness binding remains absent.
 *
 * OAuth callback is the only GET and may arrive from a cross-site Kinde 303.
 * Every POST requires a same-origin Origin and browser fetch-site boundary.
 * Redirects are handled by the browser, never followed by this Worker with
 * cookies, and unrecognized paths cannot be rewritten to the SPA shell.
 */
export async function routeCandidateFirstPartyApi(request, env) {
  let url;
  try { url = new URL(request.url); } catch { return denied(404); }
  const route = permittedRoute(url.pathname);
  if (!route) return denied(404);
  if (request.method !== route.method) return denied(405);
  if (!configuredOrigin(env) || url.origin !== env.APP_ORIGIN
    || url.hash || request.bodyUsed) return denied(503);

  const callback = url.pathname === '/api/auth/kinde/callback';
  if ((!callback && url.search !== '')
    || (callback && url.search.length > MAX_CALLBACK_QUERY_BYTES)
    || (callback && request.body !== null)) return denied(400);
  if (request.method === 'POST'
    && (request.headers.get('origin') !== env.APP_ORIGIN
      || (request.headers.has('sec-fetch-site')
        && request.headers.get('sec-fetch-site') !== 'same-origin'))) return denied(403);

  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || Number(declared) > route.maxBodyBytes) return denied(413);
  }
  const service = env[route.binding];
  if (!service || typeof service.fetch !== 'function') return denied(503);

  // Only the fields required by the candidate Workers cross the service
  // boundary. User-controlled x-original-*, Authorization and forwarded-host
  // headers must not become trusted metadata inside a private Worker.
  const headers = new Headers();
  for (const key of FORWARDED) {
    const value = request.headers.get(key);
    if (value !== null) headers.set(key, value);
  }
  let response;
  try {
    if (callback || url.pathname === '/api/auth/kinde/start') {
      // Only this gateway may set the private rate bucket. The allowlist
      // above already dropped any client version of that header.
      const bucket = await edgeOAuthRateBucket(request);
      if (bucket) headers.set(OAUTH_RATE_BUCKET_HEADER, bucket);
    }
    response = await service.fetch(new Request(request, {
      headers, redirect: 'manual',
    }));
  } catch { return denied(503); }
  if (!(response instanceof Response) || response.type === 'opaque'
    || response.type === 'opaqueredirect' || response.type === 'error') return denied(503);
  // Auth responses (including multiple Set-Cookie headers and OAuth 303)
  // pass through intact; never buffer, parse or cache a sensitive body.
  const directives = response.headers.get('cache-control')?.toLowerCase().split(',') ?? [];
  if (!directives.some(value => value.trim() === 'no-store')) return denied(502);
  // The fitness Worker may return data or an error, never control browser
  // authentication state or navigation. Kinde alone owns those responses.
  if (route.binding === 'D1_API' && (response.headers.has('set-cookie')
    || response.headers.has('location') || (response.status >= 300 && response.status < 400))) {
    return denied(502);
  }
  return response;
}
