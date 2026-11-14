import { createKindePrincipalProvisioner } from './kinde-principal-provisioner.mjs';
import { issueVerifiedSession } from './session-issuer.mjs';

const START_PATH = '/api/auth/kinde/start';
const CALLBACK_PATH = '/api/auth/kinde/callback';
const OAUTH_COOKIE = '__Host-logbook_oauth';
const STATE_LIFETIME_MS = 10 * 60 * 1000;
const TOKEN_BODY_LIMIT = 16384;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^[\x21-\x7E]{1,2048}$/;

class KindeOAuthError extends Error {
  constructor() {
    super('kinde-oauth-unavailable');
    this.name = 'KindeOAuthError';
  }
}

function noStoreHeaders() {
  return new Headers({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
}

function denied(status = 400) {
  const headers = noStoreHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify({ error: 'authentication-unavailable' }), { status, headers });
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function digestHex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function canonicalToken(value) {
  if (typeof value !== 'string' || !TOKEN.test(value)) return false;
  try {
    const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '=');
    return decoded.length === 32
      && btoa(decoded).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === value;
  } catch { return false; }
}

function browserCookie(header) {
  if (typeof header !== 'string' || header.length > 4096) return null;
  const cookies = header.split(';').map(value => value.trim())
    .filter(value => value.startsWith(OAUTH_COOKIE + '='));
  if (cookies.length !== 1) return null;
  const value = cookies[0].slice(OAUTH_COOKIE.length + 1);
  return canonicalToken(value) ? value : null;
}

function requireConfiguration(config) {
  const { issuer, clientId, clientSecret, apiAudience, idTokenAudience, appOrigin } = config ?? {};
  if (typeof issuer !== 'string' || typeof clientId !== 'string'
    || typeof clientSecret !== 'string' || typeof apiAudience !== 'string'
    || typeof idTokenAudience !== 'string' || typeof appOrigin !== 'string'
    || clientId.length < 8 || clientId.length > 256 || /\s/.test(clientId)
    || clientSecret.length < 12 || clientSecret.length > 1024
    || !apiAudience || apiAudience.length > 512 || /\s/.test(apiAudience)
    || !idTokenAudience || idTokenAudience.length > 512 || /\s/.test(idTokenAudience)) {
    throw new TypeError('invalid-kinde-oauth-configuration');
  }
  let provider; let application;
  try {
    provider = new URL(issuer);
    application = new URL(appOrigin);
  } catch { throw new TypeError('invalid-kinde-oauth-configuration'); }
  if (provider.protocol !== 'https:' || application.protocol !== 'https:'
    || provider.origin !== issuer || application.origin !== appOrigin
    || provider.username || provider.password || application.username || application.password
    || provider.port || application.port) {
    throw new TypeError('invalid-kinde-oauth-configuration');
  }
  const redirectUri = appOrigin + CALLBACK_PATH;
  return { issuer, clientId, clientSecret, apiAudience, idTokenAudience,
    appOrigin, redirectUri };
}

function requestUrl(request, origin, path, method) {
  if (!(request instanceof Request) || request.method !== method || request.body !== null) return null;
  const url = new URL(request.url);
  return url.origin === origin && url.pathname === path && !url.hash ? url : null;
}

function callbackParameters(url) {
  const allowed = new Set(['state', 'code', 'error', 'error_description']);
  for (const [key] of url.searchParams) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) return null;
  }
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (!canonicalToken(state) || (!!code === !!error) ||
    (code !== null && !CODE.test(code)) ||
    (error !== null && (!/^[a-z_]{1,64}$/.test(error)
      || (url.searchParams.get('error_description') ?? '').length > 512))) {
    return null;
  }
  return { state, code, error };
}

async function tokenResponse(response) {
  if (!(response instanceof Response) || !response.ok
    || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new KindeOAuthError();
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > TOKEN_BODY_LIMIT)) {
    throw new KindeOAuthError();
  }
  if (!response.body) throw new KindeOAuthError();
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > TOKEN_BODY_LIMIT) {
      await reader.cancel().catch(() => {});
      throw new KindeOAuthError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  let tokens;
  try { tokens = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new KindeOAuthError(); }
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)
    || typeof tokens.access_token !== 'string' || typeof tokens.id_token !== 'string'
    || tokens.access_token.length > 8192 || tokens.id_token.length > 8192) {
    throw new KindeOAuthError();
  }
  return { accessToken: tokens.access_token, idToken: tokens.id_token };
}

/**
 * Not mounted on a public Worker. The eventual HTTP adapter must enforce
 * perimeter limits before calling start, and must never accept user-supplied
 * issuer, redirect URI, owner, nonce or verifier. D1 is the atomic replay
 * authority; the host-only browser cookie binds a valid state to its initiator.
 *
 * rateLimit is mandatory and must use a trusted, server-derived abuse key
 * rather than an arbitrary client header. It is not a global Free-tier quota.
 */
/**
 * @param {{ issuer: string, clientId: string, clientSecret: string, apiAudience: string, idTokenAudience: string, appOrigin: string }} configuration
 * @param {{ rateLimit?: (request: Request) => Promise<boolean>, fetchImpl?: typeof fetch,
 * keySet?: (header: import('jose').JWSHeaderParameters, token: import('jose').FlattenedJWSInput) => Promise<import('jose').KeyLike | Uint8Array> }} [dependencies]
 */
export function createKindeOAuthFlow(configuration, { rateLimit, fetchImpl = fetch, keySet } = {}) {
  const config = requireConfiguration(configuration);
  if (typeof rateLimit !== 'function' || typeof fetchImpl !== 'function') {
    throw new TypeError('invalid-kinde-oauth-dependencies');
  }
  const provision = createKindePrincipalProvisioner(config, keySet);

  async function start(db, request) {
    const url = requestUrl(request, config.appOrigin, START_PATH, 'POST');
    if (!url || url.search || request.headers.get('origin') !== config.appOrigin
      || (request.headers.has('sec-fetch-site')
        && request.headers.get('sec-fetch-site') !== 'same-origin')) return denied(403);
    if (!db || typeof db.withSession !== 'function') return denied(503);
    try {
      if (await rateLimit(request) !== true) return denied(429);
      const now = Date.now();
      if (!Number.isSafeInteger(now) || now < 1 || now > Number.MAX_SAFE_INTEGER - STATE_LIFETIME_MS) {
        throw new KindeOAuthError();
      }
      const state = randomSecret();
      const nonce = randomSecret();
      const verifier = randomSecret();
      // Reusing this host-only cookie allows concurrent tabs to finish separate
      // attempts without overwriting each other's browser binding.
      const browser = browserCookie(request.headers.get('cookie')) ?? randomSecret();
      const stateHash = await digestHex(state);
      const browserHash = await digestHex(browser);
      const challenge = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(challenge)))
        .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
      const primary = db.withSession('first-primary');
      // A bounded, indexed sweep stops abandoned PKCE verifiers accumulating
      // under ordinary traffic without a full-table operation on login.
      const pruned = await primary.prepare(
        'DELETE FROM auth_oauth_attempts WHERE state_hash IN (SELECT state_hash FROM auth_oauth_attempts WHERE expires_at_ms <= ? ORDER BY expires_at_ms LIMIT 16)'
      ).bind(now).run();
      if (pruned?.success !== true || !Number.isSafeInteger(pruned.meta?.changes)
        || pruned.meta.changes < 0 || pruned.meta.changes > 16) throw new KindeOAuthError();
      const inserted = await primary.prepare(
        'INSERT INTO auth_oauth_attempts (state_hash, browser_hash, code_verifier, nonce, issued_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(stateHash, browserHash, verifier, nonce, now, now + STATE_LIFETIME_MS).run();
      if (inserted?.success !== true || inserted.meta?.changes !== 1) throw new KindeOAuthError();

      const authorize = new URL(config.issuer + '/oauth2/auth');
      for (const [name, value] of Object.entries({
        response_type: 'code', client_id: config.clientId,
        redirect_uri: config.redirectUri, scope: 'openid email profile',
        audience: config.apiAudience, state, nonce,
        code_challenge: codeChallenge, code_challenge_method: 'S256',
      })) authorize.searchParams.set(name, value);
      const headers = noStoreHeaders();
      headers.set('Location', authorize.href);
      headers.append('Set-Cookie', OAUTH_COOKIE + '=' + browser +
        '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600');
      return new Response(null, { status: 303, headers });
    } catch {
      return denied(503);
    }
  }

  async function complete(db, request) {
    const url = requestUrl(request, config.appOrigin, CALLBACK_PATH, 'GET');
    if (!url || !db || typeof db.withSession !== 'function') return denied(403);
    const input = callbackParameters(url);
    const browser = browserCookie(request.headers.get('cookie'));
    if (!input || !browser) return denied(400);
    try {
      // Random-state floods with an existing browser binding must be
      // throttled before they consume D1 queries or remote token requests.
      if (await rateLimit(request) !== true) return denied(429);
      const stateHash = await digestHex(input.state);
      const browserHash = await digestHex(browser);
      // DELETE ... RETURNING is the sole consume operation. Only one
      // concurrent callback can receive a verifier; ambiguous results never
      // trigger exchange or issuance. An OAuth error also consumes its state.
      const saved = await db.withSession('first-primary').prepare(
        'DELETE FROM auth_oauth_attempts WHERE state_hash = ? AND browser_hash = ? AND expires_at_ms > ? RETURNING code_verifier, nonce'
      ).bind(stateHash, browserHash, Date.now()).first();
      if (!saved || !canonicalToken(saved.code_verifier) || !canonicalToken(saved.nonce)) {
        return denied(400);
      }
      if (input.error !== null) return denied(401);
      const body = new URLSearchParams({
        grant_type: 'authorization_code', code: input.code,
        redirect_uri: config.redirectUri, client_id: config.clientId,
        client_secret: config.clientSecret, code_verifier: saved.code_verifier,
      });
      // No automatic retry of an ambiguous code exchange: consumed state
      // requires a fresh login, not a second attempt with the same code.
      // Workers do not support redirect:'error'; manual mode lets tokenResponse
      // reject a 3xx without following a Location with the client secret.
      const response = await fetchImpl(config.issuer + '/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body, redirect: 'manual', signal: AbortSignal.timeout(5000),
      });
      const tokens = await tokenResponse(response);
      const principal = await provision(db, tokens, saved.nonce);
      const issued = await issueVerifiedSession(db, principal.uid);
      if (!issued || !Array.isArray(issued.setCookies) || issued.setCookies.length !== 2) {
        throw new KindeOAuthError();
      }
      const headers = noStoreHeaders();
      headers.set('Location', config.appOrigin + '/');
      for (const cookie of issued.setCookies) headers.append('Set-Cookie', cookie);
      return new Response(null, { status: 303, headers });
    } catch {
      return denied(503);
    }
  }

  return Object.freeze({ start, complete });
}
