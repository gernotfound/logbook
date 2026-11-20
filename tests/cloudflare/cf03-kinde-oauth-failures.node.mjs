import test from 'node:test';
import assert from 'node:assert/strict';
import { createKindeOAuthFixture as fixture } from './kinde-oauth-flow-fixture.mjs';

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

void test('one-use OAuth failures reveal only a bounded phase after browser-state consumption', async () => {
  const f = await fixture();
  try {
    const cases = [
      { phase: 'token-transport', configure: () => f.setTransportFailure(true),
        reset: () => f.setTransportFailure(false) },
      { phase: 'token-response', configure: () => f.setStatus(500),
        reset: () => f.setStatus(200) },
      { phase: 'access-token', configure: () => f.setPayload({
        access_token: 'synthetic.invalid.jwt', id_token: 'synthetic.invalid.jwt',
      }), reset: () => f.setPayload(null) },
    ];
    for (let i = 0; i < cases.length; i += 1) {
      const { phase, configure, reset } = cases[i];
      const attempt = await f.start();
      configure();
      const request = f.callback(attempt, 'synthetic-failure-' + i);
      const response = await f.oauth.complete(f.db, request);
      reset();
      assert.equal(response.status, 503, phase);
      assert.deepEqual(await response.json(), {
        error: 'authentication-unavailable', phase,
      });
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(response.headers.getSetCookie().length, 0);
      assert.equal((await f.oauth.complete(f.db, request)).status, 400);
    }

    const attempt = await f.start();
    const originalPrepare = f.db.prepare;
    f.db.prepare = function prepare(sql) {
      if (/INSERT INTO auth_sessions/.test(sql)) {
        return { bind: () => ({ run: async () => { throw Error('synthetic D1 session failure'); } }) };
      }
      return originalPrepare.call(this, sql);
    };
    const response = await f.oauth.complete(f.db, f.callback(attempt, 'synthetic-session-failure'));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: 'authentication-unavailable', phase: 'session',
    });
    assert.equal(response.headers.getSetCookie().length, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
  } finally { f.close(); }
});

void test('missing or unproven OAuth state never reveals provider or identity diagnostics', async () => {
  const f = await fixture();
  try {
    const attempt = await f.start();
    const unknown = f.callback(attempt);
    const denied = await f.oauth.complete(f.db, new Request(
      unknown.url.replace('state=' + attempt.state, 'state=' + 'A'.repeat(43)),
      { headers: { cookie: attempt.cookie } },
    ));
    assert.equal(denied.status, 400);
    assert.deepEqual(await denied.json(), { error: 'authentication-unavailable' });
    assert.equal(f.calls(), 0);

    const unproven = {
      withSession: () => ({ prepare: () => ({ bind: () => ({
        first: async () => { throw new Error('synthetic primary read outage'); },
      }) }) }),
    };
    const response = await f.oauth.complete(unproven, f.callback(attempt));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'authentication-unavailable' });
    assert.equal(response.headers.getSetCookie().length, 0);
    assert.equal(f.calls(), 0);
  } finally { f.close(); }
});

void test('OAuth token endpoint redirects are rejected without issuing sessions or following Location', async () => {
  const f = await fixture();
  try {
    f.setStatus(302);
    const attempt = await f.start();
    const callback = f.callback(attempt);
    assert.equal((await f.oauth.complete(f.db, callback)).status, 503);
    assert.equal(f.calls(), 1);
    assert.equal((await f.oauth.complete(f.db, callback)).status, 400);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 0);
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
