// Candidate CF-05 HTTP boundary: authenticated, CSRF-bound access to a
// wrapped server ADK. No route is published until Auth/D1/erasure GO.
import { releaseCloudAccountDataKey } from './cloud-key-store.mjs';

const SYNC = '/v1/cloud-key/sync';
const RIGHTS = '/v1/cloud-key/rights-export';
const INTERNAL = 'https://auth-gate.internal/__internal/authorize';

function reply(payload, status) {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function validOrigin(origin) {
  if (typeof origin !== 'string') return false;
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && u.origin === origin
      && u.pathname === '/' && !u.search && !u.hash && !u.username
      && !u.password && !u.port;
  } catch { return false; }
}

function validRequest(request, env, pathname) {
  const url = new URL(request.url);
  const length = request.headers.get('content-length');
  return request.method === 'POST' && url.pathname === pathname && !url.search && !url.hash
    && url.origin === env.API_ORIGIN
    && request.headers.get('origin') === env.API_ORIGIN
    && (!request.headers.has('sec-fetch-site')
      || request.headers.get('sec-fetch-site') === 'same-origin')
    && request.body === null
    && (length === null || length === '0');
}

async function authorize(request, env, route) {
  const headers = {
    origin: env.API_ORIGIN,
    'x-original-method': 'POST',
    'x-original-route': route,
    cookie: request.headers.get('cookie') ?? '',
    'x-csrf-token': request.headers.get('x-csrf-token') ?? '',
  };
  let result;
  try {
    result = await env.AUTH_GATE.fetch(new Request(INTERNAL, { method: 'POST', headers }));
  } catch {
    return { status: 503 };
  }
  if (!result.ok) {
    return { status: [401, 403, 429].includes(result.status) ? result.status : 503 };
  }
  try {
    const claims = await result.json();
    return { claims };
  } catch {
    return { status: 503 };
  }
}

export default {
  async fetch(request, env) {
    let pathname;
    try { pathname = new URL(request.url).pathname; } catch { return reply({ error: 'not-found' }, 404); }
    if (pathname !== SYNC && pathname !== RIGHTS) return reply({ error: 'not-found' }, 404);
    if (request.method !== 'POST') return reply({ error: 'method-not-allowed' }, 405);
    if (!validOrigin(env?.API_ORIGIN) || !validRequest(request, env, pathname)) {
      return reply({ error: 'origin-or-input-rejected' }, 403);
    }
    // Private bindings must be present before a token or key operation. Never
    // try a public fetch or infer owner/consent from a browser-supplied value.
    if (!env.DB || typeof env.DB.withSession !== 'function'
      || !env.AUTH_GATE || typeof env.AUTH_GATE.fetch !== 'function') {
      return reply({ error: 'unavailable' }, 503);
    }

    const granted = await authorize(request, env, pathname);
    if (granted.status) return reply({ error: 'unauthorized-or-unavailable' }, granted.status);

    let adk;
    try {
      // The store uses PRIMARY reads before AND after crypto and a conditional
      // SQL provision. Rights export must not create a key after withdrawal.
      adk = await releaseCloudAccountDataKey(env.DB, env, granted.claims,
        pathname === RIGHTS ? 'rights-export' : 'sync');
      if (!(adk instanceof Uint8Array) || adk.length !== 32) {
        return reply({ error: 'unavailable' }, 503);
      }
      const key = btoa(String.fromCharCode(...adk));
      return reply({ format: 'thelogbook-account-data-key', version: 1, key }, 200);
    } catch {
      return reply({ error: 'unavailable' }, 503);
    } finally {
      // The response necessarily contains the key for the authenticated
      // browser; no key bytes remain in the Worker-local typed array.
      adk?.fill(0);
    }
  },
};
