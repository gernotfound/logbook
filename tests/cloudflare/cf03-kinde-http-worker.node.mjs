import assert from 'node:assert/strict';
import test from 'node:test';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';
import { routeCandidateFirstPartyApi } from '../../cloudflare/first-party-api-candidate.mjs';
import { fixture, ORIGIN, SESSION, START, CALLBACK, LOGOUT, cloudCall, acceptance } from './kinde-http-worker-fixture.mjs';

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

void test('browser zero-byte POST streams verify sessions and logout without accepting input', async () => {
  const f = await fixture();
  try {
    const through = request => routeCandidateFirstPartyApi(request, {
      APP_ORIGIN: ORIGIN,
      KINDE_HTTP: { fetch: request => f.handler(request, f.env) },
    });
    // Chromium/Workers may expose an empty stream even for Content-Length: 0.
    const browserPost = (path, cookie = '', csrf = '', payload = '') =>
      new Request(ORIGIN + path, {
        method: 'POST',
        headers: {
          origin: ORIGIN, 'sec-fetch-site': 'same-origin',
          'content-length': '0', cookie, 'x-csrf-token': csrf,
        },
        body: new ReadableStream({
          start(controller) {
            if (payload) controller.enqueue(new TextEncoder().encode(payload));
            controller.close();
          },
        }),
        duplex: 'half',
      });

    const absent = await through(browserPost(SESSION));
    assert.equal(absent.status, 401);
    assert.deepEqual(await absent.json(), { error: 'unauthorized' });

    const login = await f.login();
    const verified = await through(browserPost(SESSION, login.cookie));
    assert.equal(verified.status, 200);
    assert.equal((await verified.json()).authenticated, true);

    const forged = await through(browserPost(SESSION, login.cookie, '', 'injected=1'));
    assert.equal(forged.status, 403);
    assert.deepEqual(await forged.json(), { error: 'origin-or-input-rejected' });

    const loggedOut = await through(browserPost(LOGOUT, login.cookie, login.csrf));
    assert.equal(loggedOut.status, 200);
    assert.equal((await through(browserPost(SESSION, login.cookie))).status, 401);
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
