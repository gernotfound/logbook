import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createKindeOAuthFlow } from '../../cloudflare/auth/kinde-oauth-flow.mjs';

const issuer = 'https://synthetic-kinde.example';
const appOrigin = 'https://candidate.example.invalid';
const clientId = 'synthetic-client-id-123';
const apiAudience = 'thelogbook:synthetic-api';

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of ['0003_auth_session_gate.sql', '0008_kinde_oauth_attempts.sql']) {
    sqlite.exec(readFileSync(new URL('../../cloudflare/api/migrations/' + migration, import.meta.url), 'utf8'));
  }
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              const out = sqlite.prepare(sql).run(...params);
              return { success: true, meta: { changes: out.changes } };
            },
            async first() { return sqlite.prepare(sql).get(...params) ?? null; },
          };
        },
      };
    },
    withSession(mode) {
      assert.equal(mode, 'first-primary');
      return this;
    },
  };
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const keySet = createLocalJWKSet({
    keys: [{ ...await exportJWK(publicKey), kid: 'synthetic', use: 'sig', alg: 'RS256' }],
  });
  let rateAllowed = true;
  let tokenStatus = 200;
  let tokenPayload = null;
  let issuedTokens = 0;
  const nonceByCode = new Map();
  const fetchImpl = async (url, init) => {
    assert.equal(url, issuer + '/oauth2/token');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const body = init.body;
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('client_id'), clientId);
    assert.equal(body.get('client_secret'), 'synthetic-server-secret-not-real');
    assert.equal(body.get('redirect_uri'), appOrigin + '/api/auth/kinde/callback');
    assert.match(body.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
    const code = body.get('code');
    const nonce = nonceByCode.get(code);
    const now = Math.floor(Date.now() / 1000);
    issuedTokens += 1;
    if (tokenStatus !== 200) return new Response('{}', { status: tokenStatus, headers: { 'Content-Type': 'application/json' } });
    let tokens;
    if (tokenPayload) tokens = tokenPayload;
    else {
      const accessToken = await new SignJWT({ azp: clientId, sub: 'kp_verified_test_12345' })
        .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
        .setIssuer(issuer).setAudience(apiAudience).setIssuedAt(now - 1).setExpirationTime(now + 300)
        .sign(privateKey);
      const at_hash = createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url');
      const idToken = await new SignJWT({
        azp: clientId, sub: 'kp_verified_test_12345',
        nonce, auth_time: now - 60,
        email: 'test@example.invalid', email_verified: true, at_hash,
      }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
        .setIssuer(issuer).setAudience(issuer).setIssuedAt(now - 1).setExpirationTime(now + 300)
        .sign(privateKey);
      tokens = { access_token: accessToken, id_token: idToken };
    }
    return new Response(JSON.stringify(tokens), { headers: { 'Content-Type': 'application/json' } });
  };
  const config = {
    issuer, clientId, clientSecret: 'synthetic-server-secret-not-real',
    apiAudience, idTokenAudience: issuer, appOrigin,
  };
  const oauth = createKindeOAuthFlow(config, {
    rateLimit: async request => {
      assert.ok(request instanceof Request);
      return rateAllowed;
    },
    fetchImpl, keySet,
  });
  function startRequest(cookie = '') {
    return new Request(appOrigin + '/api/auth/kinde/start', {
      method: 'POST', headers: { origin: appOrigin, 'sec-fetch-site': 'same-origin', cookie },
    });
  }
  async function start(cookie = '') {
    const response = await oauth.start(db, startRequest(cookie));
    assert.equal(response.status, 303);
    const auth = new URL(response.headers.get('Location'));
    const boundCookie = response.headers.getSetCookie()[0].split(';')[0];
    assert.equal(auth.origin, issuer);
    assert.equal(auth.pathname, '/oauth2/auth');
    assert.equal(auth.searchParams.get('response_type'), 'code');
    assert.equal(auth.searchParams.get('scope'), 'openid email profile');
    assert.equal(auth.searchParams.get('audience'), apiAudience);
    assert.equal(auth.searchParams.get('client_id'), clientId);
    assert.equal(auth.searchParams.get('redirect_uri'), appOrigin + '/api/auth/kinde/callback');
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(auth.searchParams.get('code_challenge').length, 43);
    assert.equal(auth.searchParams.has('client_secret'), false);
    assert.equal(auth.searchParams.has('code_verifier'), false);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return { auth, cookie: boundCookie, state: auth.searchParams.get('state'), nonce: auth.searchParams.get('nonce') };
  }
  function callback(attempt, code = 'good-code', cookie = attempt.cookie) {
    nonceByCode.set(code, attempt.nonce);
    return new Request(appOrigin + '/api/auth/kinde/callback?state=' + attempt.state + '&code=' + code,
      { headers: { cookie } });
  }
  return {
    sqlite, db, oauth, startRequest, start, callback, config,
    setRate: value => { rateAllowed = value; },
    setStatus: value => { tokenStatus = value; },
    setPayload: value => { tokenPayload = value; },
    calls: () => issuedTokens,
    close: () => sqlite.close(),
  };
}

void test('Kinde server flow stores hashed state/browser and verifies SHA-256 PKCE challenge', async () => {
  const f = await fixture();
  try {
    const a = await f.start();
    const saved = f.sqlite.prepare('SELECT * FROM auth_oauth_attempts').get();
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 1);
    assert.equal(saved.state_hash, createHash('sha256').update(a.state).digest('hex'));
    assert.notEqual(saved.browser_hash, a.cookie.split('=')[1]);
    assert.equal(saved.browser_hash, createHash('sha256').update(a.cookie.split('=')[1]).digest('hex'));
    assert.equal(saved.nonce, a.nonce);
    assert.equal(a.auth.searchParams.get('code_challenge'),
      createHash('sha256').update(saved.code_verifier).digest('base64url'));
    assert.equal(a.cookie.startsWith('__Host-logbook_oauth='), true);
  } finally { f.close(); }
});

void test('signed and verified callback mints one owner and one session; replay cannot mint again', async () => {
  const f = await fixture();
  try {
    const a = await f.start();
    const request = f.callback(a);
    const response = await f.oauth.complete(f.db, request);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('Location'), appOrigin + '/');
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.match(cookies[0], /^__Host-logbook_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax/);
    assert.match(cookies[1], /^__Host-logbook_csrf=[A-Za-z0-9_-]{43}; Path=\/; Secure; SameSite=Lax/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
    assert.equal((await f.oauth.complete(f.db, request)).status, 400);
    assert.equal(f.calls(), 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 1);
  } finally { f.close(); }
});

void test('state binding denies different browser without burning the legitimate attempt', async () => {
  const f = await fixture();
  try {
    const a = await f.start();
    const wrong = '__Host-logbook_oauth=' + Buffer.alloc(32, 9).toString('base64url');
    assert.equal((await f.oauth.complete(f.db, f.callback(a, 'good-code', wrong))).status, 400);
    assert.equal((await f.oauth.complete(f.db, f.callback(a, 'good-code', ''))).status, 400);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 1);
    assert.equal(f.calls(), 0);
    assert.equal((await f.oauth.complete(f.db, f.callback(a))).status, 303);
  } finally { f.close(); }
});

void test('parallel tabs reuse browser binding without sharing OAuth state or verifier', async () => {
  const f = await fixture();
  try {
    const a = await f.start();
    const b = await f.start(a.cookie);
    assert.equal(a.cookie, b.cookie);
    assert.notEqual(a.state, b.state);
    assert.notEqual(a.nonce, b.nonce);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 2);
    assert.equal((await f.oauth.complete(f.db, f.callback(b, 'code-b'))).status, 303);
    assert.equal((await f.oauth.complete(f.db, f.callback(a, 'code-a'))).status, 303);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 2);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 1);
  } finally { f.close(); }
});

void test('expired state, OAuth denial and duplicate query parameters cannot issue sessions', async () => {
  const f = await fixture();
  try {
    const a = await f.start();
    f.sqlite.exec('UPDATE auth_oauth_attempts SET issued_at_ms = 1, expires_at_ms = 2');
    assert.equal((await f.oauth.complete(f.db, f.callback(a))).status, 400);
    const b = await f.start(a.cookie);
    const denied = new Request(appOrigin + '/api/auth/kinde/callback?state=' + b.state +
      '&error=access_denied', { headers: { cookie: b.cookie } });
    assert.equal((await f.oauth.complete(f.db, denied)).status, 401);
    assert.equal((await f.oauth.complete(f.db, f.callback(b))).status, 400);
    const c = await f.start(b.cookie);
    const bad = f.callback(c);
    assert.equal((await f.oauth.complete(f.db, new Request(bad.url + '&state=' + c.state,
      { headers: { cookie: c.cookie } }))).status, 400);
    assert.equal((await f.oauth.complete(f.db, f.callback(c))).status, 303);
    assert.equal(f.calls(), 1);
  } finally { f.close(); }
});

void test('provider failure or malformed token response consumes state, never returns cookies', async () => {
  const f = await fixture();
  try {
    f.setStatus(500);
    let a = await f.start();
    assert.equal((await f.oauth.complete(f.db, f.callback(a))).status, 503);
    f.setStatus(200);
    f.setPayload({ access_token: 'invalid', id_token: 'invalid' });
    a = await f.start(a.cookie);
    assert.equal((await f.oauth.complete(f.db, f.callback(a))).status, 503);
    f.setPayload({ access_token: 'x'.repeat(8193), id_token: 'x' });
    a = await f.start(a.cookie);
    assert.equal((await f.oauth.complete(f.db, f.callback(a))).status, 503);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
  } finally { f.close(); }
});

void test('disabled identity cannot be resurrected by a valid new code', async () => {
  const f = await fixture();
  try {
    const a = await f.start();
    assert.equal((await f.oauth.complete(f.db, f.callback(a))).status, 303);
    f.sqlite.exec("UPDATE auth_principals SET status='deleted', auth_epoch=auth_epoch+1");
    const b = await f.start(a.cookie);
    assert.equal((await f.oauth.complete(f.db, f.callback(b, 'good-code-2'))).status, 503);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT status FROM auth_principals').get().status, 'deleted');
  } finally { f.close(); }
});

void test('origin mismatch, unavailable rate gate and malformed request fail without D1 writes', async () => {
  const f = await fixture();
  try {
    f.setRate(false);
    assert.equal((await f.oauth.start(f.db, f.startRequest())).status, 429);
    f.setRate(true);
    assert.equal((await f.oauth.start(f.db, new Request(appOrigin + '/api/auth/kinde/start',
      { method: 'POST', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }))).status, 403);
    assert.equal((await f.oauth.start(f.db, new Request(appOrigin + '/api/auth/kinde/start',
      { method: 'GET' }))).status, 403);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
  } finally { f.close(); }
});

void test('ambiguous state consumption fails closed before token exchange', async () => {
  const f = await fixture();
  try {
    const a = await f.start();
    const broken = {
      withSession() {
        return { prepare: () => ({ bind: () => ({
          first: async () => { throw new Error('synthetic lost D1 reply'); },
        }) }) };
      },
    };
    assert.equal((await f.oauth.complete(broken, f.callback(a))).status, 503);
    assert.equal(f.calls(), 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
  } finally { f.close(); }
});

void test('misconfiguration and missing rate gate fail before creating an issuer', async () => {
  const f = await fixture();
  try {
    assert.throws(() => createKindeOAuthFlow({ ...f.config, clientSecret: '' },
      { rateLimit: async () => true }), TypeError);
    assert.throws(() => createKindeOAuthFlow({ ...f.config, appOrigin: 'http://candidate.invalid' },
      { rateLimit: async () => true }), TypeError);
    assert.throws(() => createKindeOAuthFlow(f.config), TypeError);
  } finally { f.close(); }
});


void test('expired attempts are pruned in bounded batches before storing new state', async () => {
  const f = await fixture();
  try {
    const attempt = await f.start();
    f.sqlite.exec('UPDATE auth_oauth_attempts SET issued_at_ms = 1, expires_at_ms = 2');
    const next = await f.start(attempt.cookie);
    assert.notEqual(next.state, attempt.state);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts WHERE expires_at_ms = 2').get().n, 0);
  } finally { f.close(); }
});
