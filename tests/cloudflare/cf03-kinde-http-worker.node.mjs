import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import kindeHttpWorker, { createKindeHttpHandler } from '../../cloudflare/auth/kinde-http-worker.mjs';
import gate from '../../cloudflare/auth/session-gate.mjs';

const ORIGIN = 'https://candidate.invalid';
const ISSUER = 'https://synthetic-kinde.example';
const CLIENT = 'synthetic-kinde-client';
const API_AUD = 'thelogbook:synthetic-api';
const SESSION = '/api/auth/session';
const START = '/api/auth/kinde/start';
const CALLBACK = '/api/auth/kinde/callback';
const LOGOUT = '/api/auth/logout';

class Stmt {
  constructor(sqlite, sql, args = []) { this.sqlite = sqlite; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.sqlite, this.sql, args); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() {
    const r = this.sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: r.changes } };
  }
}
class DB {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Stmt(this.sqlite, sql); }
  withSession(mode) { assert.equal(mode, 'first-primary'); return this; }
}

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  // The identity gate joins sync_subjects even before consent. Exercise the
  // complete current D1 schema, not a partial Auth-only test database.
  const migrations = readdirSync(new URL('../../cloudflare/api/migrations/', import.meta.url))
    .filter(name => /^000[1-8]_[a-z0-9_]+\.sql$/.test(name)).sort();
  assert.deepEqual(migrations.map(name => name.slice(0, 4)),
    Array.from({ length: 8 }, (_, index) => String(index + 1).padStart(4, '0')));
  for (const file of migrations) {
    sqlite.exec(readFileSync(new URL('../../cloudflare/api/migrations/' + file, import.meta.url), 'utf8'));
  }
  const db = new DB(sqlite);
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const keySet = createLocalJWKSet({
    keys: [{ ...await exportJWK(publicKey), kid: 'synthetic', alg: 'RS256', use: 'sig' }],
  });
  let nonce;
  let callCount = 0;
  const fetchImpl = async (url, options) => {
    callCount += 1;
    assert.equal(url, ISSUER + '/oauth2/token');
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('client_secret'), 'synthetic-private-secret');
    const now = Math.floor(Date.now() / 1000);
    const sub = 'kp_synthetic_user_20261114';
    const accessToken = await new SignJWT({ azp: CLIENT, sub })
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
      .setIssuer(ISSUER).setAudience(API_AUD)
      .setIssuedAt(now - 2).setExpirationTime(now + 300).sign(privateKey);
    const at_hash = createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url');
    const idToken = await new SignJWT({
      azp: CLIENT, sub, nonce, email: 'verified@example.invalid',
      email_verified: true, auth_time: now - 60, at_hash,
    }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
      .setIssuer(ISSUER).setAudience(ISSUER).setIssuedAt(now - 2)
      .setExpirationTime(now + 300).sign(privateKey);
    return Response.json({ access_token: accessToken, id_token: idToken });
  };
  let allowLogin = true;
  const env = {
    APP_ORIGIN: ORIGIN, KINDE_ISSUER: ISSUER,
    KINDE_CLIENT_ID: CLIENT, KINDE_CLIENT_SECRET: 'synthetic-private-secret',
    KINDE_API_AUDIENCE: API_AUD, KINDE_ID_TOKEN_AUDIENCE: ISSUER,
    DB: db,
    AUTH_RATE_LIMITER: { limit: async () => ({ success: allowLogin }) },
    AUTH_GATE: {
      fetch(request) {
        return gate.fetch(request, {
          DB: db, API_ORIGIN: ORIGIN,
          CONSENT_PRIVACY_VERSION: '1.3.9',
          CONSENT_TERMS_VERSION: '1.2.5',
          API_RATE_LIMITER: { limit: async () => ({ success: true }) },
        });
      },
    },
  };
  const handler = createKindeHttpHandler({ fetchImpl, keySet });
  function post(path, cookie = '', csrf = '', opts = {}) {
    return new Request(opts.url ?? ORIGIN + path, {
      method: opts.method ?? 'POST',
      headers: {
        origin: opts.origin ?? ORIGIN,
        'sec-fetch-site': opts.fetchSite ?? 'same-origin',
        cookie, 'x-csrf-token': csrf,
      },
      ...(opts.body === undefined ? {} : { body: opts.body }),
    });
  }
  async function login() {
    const start = await handler(post(START), env);
    assert.equal(start.status, 303);
    const url = new URL(start.headers.get('location'));
    assert.equal(url.origin, ISSUER);
    assert.equal(url.pathname, '/oauth2/auth');
    const state = url.searchParams.get('state');
    nonce = url.searchParams.get('nonce');
    const cookie = start.headers.getSetCookie()[0].split(';')[0];
    const callbackRequest = new Request(ORIGIN + CALLBACK + '?code=synthetic-code&state=' + state, {
      headers: { cookie },
    });
    const completed = await handler(callbackRequest, env);
    assert.equal(completed.status, 303);
    assert.equal(completed.headers.get('Location'), ORIGIN + '/');
    const setCookies = completed.headers.getSetCookie();
    assert.equal(setCookies.length, 2);
    return { callbackRequest, setCookies,
      cookie: setCookies.map(x => x.split(';')[0]).join('; '),
      csrf: setCookies[1].split(';')[0].split('=')[1],
    };
  }
  return {
    sqlite, db, env, handler, post, login,
    calls: () => callCount,
    setRate: value => { allowLogin = value; },
    close: () => sqlite.close(),
  };
}

void test('same-origin HTTP start and callback issue only a signed, verified session', async () => {
  const f = await fixture();
  try {
    const login = await f.login();
    assert.ok(login.setCookies[0].startsWith('__Host-logbook_session='));
    assert.match(login.setCookies[0], /HttpOnly; SameSite=Lax/);
    assert.match(login.setCookies[1], /^__Host-logbook_csrf=/);
    assert.equal(f.calls(), 1);
    assert.equal((await f.handler(login.callbackRequest, f.env)).status, 400);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 1);
    const status = await f.handler(f.post(SESSION, login.cookie), f.env);
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('Cache-Control'), 'no-store');
    const body = await status.json();
    assert.deepEqual(Object.keys(body).sort(), [
      'authenticated', 'emailVerified', 'fenceEpoch', 'healthConsentRevision', 'uid',
    ]);
    assert.match(body.uid, /^k_[A-Za-z0-9_-]{43}$/);
    assert.equal(body.emailVerified, true);
    assert.equal(body.healthConsentRevision, 0);
    assert.equal(Object.hasOwn(body, 'sessionHash'), false);
  } finally { f.close(); }
});

void test('missing cookies, wrong origin, URL aliases and forged headers fail closed', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.handler(f.post(SESSION), f.env)).status, 401);
    assert.equal((await f.handler(f.post(SESSION, '', '', { origin: 'https://attacker.invalid' }), f.env)).status, 403);
    assert.equal((await f.handler(f.post(START, '', '', { fetchSite: 'cross-site' }), f.env)).status, 403);
    assert.equal((await f.handler(f.post(START, '', '', { url: ORIGIN + START + '?returnTo=https://attacker.invalid' }), f.env)).status, 403);
    assert.equal((await f.handler(f.post(START, '', '', { body: '{}' }), f.env)).status, 403);
    assert.equal((await f.handler(f.post('/api/auth/other'), f.env)).status, 404);
    assert.equal((await f.handler(new Request(ORIGIN + START), f.env)).status, 405);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
    assert.equal(f.calls(), 0);
  } finally { f.close(); }
});

void test('CSRF-bound logout only revokes this D1 session; no device erasure or Kinde SSO claims', async () => {
  const f = await fixture();
  try {
    const login = await f.login();
    assert.equal((await f.handler(f.post(LOGOUT, login.cookie, 'forged'), f.env)).status, 403);
    assert.equal((await f.handler(f.post(SESSION, login.cookie), f.env)).status, 200);
    const result = await f.handler(f.post(LOGOUT, login.cookie, login.csrf), f.env);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { status: 'signed-out' });
    assert.equal(result.headers.getSetCookie().length, 2);
    assert.ok(result.headers.getSetCookie().every(x => x.includes('Max-Age=0')));
    assert.equal((await f.handler(f.post(SESSION, login.cookie), f.env)).status, 401);
    assert.equal(f.calls(), 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE revoked_at_ms IS NOT NULL').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 1);
  } finally { f.close(); }
});

void test('logout remains available when the Kinde provider environment is unavailable', async () => {
  const f = await fixture();
  try {
    const login = await f.login();
    delete f.env.KINDE_CLIENT_SECRET;
    assert.equal((await f.handler(f.post(SESSION, login.cookie), f.env)).status, 200);
    assert.equal((await f.handler(f.post(LOGOUT, login.cookie, login.csrf), f.env)).status, 200);
    assert.equal((await f.handler(f.post(START), f.env)).status, 503);
  } finally { f.close(); }
});

void test('missing trusted service bindings or rate limiter cannot mint a login', async () => {
  const f = await fixture();
  try {
    const missingRate = { ...f.env, AUTH_RATE_LIMITER: undefined };
    assert.equal((await f.handler(f.post(START), missingRate)).status, 503);
    const missingDB = { ...f.env, DB: undefined };
    assert.equal((await f.handler(f.post(START), missingDB)).status, 503);
    const missingGate = { ...f.env, AUTH_GATE: undefined };
    assert.equal((await f.handler(f.post(SESSION), missingGate)).status, 503);
    assert.equal((await f.handler(f.post(LOGOUT), missingGate)).status, 503);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 0);
  } finally { f.close(); }
});

void test('login abuse limiter rejects before OAuth state creation or token exchange', async () => {
  const f = await fixture();
  try {
    f.setRate(false);
    assert.equal((await f.handler(f.post(START), f.env)).status, 429);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
    assert.equal(f.calls(), 0);
  } finally { f.close(); }
});


void test('candidate Worker is not routed publicly and shares only the disposable AuthGate D1', () => {
  const here = new URL('../../cloudflare/auth/', import.meta.url);
  const read = name => JSON.parse(readFileSync(new URL(name, here), 'utf8'));
  const candidate = read('wrangler.kinde.local.jsonc');
  const gate = read('wrangler.local.jsonc');
  const api = JSON.parse(readFileSync(new URL('../../cloudflare/api/wrangler.local.jsonc', import.meta.url), 'utf8'));
  const publicFrontend = JSON.parse(readFileSync(new URL('../../cloudflare/wrangler.jsonc', import.meta.url), 'utf8'));

  assert.equal(candidate.main, './kinde-http-worker.mjs');
  assert.equal(candidate.workers_dev, false);
  assert.equal(candidate.preview_urls, false);
  assert.equal(candidate.routes, undefined);
  assert.equal(candidate.route, undefined);
  assert.equal(candidate.vars.KINDE_CLIENT_SECRET, undefined);
  assert.equal(candidate.d1_databases[0].database_id, gate.d1_databases[0].database_id);
  assert.equal(candidate.d1_databases[0].database_id, api.d1_databases[0].database_id);
  assert.equal(candidate.d1_databases[0].database_name, gate.d1_databases[0].database_name);
  assert.equal(candidate.services[0].service, gate.name);
  assert.equal(candidate.ratelimits[0].name, 'AUTH_RATE_LIMITER');
  assert.deepEqual(publicFrontend.assets.run_worker_first, ['/__/auth', '/__/auth/*']);
  assert.equal(publicFrontend.main, './auth-proxy.mjs');
});


void test('module entrypoint is a safe candidate Worker with strict 404 on unsupported paths', async () => {
  const response = await kindeHttpWorker.fetch(new Request(ORIGIN + '/api/auth/unknown'), {});
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
