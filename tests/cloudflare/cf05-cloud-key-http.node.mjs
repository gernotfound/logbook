import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import api from '../../cloudflare/api/worker.mjs';
import gate from '../../cloudflare/auth/session-gate.mjs';
import { ORIGIN, SYNC, RIGHTS, createCloudKeyHttpFixture as fixture } from './cloud-key-http-fixture.mjs';

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

void test('a restored identical KEK reopens the persisted ADK after a lost or substituted Worker secret', async () => {
  const f = await fixture(['owner-a']);
  try {
    await f.consent('owner-a');
    const issued = await f.call('owner-a', SYNC);
    assert.equal(issued.response.status, 200);
    const originalKey = issued.body.key;
    const recoverableSecretCopy = f.env.CLOUD_ACCOUNT_KEK_V1;
    const initialRecord = f.sqlite.prepare('SELECT * FROM cloud_account_keys WHERE uid=?')
      .get('owner-a');
    const noSecret = { ...f.env };
    delete noSecret.CLOUD_ACCOUNT_KEK_V1;
    const substitutedSecret = {
      ...f.env, CLOUD_ACCOUNT_KEK_V1: Buffer.alloc(32, 19).toString('base64'),
    };

    // A process/deployment replacement receives fresh bindings and must use
    // the immutable SQL winner, never mint a replacement ADK on key failure.
    for (const env of [noSecret, substitutedSecret]) {
      const unavailable = await f.call('owner-a', SYNC, { env });
      assert.equal(unavailable.response.status, 503);
      assert.deepEqual(unavailable.body, { error: 'unavailable' });
      assert.deepEqual(f.sqlite.prepare('SELECT * FROM cloud_account_keys WHERE uid=?')
        .get('owner-a'), initialRecord);
      assert.equal(f.count('cloud_key_issuance', 'owner-a'), 1);
      assert.equal(f.count('cloud_account_keys', 'owner-a'), 1);
    }

    const restoredEnvironment = {
      ...f.env, CLOUD_ACCOUNT_KEK_V1: recoverableSecretCopy,
    };
    const recovered = await f.call('owner-a', SYNC, { env: restoredEnvironment });
    assert.equal(recovered.response.status, 200);
    assert.equal(recovered.body.key, originalKey);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM cloud_account_keys WHERE uid=?')
      .get('owner-a'), initialRecord);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 1);

    await f.withdraw('owner-a');
    assert.equal((await f.call('owner-a', SYNC, { env: restoredEnvironment }))
      .response.status, 401);
    const rights = await f.call('owner-a', RIGHTS, { env: restoredEnvironment });
    assert.equal(rights.response.status, 200);
    assert.equal(rights.body.key, originalKey);
    assert.equal(rights.body.purpose, 'rights-export');
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 1);
  } finally { f.close(); }
});

void test('cold D1 and independent registry restore recovers the same two ADKs with only the original synthetic KEK', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-cloud-kek-cold-'));
  const original = await fixture(['owner-a', 'owner-b']);
  let originalClosed = false;
  let copiedApplication;
  let copiedRegistry;
  try {
    for (const uid of ['owner-a', 'owner-b']) await original.consent(uid);
    const firstA = await original.call('owner-a', SYNC);
    const firstB = await original.call('owner-b', SYNC);
    assert.equal(firstA.response.status, 200);
    assert.equal(firstB.response.status, 200);
    assert.notEqual(firstA.body.key, firstB.body.key);
    const savedKek = original.env.CLOUD_ACCOUNT_KEK_V1;
    const initialRows = original.sqlite.prepare(
      'SELECT * FROM cloud_account_keys ORDER BY uid').all();
    const originalIssuance = original.sqlite.prepare(
      'SELECT * FROM cloud_key_issuance ORDER BY uid').all();
    assert.equal(initialRows.length, 2);
    assert.equal(originalIssuance.length, 2);

    const appFile = join(dir, 'application.sqlite');
    const registryFile = join(dir, 'independent-registry.sqlite');
    await backup(original.sqlite, appFile);
    await backup(original.registry, registryFile);
    original.close();
    originalClosed = true;

    // New D1 handles, AuthGate and recovery registry read independently
    // persisted SQLite copies. The source DB and Worker bindings are gone.
    copiedApplication = new DatabaseSync(appFile);
    copiedRegistry = new DatabaseSync(registryFile);
    const db = new original.db.constructor(copiedApplication);
    const recoveryDb = new original.recoveryDb.constructor(copiedRegistry);
    const restored = {
      ...original.env, DB: db, RECOVERY_DB: recoveryDb,
      AUTH_GATE: { fetch: request => gate.fetch(request, { ...original.gateEnv, DB: db }) },
    };
    const missing = { ...restored };
    delete missing.CLOUD_ACCOUNT_KEK_V1;
    const changed = { ...restored, CLOUD_ACCOUNT_KEK_V1: Buffer.alloc(32, 23).toString('base64') };
    const current = { ...restored, CLOUD_ACCOUNT_KEK_V1: savedKek };

    // Neither a missing nor a syntactically valid but wrong secret may
    // turn issued data into a new account key after a physical DB restart.
    for (const environment of [missing, changed]) {
      for (const uid of ['owner-a', 'owner-b']) {
        const denied = await original.call(uid, SYNC, { env: environment });
        assert.equal(denied.response.status, 503);
        assert.deepEqual(denied.body, { error: 'unavailable' });
      }
      assert.deepEqual(copiedApplication.prepare(
        'SELECT * FROM cloud_account_keys ORDER BY uid').all(), initialRows);
      assert.deepEqual(copiedApplication.prepare(
        'SELECT * FROM cloud_key_issuance ORDER BY uid').all(), originalIssuance);
    }

    const restoredA = await original.call('owner-a', SYNC, { env: current });
    const restoredB = await original.call('owner-b', SYNC, { env: current });
    assert.equal(restoredA.response.status, 200);
    assert.equal(restoredB.response.status, 200);
    assert.equal(restoredA.body.key, firstA.body.key);
    assert.equal(restoredB.body.key, firstB.body.key);
    assert.deepEqual(copiedApplication.prepare(
      'SELECT * FROM cloud_account_keys ORDER BY uid').all(), initialRows);
    assert.deepEqual(copiedApplication.prepare(
      'SELECT * FROM cloud_key_issuance ORDER BY uid').all(), originalIssuance);

    // Restored key custody does not override a later consent withdrawal.
    const withdrawal = await original.call('owner-a', '/v1/consent/withdraw', {
      env: current, body: { action: 'withdraw', expectedRevision: 1, confirmsErasure: true },
    });
    assert.equal(withdrawal.response.status, 200);
    assert.equal((await original.call('owner-a', SYNC, { env: current })).response.status, 401);
    const rights = await original.call('owner-a', RIGHTS, { env: current });
    assert.equal(rights.response.status, 200);
    assert.equal(rights.body.key, firstA.body.key);
    assert.equal(rights.body.purpose, 'rights-export');
    assert.equal((await original.call('owner-b', SYNC, { env: current })).body.key, firstB.body.key);
    assert.equal(copiedApplication.prepare(
      'SELECT COUNT(*) AS n FROM cloud_account_keys').get().n, 2);
  } finally {
    if (!originalClosed) original.close();
    copiedRegistry?.close();
    copiedApplication?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
