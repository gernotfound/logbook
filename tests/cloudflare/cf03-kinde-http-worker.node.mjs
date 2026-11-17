import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import kindeHttpWorker, { createKindeHttpHandler } from '../../cloudflare/auth/kinde-http-worker.mjs';
import gate from '../../cloudflare/auth/session-gate.mjs';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';
import apiWorker from '../../cloudflare/api/worker.mjs';
import { enrollIndependentOwner, recordVerifiedInitialConsent } from '../../cloudflare/recovery/independent-owner-fence.mjs';
import { routeCandidateFirstPartyApi } from '../../cloudflare/first-party-api-candidate.mjs';

const ORIGIN = 'https://candidate.invalid';
const ISSUER = 'https://synthetic-kinde.example';
const CLIENT = 'synthetic-kinde-client';
const API_AUD = 'thelogbook:synthetic-api';
const KEK = Buffer.alloc(32, 41).toString('base64');
const SESSION = '/api/auth/session';
const START = '/api/auth/kinde/start';
const CALLBACK = '/api/auth/kinde/callback';
const LOGOUT = '/api/auth/logout';

class Stmt {
  constructor(sqlite, sql, args = []) { this.sqlite = sqlite; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.sqlite, this.sql, args); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.args) }; }
  async run() {
    const r = this.sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: r.changes } };
  }
}
class DB {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Stmt(this.sqlite, sql); }
  withSession(mode) { assert.equal(mode, 'first-primary'); return this; }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const output = [];
      for (const statement of statements) {
        output.push(statement.sql.trimStart().toUpperCase().startsWith('SELECT')
          ? await statement.all() : await statement.run());
      }
      this.sqlite.exec('COMMIT');
      return output;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  // The identity gate joins sync_subjects even before consent. Exercise the
  // complete current D1 schema, not a partial Auth-only test database.
  const migrations = readdirSync(new URL('../../cloudflare/api/migrations/', import.meta.url))
    .filter(name => /^00(?:0[1-9]|10)_[a-z0-9_]+\.sql$/.test(name)).sort();
  assert.deepEqual(migrations.map(name => name.slice(0, 4)),
    Array.from({ length: 10 }, (_, index) => String(index + 1).padStart(4, '0')));
  for (const file of migrations) {
    sqlite.exec(readFileSync(new URL('../../cloudflare/api/migrations/' + file, import.meta.url), 'utf8'));
  }
  const db = new DB(sqlite);
  // A wholly separate SQLite D1 models the CF-08 registry, not a copy of
  // identity or health data. Production consent integration remains pending.
  const registry = new DatabaseSync(':memory:');
  for (const name of ['0001_independent_owner_fences.sql', '0002_block_replace_bypass.sql']) {
    registry.exec(readFileSync(new URL('../../cloudflare/recovery/migrations/' + name, import.meta.url), 'utf8'));
  }
  registry.prepare("UPDATE recovery_control SET mode='open',generation=2 WHERE singleton=1").run();
  const recoveryDb = new DB(registry);
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const keySet = createLocalJWKSet({
    keys: [{ ...await exportJWK(publicKey), kid: 'synthetic', alg: 'RS256', use: 'sig' }],
  });
  let nonce;
  let callCount = 0;
  let subject = 'kp_synthetic_user_20261114';
  let loginCount = 0;
  const fetchImpl = async (url, options) => {
    callCount += 1;
    assert.equal(url, ISSUER + '/oauth2/token');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.body.get('client_secret'), 'synthetic-private-secret');
    const now = Math.floor(Date.now() / 1000);
    const sub = subject;
    const accessToken = await new SignJWT({ azp: CLIENT, sub })
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
      .setIssuer(ISSUER).setAudience(API_AUD)
      .setIssuedAt(now - 2).setExpirationTime(now + 300).sign(privateKey);
    const at_hash = createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url');
    const idToken = await new SignJWT({
      azp: CLIENT, sub, nonce,
      email: sub === 'kp_synthetic_user_20261114' ? 'verified@example.invalid' : 'other@example.invalid',
      email_verified: true, auth_time: now - 60, at_hash,
    }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
      .setIssuer(ISSUER).setAudience(CLIENT).setIssuedAt(now - 2)
      .setExpirationTime(now + 300).sign(privateKey);
    return Response.json({ access_token: accessToken, id_token: idToken });
  };
  let allowLogin = true;
  const env = {
    APP_ORIGIN: ORIGIN, KINDE_ISSUER: ISSUER,
    KINDE_CLIENT_ID: CLIENT, KINDE_CLIENT_SECRET: 'synthetic-private-secret',
    KINDE_API_AUDIENCE: API_AUD, KINDE_ID_TOKEN_AUDIENCE: ISSUER,
    DB: db, RECOVERY_DB: recoveryDb, CLOUD_ACCOUNT_KEK_V1: KEK,
    CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
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
    loginCount += 1;
    const callbackRequest = new Request(ORIGIN + CALLBACK + '?code=synthetic-code-' + loginCount + '&scope=openid%20email%20profile&state=' + state, {
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
    async recordIndependentInitialConsent(uid) {
      await enrollIndependentOwner(recoveryDb, uid);
      await recordVerifiedInitialConsent(db, recoveryDb, uid);
    },
    calls: () => callCount,
    setNonce: value => { nonce = value; },
    setRate: value => { allowLogin = value; },
    setSubject: value => { subject = value; },
    close() { registry.close(); sqlite.close(); },
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

void test('a live Kinde session reports a non-current email proof without changing cookie or epoch', async () => {
  const f = await fixture();
  try {
    const login = await f.login();
    const first = await f.handler(f.post(SESSION, login.cookie), f.env);
    assert.equal(first.status, 200);
    const verified = await first.json();
    assert.equal(verified.emailVerified, true);
    assert.equal((await cloudCall(f, '/v1/consent/initial', login, acceptance)).status, 200);
    const before = f.sqlite.prepare('SELECT * FROM auth_sessions WHERE uid=?').get(verified.uid);
    assert.ok(before);
    const sessionCount = f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n;

    // A future-dated proof is the only non-current verification that keeps
    // this D1 schema's session epoch: clearing the proof requires an epoch bump.
    f.sqlite.prepare('UPDATE auth_principals SET verified_at_ms=? WHERE uid=?')
      .run(Date.now() + 3_600_000, verified.uid);
    const result = await f.handler(f.post(SESSION, login.cookie), f.env);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), {
      ...verified, emailVerified: false, healthConsentRevision: 1,
    });
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.equal(result.headers.get('Set-Cookie'), null);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM auth_sessions WHERE uid=?').get(verified.uid), before);
    assert.equal((await cloudCall(f, '/v1/sync/control', login, {})).status, 401);
    assert.equal((await cloudCall(f, '/v1/cloud-key/sync', login)).status, 401);
    assert.equal((await cloudCall(f, '/v1/consent/initial', login, acceptance)).status, 401);
    await assert.rejects(issueVerifiedSession(f.db, verified.uid));
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, sessionCount);

    const withdrawn = await cloudCall(f, '/v1/consent/withdraw', login, {
      action: 'withdraw', expectedRevision: 1, confirmsErasure: true,
    });
    assert.equal(withdrawn.status, 200);
    assert.equal((await f.handler(f.post(SESSION, login.cookie), f.env)).status, 200);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, sessionCount);
  } finally { f.close(); }
});

void test('real email-proof removal requires a new epoch and denies the original session', async () => {
  const f = await fixture();
  try {
    const login = await f.login();
    const verified = await (await f.handler(f.post(SESSION, login.cookie), f.env)).json();
    const before = f.sqlite.prepare('SELECT * FROM auth_sessions WHERE uid=?').get(verified.uid);
    assert.throws(() => f.sqlite.prepare(
      'UPDATE auth_principals SET verified_at_ms=NULL WHERE uid=?',
    ).run(verified.uid), /auth-principal-regression/);
    assert.equal((await f.handler(f.post(SESSION, login.cookie), f.env)).status, 200);

    f.sqlite.prepare('UPDATE auth_principals SET verified_at_ms=NULL, auth_epoch=auth_epoch+1 WHERE uid=?')
      .run(verified.uid);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM auth_sessions WHERE uid=?').get(verified.uid), before);
    assert.equal((await f.handler(f.post(SESSION, login.cookie), f.env)).status, 401);
    await assert.rejects(issueVerifiedSession(f.db, verified.uid));
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 1);
  } finally { f.close(); }
});

void test('session status fails closed for revoked, expired, superseded or disabled accounts', async () => {
  // Backdate issuance and expiry together: issued_at+1 may still be in the
  // future on a fast run, and the schema requires expiry > issuance.
  const scenarios = [
    ['revoked', 'UPDATE auth_sessions SET revoked_at_ms=issued_at_ms'],
    ['idle-expired', 'UPDATE auth_sessions SET issued_at_ms=issued_at_ms-60000, idle_expires_at_ms=issued_at_ms-30000'],
    ['absolute-expired', 'UPDATE auth_sessions SET issued_at_ms=issued_at_ms-60000, idle_expires_at_ms=issued_at_ms-30000, absolute_expires_at_ms=issued_at_ms-30000'],
    ['epoch-changed', 'UPDATE auth_principals SET auth_epoch=auth_epoch+1'],
    ['owner-disabled', "UPDATE auth_principals SET status='disabled'"],
  ];
  for (const [name, mutation] of scenarios) {
    const f = await fixture();
    try {
      const login = await f.login();
      assert.equal((await f.handler(f.post(SESSION, login.cookie), f.env)).status, 200, name);
      f.sqlite.exec(mutation);
      if (name.endsWith('expired')) {
        const expired = f.sqlite.prepare('SELECT idle_expires_at_ms,absolute_expires_at_ms FROM auth_sessions').get();
        assert.ok(expired.idle_expires_at_ms < Date.now(), name);
        if (name === 'absolute-expired') assert.ok(expired.absolute_expires_at_ms < Date.now(), name);
      }
      const response = await f.handler(f.post(SESSION, login.cookie), f.env);
      assert.equal(response.status, 401, name);
      assert.deepEqual(await response.json(), { error: 'unauthorized' }, name);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    } finally { f.close(); }
  }
});

void test('session status uses trusted owner, and rejects malformed private-gate claims', async () => {
  const f = await fixture();
  try {
    const a = await f.login();
    const ownerA = await (await f.handler(f.post(SESSION, a.cookie), f.env)).json();
    f.setSubject('kp_other_synthetic_user_20261114');
    const b = await f.login();
    const ownerB = await (await f.handler(f.post(SESSION, b.cookie), f.env)).json();
    assert.notEqual(ownerA.uid, ownerB.uid);

    const forged = new Request(ORIGIN + SESSION, {
      method: 'POST',
      headers: {
        origin: ORIGIN, 'sec-fetch-site': 'same-origin',
        cookie: a.cookie, 'x-user-id': ownerB.uid,
      },
    });
    assert.deepEqual(await (await f.handler(forged, f.env)).json(), ownerA);
    assert.deepEqual(await (await f.handler(f.post(SESSION, b.cookie), f.env)).json(), ownerB);

    const trustedFetch = f.env.AUTH_GATE.fetch;
    for (const malformed of [
      { uid: ownerB.uid + 'trailing' }, { uid: 'firebase-user' },
      { emailVerified: undefined }, { emailVerified: 'false' },
      { emailVerified: null }, { authenticated: false },
      { rateGatePassed: false }, { fenceEpoch: 0 },
      { healthConsentRevision: -1 }, { sessionHash: 'untrusted' },
    ]) {
      const env = { ...f.env, AUTH_GATE: {
        fetch: async request => {
          const granted = await trustedFetch(request);
          assert.equal(granted.status, 200);
          return Response.json({ ...await granted.json(), ...malformed });
        },
      } };
      const response = await f.handler(f.post(SESSION, a.cookie), env);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'unavailable' });
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 2);
  } finally { f.close(); }
});

void test('native empty form POST can initiate OAuth without allowing a body or forged length', async () => {
  const f = await fixture();
  try {
    const form = f.post(START, '', '', { body: '' });
    assert.notEqual(form.body, null);
    assert.equal(form.headers.get('content-type'), 'text/plain;charset=UTF-8');
    const response = await f.handler(form, f.env);
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get('Location')).pathname, '/oauth2/auth');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 1);

    assert.equal((await f.handler(f.post(START, '', '', { body: 'attacker=1' }), f.env)).status, 403);
    const forged = new Request(ORIGIN + START, {
      method: 'POST',
      headers: {
        origin: ORIGIN, 'sec-fetch-site': 'same-origin',
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': '0',
      },
      body: 'x',
    });
    assert.equal((await f.handler(forged, f.env)).status, 403);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 1);
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

void test('OAuth start and callback require the private authorization service before touching identity state', async () => {
  const f = await fixture();
  try {
    const missingGate = { ...f.env, AUTH_GATE: undefined };
    assert.equal((await f.handler(f.post(START), missingGate)).status, 503);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);

    const started = await f.handler(f.post(START), f.env);
    assert.equal(started.status, 303);
    const state = new URL(started.headers.get('location')).searchParams.get('state');
    const browserCookie = started.headers.getSetCookie()[0].split(';')[0];
    const callback = new Request(ORIGIN + CALLBACK + '?code=synthetic-code&state=' + state, {
      headers: { cookie: browserCookie },
    });
    assert.equal((await f.handler(callback, missingGate)).status, 503);
    assert.equal(f.calls(), 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
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



const acceptance = {
  action: 'accept-initial', expectedRevision: 0,
  acceptance: {
    confirmsOver18: true, acceptedHealthData: true, acceptedTerms: true,
    privacyVersion: '1.3.9', termsVersion: '1.2.5',
  },
};

// A signed synthetic Kinde exchange runs through the production HTTP, AuthGate,
// consent and D1 handlers. This does not attest Kinde itself or AEAD recovery.
async function cloudCall(f, route, login, body, csrf = login.csrf) {
  const headers = {
    origin: ORIGIN, 'sec-fetch-site': 'same-origin',
    cookie: login.cookie, 'x-csrf-token': csrf,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await apiWorker.fetch(new Request(ORIGIN + route, {
    method: 'POST', headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), {
    ...f.env, API_ORIGIN: ORIGIN,
    CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
  });
  return { status: response.status, body: await response.json() };
}

void test('Kinde callback crosses consent and D1 replica gates only after explicit verified acceptance', async () => {
  const f = await fixture();
  try {
    const login = await f.login();
    const trustedSession = await (await f.handler(f.post(SESSION, login.cookie), f.env)).json();
    assert.deepEqual(await cloudCall(f, '/v1/consent/status', login), {
      status: 200, body: { uid: trustedSession.uid,
        status: 'unregistered', revision: 0, fenceEpoch: 1 },
    });
    assert.equal((await cloudCall(f, '/v1/sync/control', login, {})).status, 401);
    assert.equal((await cloudCall(f, '/v1/consent/initial', login, acceptance, 'invalid-csrf')).status, 403);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_subjects').get().n, 0);

    const accepted = await cloudCall(f, '/v1/consent/initial', login, acceptance);
    assert.equal(accepted.status, 200);
    await f.recordIndependentInitialConsent(accepted.body.uid);
    assert.deepEqual({
      uid: accepted.body.uid, status: accepted.body.status, revision: accepted.body.revision,
      fenceEpoch: accepted.body.fenceEpoch,
    }, { uid: trustedSession.uid, status: 'active', revision: 1, fenceEpoch: 1 });
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM health_consent_acceptances').get().n, 1);
    assert.equal((await cloudCall(f, '/v1/consent/initial', login, acceptance)).status, 409);
    const session = await f.handler(f.post(SESSION, login.cookie), f.env);
    assert.equal((await session.json()).healthConsentRevision, 1);
    assert.deepEqual(await cloudCall(f, '/v1/sync/control', login, {}), {
      status: 200, body: { uid: trustedSession.uid, revision: 0, consentRevision: 1, fenceEpoch: 1, replicas: {} },
    });

    const claim = {
      mutationId: 'kinde-synthetic-claim-0001', expectedRevision: 0,
      expectedFenceEpoch: 1, consentRevision: 1,
      candidateReplicaId: 'kinde-synthetic-device-0001',
      currentReplica: null, checkpointClock: {},
    };
    assert.equal((await cloudCall(f, '/v1/sync/replica/claim', login, claim, 'invalid-csrf')).status, 403);
    // The current D1 triggers refuse membership writes even after valid Kinde
    // and explicit consent until this owner has a durable, wrapped ADK.
    const withoutKey = await cloudCall(f, '/v1/sync/replica/claim', login, claim);
    assert.deepEqual(withoutKey, { status: 428, body: { error: 'cloud-key-required' } });
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_writable_cloud_key').get().n, 0);

    const key = await cloudCall(f, '/v1/cloud-key/sync', login);
    assert.equal(key.status, 200);
    assert.equal(key.body.format, 'thelogbook-account-data-key');
    assert.equal(Buffer.from(key.body.key, 'base64').length, 32);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_account_keys').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_key_issuance').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_writable_cloud_key').get().n, 1);
    const registered = await cloudCall(f, '/v1/sync/replica/claim', login, claim);
    assert.equal(registered.status, 200);
    assert.equal(registered.body.action, 'register');
    assert.equal(registered.body.replica.replicaId, claim.candidateReplicaId);
    assert.equal((await cloudCall(f, '/v1/sync/control', login, {})).body.revision, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas').get().n, 1);
  } finally { f.close(); }
});

void test('Kinde consent withdrawal fences replica but permits status and session logout', async () => {
  const f = await fixture();
  try {
    const login = await f.login();
    assert.equal((await cloudCall(f, '/v1/consent/initial', login, acceptance)).status, 200);
    const withdrawn = await cloudCall(f, '/v1/consent/withdraw', login, {
      action: 'withdraw', expectedRevision: 1, confirmsErasure: true,
    });
    assert.deepEqual(withdrawn, { status: 200, body: {
      status: 'withdrawn', revision: 1, fenceEpoch: 1, deletionStatus: 'pending',
    } });
    assert.equal((await cloudCall(f, '/v1/sync/control', login, {})).status, 401);
    assert.equal((await cloudCall(f, '/v1/consent/status', login)).body.status, 'withdrawn');
    assert.equal(f.sqlite.prepare('SELECT status FROM health_erasure_jobs').get().status, 'pending');
    assert.equal((await f.handler(f.post(SESSION, login.cookie), f.env)).status, 200);
    assert.equal((await f.handler(f.post(LOGOUT, login.cookie, login.csrf), f.env)).status, 200);
    assert.equal((await f.handler(f.post(SESSION, login.cookie), f.env)).status, 401);
    assert.equal((await cloudCall(f, '/v1/consent/status', login)).status, 401);
    assert.equal(f.sqlite.prepare('SELECT status FROM health_erasure_jobs').get().status, 'pending');
  } finally { f.close(); }
});

void test('Kinde signed subjects retain separate D1 consent and replica registers', async () => {
  const f = await fixture();
  try {
    const a = await f.login();
    const principalA = await (await f.handler(f.post(SESSION, a.cookie), f.env)).json();
    assert.equal((await cloudCall(f, '/v1/consent/initial', a, acceptance)).status, 200);
    await f.recordIndependentInitialConsent(principalA.uid);
    const claim = {
      mutationId: 'kinde-synthetic-claim-owner-a', expectedRevision: 0,
      expectedFenceEpoch: 1, consentRevision: 1,
      candidateReplicaId: 'kinde-synthetic-device-owner-a',
      currentReplica: null, checkpointClock: {},
    };
    assert.deepEqual(await cloudCall(f, '/v1/sync/replica/claim', a, claim),
      { status: 428, body: { error: 'cloud-key-required' } });
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
    assert.equal((await cloudCall(f, '/v1/cloud-key/sync', a)).status, 200);
    assert.equal((await cloudCall(f, '/v1/sync/replica/claim', a, claim)).status, 200);
    f.setSubject('kp_other_synthetic_user_20261114');
    const b = await f.login();
    const principalB = await (await f.handler(f.post(SESSION, b.cookie), f.env)).json();
    assert.notEqual(principalA.uid, principalB.uid);
    assert.equal((await cloudCall(f, '/v1/sync/control', b, {})).status, 401);
    assert.deepEqual((await cloudCall(f, '/v1/consent/status', b)).body,
      { uid: principalB.uid, status: 'unregistered', revision: 0, fenceEpoch: 1 });
    assert.equal((await cloudCall(f, '/v1/consent/initial', b, acceptance)).status, 200);
    await f.recordIndependentInitialConsent(principalB.uid);
    assert.deepEqual((await cloudCall(f, '/v1/sync/control', b, {})).body.replicas, {});
    const claimB = {
      ...claim, mutationId: 'kinde-synthetic-claim-owner-b',
      candidateReplicaId: 'kinde-synthetic-device-owner-b',
    };
    assert.deepEqual(await cloudCall(f, '/v1/sync/replica/claim', b, claimB),
      { status: 428, body: { error: 'cloud-key-required' } });
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 1);
    assert.equal((await cloudCall(f, '/v1/cloud-key/sync', b)).status, 200);
    assert.equal((await cloudCall(f, '/v1/sync/replica/claim', b, claimB)).status, 200);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas').get().n, 2);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_account_keys').get().n, 2);
    assert.equal(Object.keys((await cloudCall(f, '/v1/sync/control', b, {})).body.replicas).length, 1);
    assert.equal(Object.keys((await cloudCall(f, '/v1/sync/control', a, {})).body.replicas).length, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 2);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM health_consent_acceptances').get().n, 2);
  } finally { f.close(); }
});

void test('first-party gateway completes synthetic Kinde → consent → ADK → D1 → logout with production Workers', async () => {
  const f = await fixture();
  try {
    // Exercise the real HTTP identity handler and private consent boundary
    // Workers and ten-migration SQLite schema behind the future gateway.
    // Token signing is synthetic; no request reaches a provider account.
    const gateway = {
      APP_ORIGIN: ORIGIN,
      KINDE_HTTP: { fetch: request => f.handler(request, f.env) },
      D1_API: { fetch: request => apiWorker.fetch(request, { ...f.env, API_ORIGIN: ORIGIN }) },
    };
    const through = request => routeCandidateFirstPartyApi(request, gateway);
    const start = await through(f.post(START));
    assert.equal(start.status, 303);
    const authorize = new URL(start.headers.get('location'));
    assert.equal(authorize.origin, ISSUER);
    f.setNonce(authorize.searchParams.get('nonce'));
    const browserBinding = start.headers.getSetCookie()[0].split(';')[0];
    const returned = await through(new Request(ORIGIN + CALLBACK
      + '?code=short&state=' + authorize.searchParams.get('state'), {
      headers: { cookie: browserBinding, 'sec-fetch-site': 'cross-site' },
    }));
    assert.equal(returned.status, 303);
    assert.equal(returned.headers.get('location'), ORIGIN + '/');
    const issuedCookies = returned.headers.getSetCookie();
    assert.equal(issuedCookies.length, 2);
    const cookie = issuedCookies.map(value => value.split(';')[0]).join('; ');
    const csrf = issuedCookies[1].split(';')[0].split('=')[1];
    const principal = await (await through(f.post(SESSION, cookie))).json();
    assert.equal(principal.authenticated, true);
    assert.equal(principal.emailVerified, true);
    assert.equal(principal.healthConsentRevision, 0);

    const api = async (route, payload, suppliedCsrf = csrf) => {
      const headers = {
        origin: ORIGIN, 'sec-fetch-site': 'same-origin',
        cookie, 'x-csrf-token': suppliedCsrf,
      };
      if (payload !== undefined) headers['content-type'] = 'application/json';
      const response = await through(new Request(ORIGIN + route, {
        method: 'POST', headers,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      }));
      return { status: response.status, body: await response.json() };
    };

    assert.deepEqual(await api('/v1/consent/status'), {
      status: 200, body: { uid: principal.uid, status: 'unregistered', revision: 0, fenceEpoch: 1 },
    });
    assert.equal((await api('/v1/sync/control', {})).status, 401);
    assert.equal((await api('/v1/consent/initial', acceptance, 'invalid-csrf')).status, 403);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM health_consent_acceptances').get().n, 0);

    const consent = await api('/v1/consent/initial', acceptance);
    assert.equal(consent.status, 200);
    await f.recordIndependentInitialConsent(consent.body.uid);
    assert.equal(consent.body.uid, principal.uid);
    assert.equal((await (await through(f.post(SESSION, cookie))).json()).healthConsentRevision, 1);
    const claim = {
      mutationId: 'a'.repeat(20), expectedRevision: 0,
      expectedFenceEpoch: 1, consentRevision: 1,
      candidateReplicaId: 'b'.repeat(20),
      currentReplica: null, checkpointClock: {},
    };
    assert.deepEqual(await api('/v1/sync/replica/claim', claim),
      { status: 428, body: { error: 'cloud-key-required' } });
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas').get().n, 0);
    const key = await api('/v1/cloud-key/sync');
    assert.equal(key.status, 200);
    assert.equal(Buffer.from(key.body.key, 'base64').length, 32);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_account_keys').get().n, 1);
    assert.equal((await api('/v1/sync/replica/claim', claim)).status, 200);
    assert.equal((await api('/v1/sync/control', {})).body.revision, 1);

    const withdrawal = await api('/v1/consent/withdraw', {
      action: 'withdraw', expectedRevision: 1, confirmsErasure: true,
    });
    assert.equal(withdrawal.status, 200);
    assert.equal(withdrawal.body.status, 'withdrawn');
    assert.equal((await api('/v1/sync/control', {})).status, 401);
    assert.equal(f.sqlite.prepare('SELECT status FROM health_erasure_jobs').get().status, 'pending');
    assert.equal((await through(f.post(LOGOUT, cookie, csrf))).status, 200);
    assert.equal((await through(f.post(SESSION, cookie))).status, 401);
    assert.equal((await api('/v1/consent/status')).status, 401);
  } finally { f.close(); }
});

void test('private Kinde Worker remains unrouted while frontend exposes only four OAuth endpoints', () => {
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
  assert.deepEqual(publicFrontend.assets.run_worker_first, ['/__/auth', '/__/auth/*', '/api/auth/kinde/start', '/api/auth/kinde/callback', '/api/auth/session', '/api/auth/logout']);
  assert.equal(publicFrontend.main, './auth-proxy.mjs');
});


void test('module entrypoint is a safe candidate Worker with strict 404 on unsupported paths', async () => {
  const response = await kindeHttpWorker.fetch(new Request(ORIGIN + '/api/auth/unknown'), {});
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
