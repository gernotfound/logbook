import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createKindeOAuthFlow } from '../../cloudflare/auth/kinde-oauth-flow.mjs';
import { appOrigin, createKindeOAuthFixture as fixture } from './kinde-oauth-flow-fixture.mjs';

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


void test('callback rate limiter rejects a valid bound state before D1 without consuming it', async () => {
  const f = await fixture();
  try {
    const a = await f.start();
    f.setRate(false);
    assert.equal((await f.oauth.complete(f.db, f.callback(a))).status, 429);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 1);
    assert.equal(f.calls(), 0);
    f.setRate(true);
    assert.equal((await f.oauth.complete(f.db, f.callback(a))).status, 303);
  } finally { f.close(); }
});


void test('OAuth state expiry pruning removes at most 16 per start and preserves live browser attempts', async () => {
  const f = await fixture();
  try {
    const live = await f.start();
    for (let index = 0; index < 20; index += 1) {
      const expired = await f.start(live.cookie);
      const hash = createHash('sha256').update(expired.state).digest('hex');
      const changed = f.sqlite.prepare(
        'UPDATE auth_oauth_attempts SET issued_at_ms=1, expires_at_ms=2 WHERE state_hash=?'
      ).run(hash);
      assert.equal(changed.changes, 1);
    }
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts WHERE expires_at_ms=2').get().n, 20);
    const firstSweep = await f.start(live.cookie);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts WHERE expires_at_ms=2').get().n, 4);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 6);

    const nextSweep = await f.start(live.cookie);
    assert.notEqual(firstSweep.state, nextSweep.state);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts WHERE expires_at_ms=2').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 3);

    const successful = await f.oauth.complete(f.db, f.callback(live, 'preserved-live-attempt'));
    assert.equal(successful.status, 303);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 1);
    assert.equal((await f.oauth.complete(f.db, f.callback(live, 'preserved-live-attempt'))).status, 400);
    assert.equal(f.calls(), 1);
  } finally { f.close(); }
});
