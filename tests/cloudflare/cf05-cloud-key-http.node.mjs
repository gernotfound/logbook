import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import api from '../../cloudflare/api/worker.mjs';
import { ORIGIN, SYNC, RIGHTS, ACCEPT, createCloudKeyHttpFixture as fixture,
  renewSessionWithoutEmail } from './cloud-key-http-fixture.mjs';

void test('top-level API: initial consent, authenticated key provision, repeat and isolated owner', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('owner-a', SYNC)).response.status, 401);
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 0);
    await f.consent('owner-a');
    await f.consent('owner-b');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_writable_cloud_key').get().n, 0);
    const [first, raced] = await Promise.all([
      f.call('owner-a', SYNC), f.call('owner-a', SYNC),
    ]);
    assert.equal(first.response.status, 200);
    assert.equal(raced.response.status, 200);
    assert.equal(raced.body.key, first.body.key);
    assert.equal(first.response.headers.get('Cache-Control'), 'no-store');
    assert.equal(first.response.headers.get('Pragma'), 'no-cache');
    assert.equal(first.response.headers.get('Access-Control-Allow-Origin'), null);
    assert.deepEqual(Object.keys(first.body).sort(), ['consentRevision', 'fenceEpoch', 'format', 'key', 'purpose', 'uid', 'version']);
    assert.equal(first.body.format, 'thelogbook-account-data-key');
    assert.equal(first.body.version, 1);
    assert.equal(first.body.uid, 'owner-a');
    assert.equal(first.body.fenceEpoch, 1);
    assert.equal(first.body.consentRevision, 1);
    assert.equal(first.body.purpose, 'sync');
    assert.match(first.body.key, /^[A-Za-z0-9+/]{43}=$/);
    assert.equal(Buffer.from(first.body.key, 'base64').length, 32);
    const repeated = await f.call('owner-a', SYNC);
    assert.equal(repeated.response.status, 200);
    assert.equal(repeated.body.key, first.body.key);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 1);
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 1);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sync_writable_cloud_key WHERE uid='owner-a'").get().n, 1);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sync_writable_cloud_key WHERE uid='owner-b'").get().n, 0);
    const sealed = f.sqlite.prepare('SELECT ciphertext, iv, tag FROM cloud_account_keys WHERE uid=?')
      .get('owner-a');
    assert.notEqual(sealed.ciphertext, first.body.key);
    assert.equal(typeof sealed.iv, 'string');
    assert.equal(typeof sealed.tag, 'string');
    const other = await f.call('owner-b', SYNC);
    assert.equal(other.response.status, 200);
    assert.notEqual(other.body.key, first.body.key);
    assert.equal(f.count('cloud_key_issuance', 'owner-b'), 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_writable_cloud_key').get().n, 2);
    // Forged identity headers cannot redirect the trusted session owner.
    const forged = new Request(ORIGIN + SYNC, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: f.sessions.get('owner-a').cookies,
        'x-csrf-token': f.sessions.get('owner-a').csrf,
        'x-user-id': 'owner-b', 'authorization': 'Bearer synthetic' },
    });
    const forgedResponse = await api.fetch(forged, f.env);
    assert.equal(forgedResponse.status, 200);
    assert.equal((await forgedResponse.json()).key, first.body.key);
  } finally { f.close(); }
});

void test('withdrawal stops sync; rights-only returns existing key without reprovisioning', async () => {
  const f = await fixture();
  try {
    await f.consent('owner-a');
    await f.consent('owner-b');
    const aKey = (await f.call('owner-a', SYNC)).body.key;
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_writable_cloud_key').get().n, 1);
    await f.withdraw('owner-a');
    await f.withdraw('owner-b');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_writable_cloud_key').get().n, 0);
    assert.equal((await f.call('owner-a', SYNC)).response.status, 401);
    const rights = await f.call('owner-a', RIGHTS);
    assert.equal(rights.response.status, 200);
    assert.equal(rights.body.key, aKey);
    assert.equal(rights.body.uid, 'owner-a');
    assert.equal(rights.body.purpose, 'rights-export');
    assert.equal(rights.body.consentRevision, 1);
    // B was withdrawn before ever being issued an ADK; rights can't create one.
    assert.equal((await f.call('owner-b', RIGHTS)).response.status, 503);
    assert.equal(f.count('cloud_account_keys', 'owner-b'), 0);
    assert.equal(f.count('cloud_key_issuance', 'owner-b'), 0);
    assert.equal(f.count('health_erasure_jobs', 'owner-a'), 1);
    assert.equal(f.count('health_erasure_jobs', 'owner-b'), 1);
  } finally { f.close(); }
});


void test('rights export survives lost email verification and a renewed owner session, with no provisioning', async () => {
  const f = await fixture();
  try {
    await f.consent('owner-a');
    await f.consent('owner-b');
    const issued = await f.call('owner-a', SYNC);
    assert.equal(issued.response.status, 200);
    const key = issued.body.key;
    assert.equal((await f.call('owner-a', RIGHTS)).response.status, 503);
    await f.withdraw('owner-a');
    await f.withdraw('owner-b');
    const oldSession = await renewSessionWithoutEmail(f, 'owner-a');
    assert.equal((await f.call('owner-a', RIGHTS, {
      cookie: oldSession.cookies, csrf: oldSession.csrf,
    })).response.status, 401);
    const rights = await f.call('owner-a', RIGHTS);
    assert.equal(rights.response.status, 200);
    assert.equal(rights.body.key, key);
    assert.equal(rights.body.fenceEpoch, 2);
    assert.equal(rights.body.consentRevision, 1);
    assert.equal(rights.body.uid, 'owner-a');
    assert.equal(rights.body.purpose, 'rights-export');
    assert.equal((await f.call('owner-a', '/v1/consent/status')).body.uid, 'owner-a');
    assert.equal((await f.call('owner-a', SYNC)).response.status, 401);
    assert.equal((await f.call('owner-a', '/v1/consent/initial', { body: ACCEPT }))
      .response.status, 401);
    assert.equal((await f.call('owner-a', RIGHTS, { csrf: '' })).response.status, 403);
    assert.equal((await f.call('owner-a', RIGHTS, { csrf: oldSession.csrf }))
      .response.status, 403);
    assert.equal((await f.call('owner-b', RIGHTS)).response.status, 503);
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 1);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 1);
    assert.equal(f.count('cloud_account_keys', 'owner-b'), 0);
    assert.equal(f.count('cloud_key_issuance', 'owner-b'), 0);
  } finally { f.close(); }
});

void test('rights-only denies stale session on the post-decrypt primary read', async () => {
  const f = await fixture();
  try {
    await f.consent('owner-a');
    assert.equal((await f.call('owner-a', SYNC)).response.status, 200);
    await f.withdraw('owner-a');
    await renewSessionWithoutEmail(f, 'owner-a');
    let keyReads = 0;
    const racingDb = {
      withSession(mode) {
        const primary = f.db.withSession(mode);
        return { prepare(sql) {
          const original = primary.prepare(sql);
          if (!sql.includes('SELECT k.uid AS key_uid')) return original;
          return { bind(...args) {
            const bound = original.bind(...args);
            return { async first() {
              keyReads += 1;
              if (keyReads === 2) {
                f.sqlite.prepare(`UPDATE auth_sessions SET revoked_at_ms=issued_at_ms
                  WHERE uid='owner-a' AND auth_epoch=2`).run();
              }
              return bound.first();
            } };
          } };
        } };
      },
    };
    const response = await f.call('owner-a', RIGHTS, {
      env: { ...f.env, DB: racingDb },
    });
    assert.equal(response.response.status, 503);
    assert.deepEqual(response.body, { error: 'unavailable' });
    assert.equal(keyReads, 2);
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 1);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 1);
  } finally { f.close(); }
});

void test('origin, CSRF, method, query and request body are denied before any key write', async () => {
  const f = await fixture();
  try {
    await f.consent('owner-a');
    for (const options of [
      { csrf: 'forged-csrf' },
      { csrf: '' , cookie: 'bad' },
      { origin: 'https://attacker.invalid' },
      { fetchSite: 'cross-site' },
      { url: ORIGIN + SYNC + '?uid=owner-b' },
      { body: { uid: 'owner-a' } },
      { method: 'GET' },
    ]) {
      const result = await f.call('owner-a', SYNC, options);
      assert.notEqual(result.response.status, 200);
    }
    assert.equal((await f.call('owner-a', '/v1/cloud-key/unknown')).response.status, 404);
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 0);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 0);
  } finally { f.close(); }
});

void test('revoked/expired session and disabled principal deny cached claims', async () => {
  for (const sql of [
    "UPDATE auth_sessions SET revoked_at_ms=issued_at_ms WHERE uid='owner-a'",
    "UPDATE auth_sessions SET issued_at_ms=issued_at_ms-60000, idle_expires_at_ms=issued_at_ms-30000 WHERE uid='owner-a'",
    "UPDATE auth_principals SET status='disabled' WHERE uid='owner-a'",
    "UPDATE auth_principals SET auth_epoch=2 WHERE uid='owner-a'",
  ]) {
    const f = await fixture();
    try {
      await f.consent('owner-a');
      await f.call('owner-a', SYNC);
      f.sqlite.exec(sql);
      assert.equal((await f.call('owner-a', SYNC)).response.status, 401);
      assert.equal((await f.call('owner-a', RIGHTS)).response.status, 401);
      assert.equal(f.count('cloud_key_issuance', 'owner-a'), 1);
    } finally { f.close(); }
  }
});

void test('missing dependencies, invalid KEK, private gate failure and quotas fail closed', async () => {
  const f = await fixture();
  try {
    await f.consent('owner-a');
    for (const env of [
      { ...f.env, DB: undefined },
      { ...f.env, AUTH_GATE: undefined },
      { ...f.env, CLOUD_ACCOUNT_KEK_V1: undefined },
      { ...f.env, AUTH_GATE: { fetch: async () => Response.json({ error: 'rate-limited' }, { status: 429 }) } },
      { ...f.env, DB: { withSession() { throw new Error('synthetic-DB-quota'); } } },
    ]) {
      const { response } = await f.call('owner-a', SYNC, { env });
      assert.notEqual(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 0);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 0);
    const valid = await f.call('owner-a', SYNC);
    assert.equal(valid.response.status, 200);
    // A valid-looking but different KEK cannot open an already issued ADK.
    const changedKek = { ...f.env,
      CLOUD_ACCOUNT_KEK_V1: Buffer.alloc(32, 93).toString('base64') };
    assert.equal((await f.call('owner-a', SYNC, { env: changedKek })).response.status, 503);
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 1);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 1);
    assert.equal((await f.call('owner-a', SYNC)).body.key, valid.body.key);
  } finally { f.close(); }
});

void test('candidate route is private in the published frontend configuration', () => {
  const config = JSON.parse(readFileSync(new URL('../../cloudflare/wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.main, './auth-proxy.mjs');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.assets.run_worker_first, ['/__/auth', '/__/auth/*', '/api/auth/kinde/start', '/api/auth/kinde/callback', '/api/auth/session', '/api/auth/logout']);
  assert.equal(config.d1_databases, undefined);
  assert.deepEqual(config.services, [{
    binding: 'KINDE_HTTP', service: 'thelogbook-cf03-kinde-http-isolated',
  }]);
  assert.equal(config.services.find(item => item.binding === 'D1_API'), undefined);
});
