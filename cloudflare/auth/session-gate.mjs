// Private, read-only Auth service binding for the candidate D1 replica API.
// Only a future trusted Auth issuer may create/revoke these sessions.
// This Worker has no public route and cannot mint an identity on request.
const SESSION_COOKIE = '__Host-logbook_session';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
const READ_ROUTES = new Set([
  '/v1/sync/control', '/v1/sync/read', '/v1/sync/scan', '/v1/sync/receipt',
]);
const MUTATION_ROUTES = new Set([
  '/v1/sync/commit', '/v1/sync/commit/status', '/v1/sync/replica/claim',
  '/v1/sync/replica/retire', '/v1/sync/replica/status',
  '/v1/cloud-key/sync',
]);
const IDENTITY_READ_ROUTES = new Set(['/v1/consent/status']);
const IDENTITY_MUTATION_ROUTES = new Set(['/v1/consent/initial', '/v1/consent/withdraw', '/v1/auth/logout',
  '/v1/cloud-key/rights-export']);

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

// A 32-byte token has a canonical 43-character unpadded base64url encoding.
function canonicalToken(value) {
  if (typeof value !== 'string' || !TOKEN.test(value)) return false;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '=');
    return binary.length === 32
      && btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === value;
  } catch {
    return false;
  }
}

export async function hashSessionSecret(value) {
  if (!canonicalToken(value)) throw new TypeError('invalid-auth-token');
  const raw = new TextEncoder().encode(value);
  const hashed = await crypto.subtle.digest('SHA-256', raw);
  return Array.from(new Uint8Array(hashed), byte => byte.toString(16).padStart(2, '0')).join('');
}

function cookieToken(header) {
  if (typeof header !== 'string' || header.length > 4096) return null;
  const found = header.split(';').map(part => part.trim())
    .filter(part => part.startsWith(SESSION_COOKIE + '='));
  if (found.length !== 1) return null;
  const token = found[0].slice(SESSION_COOKIE.length + 1);
  return canonicalToken(token) ? token : null;
}

function equalHash(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string'
    || !HASH.test(left) || !HASH.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function authorize(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.origin !== 'https://auth-gate.internal'
    || url.pathname !== '/__internal/authorize' || url.search !== ''
    || request.body !== null) return json({ error: 'not-found' }, 404);
  if (typeof env.API_ORIGIN !== 'string' || !/^https:\/\/[^/]+$/.test(env.API_ORIGIN)
    || request.headers.get('origin') !== env.API_ORIGIN
    || request.headers.get('x-original-method') !== 'POST') {
    return json({ error: 'unauthorized' }, 403);
  }
  const route = request.headers.get('x-original-route');
  const identityOnly = IDENTITY_READ_ROUTES.has(route) || IDENTITY_MUTATION_ROUTES.has(route);
  if (!READ_ROUTES.has(route) && !MUTATION_ROUTES.has(route) && !identityOnly) {
    return json({ error: 'unauthorized' }, 403);
  }
  const token = cookieToken(request.headers.get('cookie'));
  if (!token) return json({ error: 'unauthorized' }, 401);
  if (!env.DB || typeof env.DB.withSession !== 'function'
    || !env.API_RATE_LIMITER || typeof env.API_RATE_LIMITER.limit !== 'function') {
    return json({ error: 'unavailable' }, 503);
  }

  // Current legal versions are a server-side authorization fence. An old
  // acceptance cannot enable sync merely because its original proof is intact.
  if (!identityOnly && (typeof env.CONSENT_PRIVACY_VERSION !== 'string'
    || typeof env.CONSENT_TERMS_VERSION !== 'string'
    || !/^[A-Za-z0-9._-]{1,32}$/.test(env.CONSENT_PRIVACY_VERSION)
    || !/^[A-Za-z0-9._-]{1,32}$/.test(env.CONSENT_TERMS_VERSION))) {
    return json({ error: 'unavailable' }, 503);
  }
  const tokenHash = await hashSessionSecret(token);
  // Approximate per-location protection against accidental/abusive session
  // traffic, not a globally strict login/email abuse quota. CF-07 still needs
  // WAF/edge protections against random-token floods before D1.
  const limited = await env.API_RATE_LIMITER.limit({ key: 'sync:' + tokenHash });
  if (!limited || limited.success !== true) return json({ error: 'rate-limited' }, 429);

  // Consent bootstrap must authenticate an account with *no* consent row.
  // Sync routes still require the stronger inner join with active consent.
  const identitySql = `
    SELECT p.uid, p.auth_epoch AS fence_epoch, p.verified_at_ms,
      COALESCE(s.consent_revision, 0) AS consent_revision,
      t.csrf_hash, t.issued_at_ms, t.idle_expires_at_ms,
      t.absolute_expires_at_ms
    FROM auth_sessions t
    JOIN auth_principals p ON p.uid = t.uid
    LEFT JOIN sync_subjects s ON s.uid = p.uid
    WHERE t.token_hash = ? AND t.revoked_at_ms IS NULL
      AND p.status = 'active' AND t.auth_epoch = p.auth_epoch
  `;
  const syncSql = `
    SELECT p.uid, p.auth_epoch, s.consent_revision, s.fence_epoch,
      p.verified_at_ms, t.csrf_hash, t.issued_at_ms, t.idle_expires_at_ms,
      t.absolute_expires_at_ms
    FROM auth_sessions t
    JOIN auth_principals p ON p.uid = t.uid
    JOIN sync_subjects s ON s.uid = p.uid
    JOIN sync_state state ON state.uid = s.uid
    JOIN health_consent_acceptances accepted ON accepted.uid = s.uid
    WHERE t.token_hash = ? AND t.revoked_at_ms IS NULL
      AND p.status = 'active' AND p.verified_at_ms IS NOT NULL
      AND t.auth_epoch = p.auth_epoch
      AND s.status = 'active' AND s.consent_revision = 1
      AND accepted.consent_revision = 1 AND accepted.over_18_confirmed = 1
      AND accepted.accepted_at_ms > 0
      AND accepted.privacy_version = ?
      AND accepted.terms_version = ?
      AND s.fence_epoch = p.auth_epoch
  `;
  const parameters = identityOnly
    ? [tokenHash]
    : [tokenHash, env.CONSENT_PRIVACY_VERSION, env.CONSENT_TERMS_VERSION];
  const row = await env.DB.withSession('first-primary')
    .prepare(identityOnly ? identitySql : syncSql).bind(...parameters).first();
  const now = Date.now();
  if (!row || !Number.isSafeInteger(row.issued_at_ms) || row.issued_at_ms > now
    || !Number.isSafeInteger(row.idle_expires_at_ms) || now >= row.idle_expires_at_ms
    || !Number.isSafeInteger(row.absolute_expires_at_ms) || now >= row.absolute_expires_at_ms
    || !Number.isSafeInteger(row.consent_revision) || row.consent_revision < 0
    || (!identityOnly && row.consent_revision < 1)
    || !Number.isSafeInteger(row.fence_epoch) || row.fence_epoch < 1
    || typeof row.uid !== 'string' || row.uid.length === 0 || row.uid.includes('/')) {
    return json({ error: 'unauthorized' }, 401);
  }
  const emailVerified = Number.isSafeInteger(row.verified_at_ms)
    && row.verified_at_ms > 0 && row.verified_at_ms <= now;
  // A session may be closed before verification or first health consent.
  if ((!identityOnly || (IDENTITY_MUTATION_ROUTES.has(route)
    && !['/v1/auth/logout', '/v1/consent/withdraw'].includes(route))) && !emailVerified) {
    return json({ error: 'unauthorized' }, 401);
  }
  const suppliedCsrf = request.headers.get('x-csrf-token');
  let csrfVerified = false;
  if (suppliedCsrf) {
    if (!canonicalToken(suppliedCsrf)) return json({ error: 'unauthorized' }, 403);
    csrfVerified = equalHash(await hashSessionSecret(suppliedCsrf), row.csrf_hash);
    if (!csrfVerified) return json({ error: 'unauthorized' }, 403);
  }
  if ((MUTATION_ROUTES.has(route) || IDENTITY_MUTATION_ROUTES.has(route)) && !csrfVerified) {
    return json({ error: 'csrf-required' }, 403);
  }
  return json({
    uid: row.uid,
    authenticated: true,
    emailVerified,
    healthConsentRevision: row.consent_revision,
    fenceEpoch: row.fence_epoch,
    csrfVerified,
    rateGatePassed: true,
    // Only private service-binding consumers see this digest.
    sessionHash: tokenHash,
  }, 200);
}

export default {
  async fetch(request, env) {
    try { return await authorize(request, env); }
    catch {
      // Internal SQL/crypto/provider errors must not disclose schema or identity.
      return json({ error: 'unavailable' }, 503);
    }
  },
};
