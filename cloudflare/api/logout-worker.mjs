// Server-side logout of one current session; never erase device data or journal.
const INTERNAL = 'https://auth-gate.internal/__internal/authorize';
const HASH = /^[a-f0-9]{64}$/;

function json(body, status, clear = false) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  if (clear) {
    headers.append('Set-Cookie', '__Host-logbook_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
    headers.append('Set-Cookie', '__Host-logbook_csrf=; Path=/; Secure; SameSite=Lax; Max-Age=0');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function trustedClaims(request, env) {
  if (!env.AUTH_GATE || typeof env.AUTH_GATE.fetch !== 'function') return { errorStatus: 503 };
  const result = await env.AUTH_GATE.fetch(new Request(INTERNAL, {
    method: 'POST',
    headers: {
      origin: env.API_ORIGIN,
      'x-original-method': 'POST',
      'x-original-route': '/v1/auth/logout',
      cookie: request.headers.get('cookie') ?? '',
      'x-csrf-token': request.headers.get('x-csrf-token') ?? '',
    },
  }));
  if (!result.ok) {
    return { errorStatus: [401, 403, 429].includes(result.status) ? result.status : 503 };
  }
  const claims = await result.json();
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
    || claims.authenticated !== true || claims.rateGatePassed !== true
    || claims.csrfVerified !== true || typeof claims.emailVerified !== 'boolean'
    || typeof claims.uid !== 'string' || claims.uid.length < 1 || claims.uid.length > 128
    || claims.uid.trim() !== claims.uid || claims.uid.includes('/')
    || !Number.isSafeInteger(claims.fenceEpoch) || claims.fenceEpoch < 1
    || !HASH.test(claims.sessionHash ?? '')) return { errorStatus: 503 };
  return claims;
}

async function wasRevokedOnPrimary(db, claims) {
  // A lost write ACK can be accepted only if primary D1 proves this exact
  // formerly authenticated session has been revoked.
  const row = await db.withSession('first-primary').prepare(`
    SELECT uid, auth_epoch, issued_at_ms, revoked_at_ms
    FROM auth_sessions WHERE token_hash = ?
  `).bind(claims.sessionHash).first();
  return !!row && row.uid === claims.uid && row.auth_epoch === claims.fenceEpoch
    && Number.isSafeInteger(row.issued_at_ms)
    && Number.isSafeInteger(row.revoked_at_ms)
    && row.revoked_at_ms >= row.issued_at_ms;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method !== 'POST' || url.pathname !== '/v1/auth/logout' || url.search !== '') {
        return json({ error: 'not-found' }, 404);
      }
      if (typeof env.API_ORIGIN !== 'string' || !/^https:\/\/[^/]+$/.test(env.API_ORIGIN)
        || url.origin !== env.API_ORIGIN || request.headers.get('origin') !== env.API_ORIGIN
        || (request.headers.has('sec-fetch-site')
          && request.headers.get('sec-fetch-site') !== 'same-origin')) {
        return json({ error: 'origin-rejected' }, 403);
      }
      if (request.body !== null || (request.headers.has('content-length')
        && request.headers.get('content-length') !== '0')) return json({ error: 'invalid-body' }, 400);
      if (!env.DB || typeof env.DB.prepare !== 'function'
        || typeof env.DB.withSession !== 'function') return json({ error: 'unavailable' }, 503);

      const claims = await trustedClaims(request, env);
      if (claims.errorStatus) return json({ error: 'unauthorized-or-unavailable' }, claims.errorStatus);
      const now = Date.now();
      let revoked = false;
      try {
        // The update is scoped to the session's hash, owner and current
        // principal epoch: a raced account fence cannot become a logout ACK.
        const result = await env.DB.prepare(`
          UPDATE auth_sessions SET revoked_at_ms = ?
          WHERE token_hash = ? AND uid = ? AND auth_epoch = ?
            AND revoked_at_ms IS NULL AND issued_at_ms <= ?
            AND idle_expires_at_ms > ? AND absolute_expires_at_ms > ?
            AND EXISTS (
              SELECT 1 FROM auth_principals p
              WHERE p.uid = auth_sessions.uid AND p.status = 'active'
                AND p.auth_epoch = auth_sessions.auth_epoch
            )
        `).bind(now, claims.sessionHash, claims.uid, claims.fenceEpoch, now, now, now).run();
        revoked = result?.success === true && result.meta?.changes === 1;
      } catch {
        // The database may have committed before the response disappeared.
      }
      if (!revoked) revoked = await wasRevokedOnPrimary(env.DB, claims);
      if (!revoked) return json({ error: 'unavailable-or-conflict' }, 503);
      return json({ status: 'signed-out' }, 200, true);
    } catch {
      return json({ error: 'unavailable' }, 503);
    }
  },
};
