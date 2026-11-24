import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appOrigin, apiAudience, createKindeOAuthFixture as fixture } from './kinde-oauth-flow-fixture.mjs';

void test('deletion OAuth forces new authentication and yields one owner-bound proof without a new app session', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const login = await f.start();
  const issued = await f.oauth.complete(f.db, f.callback(login));
  assert.equal(issued.status, 303);
  const cookie = issued.headers.getSetCookie()[0].split(';')[0];
  const sessionHash = createHash('sha256').update(cookie.split('=')[1]).digest('hex');
  const { uid } = f.sqlite.prepare('SELECT uid FROM auth_principals').get();
  const claims = {
    authenticated: true, csrfVerified: true, rateGatePassed: true, uid, fenceEpoch: 1, sessionHash,
  };
  const deletionStart = new Request(appOrigin + '/api/auth/kinde/deletion/start', {
    method: 'POST', headers: { origin: appOrigin, 'sec-fetch-site': 'same-origin', cookie },
  });
  assert.equal((await f.deletion.start(f.db, deletionStart, { ...claims, csrfVerified: false })).status, 403);
  assert.equal((await f.deletion.start(f.db, deletionStart, { ...claims, sessionHash: 'f'.repeat(64) })).status, 403);
  const first = await f.deletion.start(f.db, deletionStart, claims);
  assert.equal(first.status, 303);
  const auth = new URL(first.headers.get('Location'));
  const [deletionCookie] = first.headers.getSetCookie();
  assert.match(deletionCookie, /^__Host-logbook_delete_oauth=/);
  assert.equal(auth.searchParams.get('max_age'), '0');
  assert.equal(auth.searchParams.get('prompt'), 'login');
  assert.equal(auth.searchParams.get('redirect_uri'), appOrigin + '/api/auth/kinde/deletion/callback');
  const saved = f.sqlite.prepare('SELECT * FROM kinde_deletion_oauth_attempts').get();
  assert.equal(auth.searchParams.get('code_challenge'),
    createHash('sha256').update(saved.code_verifier).digest('base64url'));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
  const wrongBrowser = f.deletionCallback(auth, 'wrong-browser', cookie, true);
  assert.equal(await f.deletion.complete(f.db, wrongBrowser), null);
  assert.equal(f.calls(), 1);

  const cookies = cookie + '; ' + deletionCookie.split(';')[0];
  const oldSso = f.deletionCallback(auth, 'stale-sso', cookies, false);
  assert.equal(await f.deletion.complete(f.db, oldSso), null);
  assert.equal(f.calls(), 2);
  assert.equal(await f.deletion.complete(f.db, oldSso), null);
  assert.equal(f.calls(), 2);

  const second = await f.deletion.start(f.db, deletionStart, claims);
  assert.equal(second.status, 303);
  const secondCookies = cookie + '; ' + second.headers.getSetCookie()[0].split(';')[0];
  // Make room for the synthetic user's reauthentication without sleeping.
  f.sqlite.exec('UPDATE kinde_deletion_oauth_attempts SET issued_at_ms = issued_at_ms - 5000, expires_at_ms = expires_at_ms - 5000');
  const reauthenticated = f.deletionCallback(new URL(second.headers.get('Location')), 'fresh-reauth', secondCookies, true);
  const candidates = await Promise.all([
    f.deletion.complete(f.db, reauthenticated), f.deletion.complete(f.db, reauthenticated),
  ]);
  assert.equal(candidates.filter(Boolean).length, 1);
  const proof = candidates.find(Boolean);
  assert.ok(Number.isSafeInteger(proof.authenticatedAtMs));
  assert.deepEqual(proof, { uid, authEpoch: 1, authenticatedAtMs: proof.authenticatedAtMs, sessionHash });
  assert.equal(f.calls(), 3);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 1);
});

void test('deletion OAuth fails closed when Kinde cannot attest authentication time', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const login = await f.start();
  const issued = await f.oauth.complete(f.db, f.callback(login));
  const cookie = issued.headers.getSetCookie()[0].split(';')[0];
  const sessionHash = createHash('sha256').update(cookie.split('=')[1]).digest('hex');
  const { uid } = f.sqlite.prepare('SELECT uid FROM auth_principals').get();
  const claims = {
    authenticated: true, csrfVerified: true, rateGatePassed: true, uid, fenceEpoch: 1, sessionHash,
  };
  const request = new Request(appOrigin + '/api/auth/kinde/deletion/start', {
    method: 'POST', headers: { origin: appOrigin, 'sec-fetch-site': 'same-origin', cookie },
  });
  const supported = { issuer: f.config.issuer, acr_values_supported: ['mfa'], claims_supported: ['auth_time'] };
  for (const discovery of [
    { issuer: f.config.issuer, claims_supported: ['auth_time'] },
    { ...supported, issuer: 'https://foreign.invalid' },
    { ...supported, claims_supported: [] },
  ]) {
    f.setDiscovery(discovery);
    const rejected = await f.deletion.start(f.db, request, claims);
    assert.equal(rejected.status, 503);
    assert.equal(rejected.headers.has('Location'), false);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_deletion_oauth_attempts').get().n, 0);
  }
  f.setDiscovery(supported);
  const valid = await f.deletion.start(f.db, request, claims);
  assert.equal(valid.status, 303);
  f.setDiscovery({ issuer: f.config.issuer, claims_supported: ['auth_time'] });
  const callback = f.deletionCallback(new URL(valid.headers.get('Location')), 'unsupported-discovery',
    cookie + '; ' + valid.headers.getSetCookie()[0].split(';')[0], true);
  assert.equal(await f.deletion.complete(f.db, callback), null);
  assert.equal(f.calls(), 1, 'only the ordinary login exchanged a code');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_deletion_oauth_attempts').get().n, 0);
});

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
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.body, null);
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

void test('one-use callback accepts provider-configurable access TTL, preserves D1 replay and expiry gates', async () => {
  const f = await fixture();
  try {
    f.setAccessLifetime(24 * 60 * 60);
    const attempt = await f.start();
    const callback = f.callback(attempt, 'synthetic.code-with-dot');
    const completed = await f.oauth.complete(f.db, callback);
    assert.equal(completed.status, 303);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 1);
    assert.equal(f.calls(), 1);
    assert.equal((await f.oauth.complete(f.db, callback)).status, 400);
    assert.equal(f.calls(), 1);

    for (const lifetime of [24 * 60 * 60 + 1, 3 * 24 * 60 * 60]) {
      f.setAccessLifetime(lifetime);
      const login = await f.start(attempt.cookie);
      const request = f.callback(login, 'synthetic-code-ttl-' + lifetime);
      const result = await f.oauth.complete(f.db, request);
      assert.equal(result.status, 303);
      assert.equal(result.headers.getSetCookie().length, 2);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 1);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
      assert.equal((await f.oauth.complete(f.db, request)).status, 400);
    }
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 3);

    // One-second validity: exp is at or before now, yet still greater than iat.
    f.setAccessLifetime(1);
    const expired = await f.start(attempt.cookie);
    const denied = await f.oauth.complete(f.db, f.callback(expired, 'synthetic-code-expired'));
    assert.equal(denied.status, 503);
    assert.deepEqual(await denied.json(), {
      error: 'authentication-unavailable', phase: 'access-token-expired',
    });
    assert.equal(denied.headers.getSetCookie().length, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 3);
  } finally { f.close(); }
});

void test('real-shaped wrong API audience rejects login after one-use PKCE state, without cookies or principal', async () => {
  const f = await fixture();
  try {
    f.setAccessAudience(['another-authorized-api']);
    const a = await f.start();
    const request = f.callback(a, 'wrong-api-audience');
    const denied = await f.oauth.complete(f.db, request);
    assert.equal(denied.status, 503);
    assert.deepEqual(await denied.json(), {
      error: 'authentication-unavailable', phase: 'access-token-audience',
    });
    assert.equal(denied.headers.get('Cache-Control'), 'no-store');
    assert.equal(denied.headers.has('Set-Cookie'), false);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
    assert.equal((await f.oauth.complete(f.db, request)).status, 400);

    f.setAccessAudience([apiAudience, 'another-api']);
    const b = await f.start(a.cookie);
    const result = await f.oauth.complete(f.db, f.callback(b, 'multi-audience-valid'));
    assert.equal(result.status, 303);
    assert.equal(result.headers.getSetCookie().length, 2);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 1);
  } finally { f.close(); }
});

void test('Kinde machine grant array cannot mint a user session even when JWT is correctly signed', async () => {
  const f = await fixture();
  try {
    f.setAccessGrantType(['client_credentials']);
    const a = await f.start();
    const denied = await f.oauth.complete(f.db, f.callback(a, 'm2m-denied'));
    assert.equal(denied.status, 503);
    assert.deepEqual(await denied.json(), {
      error: 'authentication-unavailable', phase: 'access-token-grant',
    });
    assert.equal(denied.headers.has('Set-Cookie'), false);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
  } finally { f.close(); }
});

void test('signed wrong ID audience stays rejected after D1 state consumption with no login', async () => {
  const f = await fixture();
  try {
    f.setIdAudience('unrelated-application');
    const a = await f.start();
    const request = f.callback(a, 'synthetic-code-audience');
    const response = await f.oauth.complete(f.db, request);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: 'authentication-unavailable', phase: 'id-token-audience',
    });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.has('Set-Cookie'), false);
    assert.equal(f.calls(), 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
    assert.equal((await f.oauth.complete(f.db, request)).status, 400);
  } finally { f.close(); }
});

void test('hosted Kinde callback with scope completes a session without weakening state and scope validation', async () => {
  const f = await fixture();
  try {
    const attempt = await f.start();
    const invalid = [
      'openid email', 'openid profile', 'email profile',
      'openid email profile offline', 'openid email email',
      'openid  email profile', 'openid email profile ',
      'Openid email profile', '',
    ];
    for (const scope of invalid) {
      const response = await f.oauth.complete(f.db, f.callback(attempt, 'synthetic.code-with-dot', attempt.cookie, scope));
      assert.equal(response.status, 400, JSON.stringify(scope));
      assert.equal(f.calls(), 0);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 1);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
    }
    const duplicate = f.callback(attempt, 'synthetic.code-with-dot');
    assert.equal((await f.oauth.complete(f.db, new Request(
      duplicate.url + '&scope=openid%20email%20profile', { headers: { cookie: attempt.cookie } },
    ))).status, 400);
    const unknown = f.callback(attempt, 'synthetic.code-with-dot');
    assert.equal((await f.oauth.complete(f.db, new Request(
      unknown.url + '&unexpected=1', { headers: { cookie: attempt.cookie } },
    ))).status, 400);
    assert.equal(f.calls(), 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 1);

    // OAuth scope ordering is immaterial. The authorization code and its
    // one-use browser binding must still pass verified token exchange.
    const completed = await f.oauth.complete(f.db, f.callback(
      attempt, 'synthetic.code-with-dot', attempt.cookie, 'profile openid email',
    ));
    assert.equal(completed.status, 303);
    assert.equal(f.calls(), 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 1);
    assert.equal((await f.oauth.complete(f.db, f.callback(attempt))).status, 400);
    assert.equal(f.calls(), 1);

    // A provider that omits the optional scope stays supported.
    const another = await f.start(attempt.cookie);
    assert.equal((await f.oauth.complete(f.db, f.callback(
      another, 'synthetic-code-without-scope', another.cookie, null,
    ))).status, 303);
    assert.equal(f.calls(), 2);
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
