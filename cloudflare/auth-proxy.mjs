import { routeCandidateFirstPartyApi } from './first-party-api-candidate.mjs';

// OAuth/session Kinde routes terminate at the private Kinde HTTP Worker.
// Separately, legacy Firebase Auth helpers retain a fixed first-party proxy
// while the Firebase-based application AuthContext has not been retired.
const AUTH_UPSTREAM = 'https://logbook-db-98cc4.firebaseapp.com';
const AUTH_PREFIX = '/__/auth/';
const MAX_AUTH_BODY = 65536;
const KINDE_AUTH_ROUTES = new Set([
  '/api/auth/kinde/start',
  '/api/auth/kinde/callback',
  '/api/auth/session',
  '/api/auth/logout',
]);
const FORWARDED = ['accept', 'accept-language', 'content-type', 'cookie', 'origin', 'referer', 'user-agent'];

function fail(status) {
  return new Response(null, { status, headers: {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  } });
}

async function readBoundedBody(request) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  let length = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_AUTH_BODY) return null;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (KINDE_AUTH_ROUTES.has(url.pathname)) {
      // Only OAuth/session routes cross this binding. All fitness, consent
      // and cloud-key APIs remain unavailable at the public edge.
      return routeCandidateFirstPartyApi(request, {
        APP_ORIGIN: env?.APP_ORIGIN,
        KINDE_HTTP: env?.KINDE_HTTP,
      });
    }
    if (!url.pathname.startsWith(AUTH_PREFIX)) return fail(404);
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) return fail(405);
    const declaredLength = request.headers.get('content-length');
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_AUTH_BODY)) return fail(413);
    if (request.method !== 'POST' && request.body) return fail(400);
    const body = request.method === 'POST' ? await readBoundedBody(request) : null;
    if (request.method === 'POST' && body === null) return fail(413);
    const headers = new Headers();
    for (const key of FORWARDED) {
      const value = request.headers.get(key);
      if (value !== null) headers.set(key, value);
    }
    let upstream;
    try {
      upstream = await fetch(AUTH_UPSTREAM + url.pathname + url.search, {
        method: request.method, headers, body, redirect: 'manual',
      });
    } catch {
      return fail(502);
    }
    const responseHeaders = new Headers(upstream.headers);
    const location = responseHeaders.get('location');
    if (location) {
      let destination;
      try { destination = new URL(location, AUTH_UPSTREAM); } catch { return fail(502); }
      if (destination.protocol !== 'https:') return fail(502);
      if (destination.origin === AUTH_UPSTREAM) {
        if (!destination.pathname.startsWith(AUTH_PREFIX)) return fail(502);
        responseHeaders.set('location', url.origin + destination.pathname + destination.search + destination.hash);
      }
    }
    responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.set('X-Content-Type-Options', 'nosniff');
    responseHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // /__/auth/iframe must be embeddable: never add X-Frame-Options DENY or frame-ancestors none.
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status, statusText: upstream.statusText, headers: responseHeaders,
    });
  },
};
