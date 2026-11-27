import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ORIGIN, SYNC, INSPECT, RIGHTS, createCloudKeyHttpFixture as fixture,
  renewSessionWithoutEmail } from './cloud-key-http-fixture.mjs';

void test('origin, CSRF, method, query and request body are denied before any key write', async () => {
  const f = await fixture();
  try {
    await f.consent('owner-a');
    for (const { options, status, error } of [
      { options: { csrf: 'forged-csrf' }, status: 403, error: 'unauthorized-or-unavailable' },
      { options: { csrf: '', cookie: 'bad' }, status: 401, error: 'unauthorized-or-unavailable' },
      { options: { origin: 'https://attacker.invalid' }, status: 403, error: 'origin-or-input-rejected' },
      { options: { fetchSite: 'cross-site' }, status: 403, error: 'origin-or-input-rejected' },
      { options: { url: ORIGIN + SYNC + '?uid=owner-b' }, status: 403, error: 'origin-or-input-rejected' },
      { options: { body: { uid: 'owner-a' } }, status: 403, error: 'origin-or-input-rejected' },
      { options: { method: 'GET' }, status: 405, error: 'method-not-allowed' },
    ]) {
      const result = await f.call('owner-a', SYNC, options);
      assert.equal(result.response.status, status);
      assert.deepEqual(result.body, { error });
      assert.equal(result.response.headers.get('Cache-Control'), 'no-store');
      assert.equal(f.count('cloud_account_keys', 'owner-a'), 0);
      assert.equal(f.count('cloud_key_issuance', 'owner-a'), 0);
    }
    const missing = await f.call('owner-a', '/v1/cloud-key/unknown');
    assert.equal(missing.response.status, 404);
    assert.deepEqual(missing.body, { error: 'not-found' });
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 0);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 0);
    for (const options of [
      { csrf: 'forged' }, { origin: 'https://attacker.invalid' },
      { fetchSite: 'cross-site' }, { body: '{}' }, { url: ORIGIN + INSPECT + '?x=1' },
    ]) {
      assert.notEqual((await f.call('owner-a', INSPECT, options)).response.status, 200);
      assert.equal(f.count('cloud_account_keys', 'owner-a'), 0);
      assert.equal(f.count('cloud_key_issuance', 'owner-a'), 0);
    }
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
    for (const { env, status, error } of [
      { env: { ...f.env, DB: undefined }, status: 503, error: 'unavailable' },
      { env: { ...f.env, AUTH_GATE: undefined }, status: 503, error: 'unavailable' },
      { env: { ...f.env, CLOUD_ACCOUNT_KEK_V1: undefined }, status: 503, error: 'unavailable' },
      { env: { ...f.env, AUTH_GATE: { fetch: async () => Response.json({ error: 'rate-limited' }, { status: 429 }) } },
        status: 429, error: 'unauthorized-or-unavailable' },
      { env: { ...f.env, DB: { withSession() { throw new Error('synthetic-DB-quota'); } } },
        status: 503, error: 'unavailable' },
    ]) {
      const result = await f.call('owner-a', SYNC, { env });
      assert.equal(result.response.status, status);
      assert.deepEqual(result.body, { error });
      assert.equal(result.response.headers.get('Cache-Control'), 'no-store');
      assert.equal(f.count('cloud_account_keys', 'owner-a'), 0);
      assert.equal(f.count('cloud_key_issuance', 'owner-a'), 0);
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

void test('fitness key provisioning requires an independent active owner and open registry', async () => {
  const f = await fixture();
  try {
    // Simulate a restored application snapshot whose independent floor is absent.
    f.sqlite.exec(`
      INSERT INTO sync_subjects (uid,status,consent_revision,fence_epoch) VALUES ('owner-a','active',1,1);
      INSERT INTO sync_state (uid,revision) VALUES ('owner-a',0);
    `);
    f.sqlite.prepare(`INSERT INTO health_consent_acceptances
      (uid,consent_revision,privacy_version,terms_version,accepted_at_ms,over_18_confirmed)
      VALUES ('owner-a',1,'1.3.9','1.2.5',?,1)`).run(Date.now());
    await f.consent('owner-b');
    assert.equal((await f.call('owner-a', '/v1/consent/status')).response.status, 503);
    assert.equal(f.registry.prepare("SELECT uid FROM recovery_owner_fences WHERE uid='owner-a'").get(), undefined);
    const unregistered = await f.call('owner-a', SYNC);
    assert.equal(unregistered.response.status, 503);
    assert.deepEqual(unregistered.body, { error: 'unavailable' });

    for (const RECOVERY_DB of [undefined, f.db]) {
      const unreadable = await f.call('owner-b', SYNC, { env: { ...f.env, RECOVERY_DB } });
      assert.equal(unreadable.response.status, 503);
      assert.deepEqual(unreadable.body, { error: 'unavailable' });
    }
    f.registry.exec("UPDATE recovery_control SET mode='sealed', generation=3 WHERE singleton=1");
    const sealed = await f.call('owner-b', SYNC);
    assert.equal(sealed.response.status, 503);
    assert.deepEqual(sealed.body, { error: 'unavailable' });
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 0);
    assert.equal(f.count('cloud_key_issuance', 'owner-b'), 0);
  } finally { f.close(); }
});

void test('fitness key is withheld when independent withdrawal is armed during issuance', async () => {
  const f = await fixture();
  try {
    await f.consent('owner-a');
    let registryReads = 0;
    const racingRegistry = {
      withSession(mode) {
        if (++registryReads === 2) {
          f.registry.exec(`UPDATE recovery_owner_fences SET status='blocked',
            change_seq=change_seq+1 WHERE uid='owner-a'`);
        }
        return f.recoveryDb.withSession(mode);
      },
    };
    const refused = await f.call('owner-a', SYNC, {
      env: { ...f.env, RECOVERY_DB: racingRegistry },
    });
    assert.equal(refused.response.status, 503);
    assert.deepEqual(refused.body, { error: 'unavailable' });
    assert.equal(refused.response.headers.get('Cache-Control'), 'no-store');
    assert.equal(registryReads, 2);
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 1);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 1);
    assert.equal(f.sqlite.prepare("SELECT status FROM sync_subjects WHERE uid='owner-a'").get().status, 'active');
    assert.equal((await f.call('owner-a', SYNC)).response.status, 503);
    await f.consent('owner-b');
    assert.equal((await f.call('owner-b', SYNC)).response.status, 200);
  } finally { f.close(); }
});

void test('recovery inspection withholds an existing key if the session is revoked during unwrap', async () => {
  const f = await fixture(['owner-a']);
  try {
    await f.consent('owner-a');
    assert.equal((await f.call('owner-a', SYNC)).response.status, 200);
    const envelope = f.sqlite.prepare("SELECT * FROM cloud_account_keys WHERE uid='owner-a'").get();
    let reads = 0;
    const racingDb = {
      withSession(mode) {
        const primary = f.db.withSession(mode);
        return {
          prepare(sql) {
            if (sql.includes('SELECT k.uid AS key_uid') && ++reads === 2) {
              f.sqlite.exec(`UPDATE auth_sessions SET revoked_at_ms=issued_at_ms
                WHERE uid='owner-a'`);
            }
            return primary.prepare(sql);
          },
        };
      },
    };
    const refused = await f.call('owner-a', INSPECT, { env: { ...f.env, DB: racingDb } });
    assert.equal(reads, 2);
    assert.equal(refused.response.status, 503);
    assert.deepEqual(refused.body, { error: 'unavailable' });
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM cloud_account_keys WHERE uid='owner-a'").get(), envelope);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 1);
  } finally { f.close(); }
});

void test('recovery inspection withholds an existing key when the independent owner fence closes', async () => {
  const f = await fixture(['owner-a']);
  try {
    await f.consent('owner-a');
    assert.equal((await f.call('owner-a', SYNC)).response.status, 200);
    let reads = 0;
    const racingRegistry = {
      withSession(mode) {
        if (++reads === 2) {
          f.registry.exec(`UPDATE recovery_owner_fences SET status='blocked',
            change_seq=change_seq+1 WHERE uid='owner-a'`);
        }
        return f.recoveryDb.withSession(mode);
      },
    };
    const refused = await f.call('owner-a', INSPECT, {
      env: { ...f.env, RECOVERY_DB: racingRegistry },
    });
    assert.equal(reads, 2);
    assert.equal(refused.response.status, 503);
    assert.deepEqual(refused.body, { error: 'unavailable' });
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 1);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 1);
  } finally { f.close(); }
});


void test('rights-only scan reads the withdrawn subject without granting active sync', async () => {
  const f = await fixture();
  const body = { after: null, expectedRevision: null };
  try {
    await f.consent('owner-a');
    const active = await f.call('owner-a', '/v1/rights/scan', { body });
    assert.notEqual(active.response.status, 200);
    await f.call('owner-a', SYNC);
    await f.withdraw('owner-a');
    const rights = await f.call('owner-a', '/v1/rights/scan', { body });
    assert.equal(rights.response.status, 200);
    assert.equal(rights.body.consentRevision, 1);
    assert.equal(rights.body.fenceEpoch, 1);
    assert.equal(rights.body.revision, 0);
    assert.deepEqual(rights.body.documents, []);
    assert.equal(rights.body.complete, true);
    assert.equal(rights.body.nextAfter, null);
    assert.equal(rights.response.headers.get('cache-control'), 'no-store');
    assert.notEqual((await f.call('owner-a', '/v1/sync/scan', { body })).response.status, 200);
    assert.notEqual((await f.call('owner-b', '/v1/rights/scan', { body })).response.status, 200);
    assert.equal(f.count('health_erasure_jobs', 'owner-a'), 1);
  } finally { f.close(); }
});

void test('rights scan accepts an unverified renewed session but rejects stale credentials and invalid pages', async () => {
  const f = await fixture();
  const body = { after: null, expectedRevision: null };
  try {
    await f.consent('owner-a');
    await f.call('owner-a', SYNC);
    await f.withdraw('owner-a');
    const previous = await renewSessionWithoutEmail(f, 'owner-a');
    const rights = await f.call('owner-a', '/v1/rights/scan', { body });
    assert.equal(rights.response.status, 200);
    assert.equal(rights.body.fenceEpoch, 1);
    assert.notEqual((await f.call('owner-a', '/v1/rights/scan', {
      body, cookie: previous.cookies, csrf: previous.csrf,
    })).response.status, 200);
    for (const opts of [
      { body, csrf: '' },
      { body: { after: 'history_months/2026-01', expectedRevision: null } },
      { body: { after: null, expectedRevision: 1 } },
      { body: { after: null, expectedRevision: null, uid: 'owner-b' } },
      { method: 'GET' },
      { body, origin: 'https://foreign.invalid' },
      { body, env: { ...f.env, RECOVERY_DB: undefined } },
      { body, env: { ...f.env, RECOVERY_DB: f.db } },
    ]) {
      const result = await f.call('owner-a', '/v1/rights/scan', opts);
      assert.notEqual(result.response.status, 200);
      assert.equal(result.response.headers.get('cache-control'), 'no-store');
    }
    assert.equal((await f.call('owner-a', '/v1/rights/scan', {
      body: { after: null, expectedRevision: 0 },
    })).response.status, 400);
  } finally { f.close(); }
});

void test('independent cutoff blocks rights ciphertext even while restored application D1 still says withdrawn', async () => {
  const f = await fixture();
  const body = { after: null, expectedRevision: null };
  try {
    await f.consent('owner-a');
    await f.call('owner-a', SYNC);
    await f.withdraw('owner-a');
    assert.equal((await f.call('owner-a', '/v1/rights/scan', { body })).response.status, 200);
    f.registry.exec("UPDATE recovery_control SET mode='sealed', generation=3 WHERE singleton=1");
    assert.notEqual((await f.call('owner-a', '/v1/rights/scan', { body })).response.status, 200);
    f.registry.exec("UPDATE recovery_control SET mode='open', generation=4 WHERE singleton=1");
    assert.equal((await f.call('owner-a', '/v1/rights/scan', { body })).response.status, 200);
    // A revoked owner cannot be rolled backwards in the independent registry,
    // even by direct SQL: the store's monotone trigger rejects that mutation.
    assert.throws(() => f.registry.exec(
      "UPDATE recovery_owner_fences SET status='active', change_seq=change_seq+1 WHERE uid='owner-a'"
    ));
    assert.equal((await f.call('owner-a', '/v1/rights/scan', { body })).response.status, 200);
    assert.equal(f.count('health_erasure_jobs', 'owner-a'), 1);
  } finally { f.close(); }
});

void test('candidate route is private in the published frontend configuration', () => {
  const config = JSON.parse(readFileSync(new URL('../../cloudflare/wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.main, './auth-proxy.mjs');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.assets.run_worker_first, ['/api/auth/kinde/start', '/api/auth/kinde/callback', '/api/auth/session', '/api/auth/logout']);
  assert.equal(config.d1_databases, undefined);
  assert.deepEqual(config.services, [{
    binding: 'KINDE_HTTP', service: 'thelogbook-cf03-kinde-http-isolated',
  }]);
  assert.equal(config.services.find(item => item.binding === 'D1_API'), undefined);
});
