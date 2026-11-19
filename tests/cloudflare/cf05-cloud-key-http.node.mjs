import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import api from '../../cloudflare/api/worker.mjs';
import gate from '../../cloudflare/auth/session-gate.mjs';
import erasureWorker from '../../cloudflare/jobs/health-erasure-worker.mjs';
import { inspectRestoredD1Census } from '../../cloudflare/recovery/restore-census.mjs';
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

void test('rights export requires the exact independent withdrawal even if the application D1 still has a key', async () => {
  const f = await fixture();
  try {
    await f.consent('owner-a');
    await f.consent('owner-b');
    assert.equal((await f.call('owner-a', SYNC)).response.status, 200);
    assert.equal((await f.call('owner-b', SYNC)).response.status, 200);
    await f.withdraw('owner-a');
    for (const RECOVERY_DB of [undefined, f.db, { withSession() { throw Error('registry outage'); } }]) {
      const result = await f.call('owner-a', RIGHTS, { env: { ...f.env, RECOVERY_DB } });
      assert.equal(result.response.status, 503);
      assert.deepEqual(result.body, { error: 'unavailable' });
    }
    await f.withdraw('owner-b');
    assert.equal((await f.call('owner-a', RIGHTS)).response.status, 200);
    f.registry.exec(`UPDATE recovery_owner_fences SET consent_revision=2, fence_epoch=2,
      erased_before_revision=2, change_seq=change_seq+1 WHERE uid='owner-a'`);
    const stale = await f.call('owner-a', RIGHTS);
    assert.equal(stale.response.status, 503);
    assert.deepEqual(stale.body, { error: 'unavailable' });
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 1);
    assert.equal((await f.call('owner-b', RIGHTS)).response.status, 200);
  } finally { f.close(); }
});

void test('rights export rechecks the independent withdrawal after opening the key', async () => {
  const f = await fixture();
  try {
    await f.consent('owner-a');
    assert.equal((await f.call('owner-a', SYNC)).response.status, 200);
    await f.withdraw('owner-a');
    let reads = 0;
    const recovery = {
      withSession(mode) {
        if (++reads === 2) {
          f.registry.exec("UPDATE recovery_control SET mode='sealed',generation=3 WHERE singleton=1");
        }
        return f.recoveryDb.withSession(mode);
      },
    };
    const result = await f.call('owner-a', RIGHTS, { env: { ...f.env, RECOVERY_DB: recovery } });
    assert.equal(reads, 2);
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.body, { error: 'unavailable' });
  } finally { f.close(); }
});

void test('terminal runner requires a durable independent cutoff before destroying the application key', async () => {
  const f = await fixture();
  try {
    await f.consent('owner-a');
    assert.equal((await f.call('owner-a', SYNC)).response.status, 200);
    await f.withdraw('owner-a');
    assert.equal((await erasureWorker.scheduled({}, f.env)).outcome, 'awaiting-keys');
    assert.throws(() => f.registry.exec(`
      INSERT INTO recovery_erasure_cutoffs(uid, consent_revision, fence_epoch)
      VALUES ('owner-a', 1, 2)
    `), /cutoff-fenced/);
    const expire = () => f.sqlite.prepare('UPDATE health_erasure_jobs SET lease_until_ms = ? WHERE uid = ?')
      .run(Date.now() - 1000, 'owner-a');
    expire();
    f.registry.exec(`CREATE TRIGGER deny_cutoff BEFORE INSERT ON recovery_erasure_cutoffs
      BEGIN SELECT RAISE(ABORT, 'synthetic-insert-unavailable'); END`);
    await assert.rejects(erasureWorker.scheduled({}, f.env), /independent-recovery-fence-unavailable/);
    assert.equal(f.count('health_erasure_finalizations', 'owner-a'), 0);
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 1);
    assert.equal((await f.call('owner-a', RIGHTS)).response.status, 200);
    f.registry.exec('DROP TRIGGER deny_cutoff');
    expire();
    const paused = { withSession(mode) {
      const primary = f.db.withSession(mode);
      return { prepare(sql) {
        const stmt = primary.prepare(sql);
        if (!sql.includes('INSERT INTO health_erasure_finalizations')) return stmt;
        return { bind(...args) { return { async first() {
          assert.equal(f.count('cloud_account_keys', 'owner-a'), 1);
          assert.deepEqual((await f.call('owner-a', RIGHTS)).body, { error: 'unavailable' });
          assert.equal(f.registry.prepare('SELECT finalized FROM recovery_erasure_cutoffs').get().finalized, 0);
          return stmt.bind(...args).first();
        } }; } };
      } };
    } };
    assert.deepEqual(await erasureWorker.scheduled({}, { ...f.env, DB: paused }),
      { outcome: 'complete', keyDisposition: 'destroyed' });
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 0);
    assert.equal(f.registry.prepare('SELECT finalized FROM recovery_erasure_cutoffs').get().finalized, 1);
    assert.throws(() => f.registry.exec('DELETE FROM recovery_erasure_cutoffs'), /cutoff-immutable/);
    assert.throws(() => f.registry.exec(`
      INSERT OR REPLACE INTO recovery_erasure_cutoffs(uid, consent_revision, fence_epoch)
      VALUES ('owner-a', 1, 1)
    `), /cutoff-fenced/);
  } finally { f.close(); }
});

void test('a lost terminal registry update blocks a physical application restore and is retried by the next tick', async () => {
  const f = await fixture(['owner-a']);
  const dir = mkdtempSync(join(tmpdir(), 'logbook-terminal-restore-'));
  let snapshot;
  try {
    await f.consent('owner-a');
    assert.equal((await f.call('owner-a', SYNC)).response.status, 200);
    await f.withdraw('owner-a');
    assert.equal((await erasureWorker.scheduled({}, f.env)).outcome, 'awaiting-keys');
    const snapshotPath = join(dir, 'before-finalization.sqlite');
    await backup(f.sqlite, snapshotPath);
    snapshot = new DatabaseSync(snapshotPath);
    const restoredDb = new f.db.constructor(snapshot);
    const restoredEnv = { ...f.env, DB: restoredDb,
      AUTH_GATE: { fetch: request => gate.fetch(request, { ...f.gateEnv, DB: restoredDb }) } };
    assert.equal((await f.call('owner-a', RIGHTS, { env: restoredEnv })).response.status, 200);
    f.sqlite.prepare('UPDATE health_erasure_jobs SET lease_until_ms = ?').run(Date.now() - 1000);
    f.registry.exec(`CREATE TRIGGER terminal_unavailable BEFORE UPDATE ON recovery_owner_fences
      WHEN NEW.erased_before_revision > 0 BEGIN SELECT RAISE(ABORT, 'synthetic-terminal-outage'); END`);
    await assert.rejects(erasureWorker.scheduled({}, f.env), /independent-recovery-fence-unavailable/);
    assert.equal(f.count('health_erasure_finalizations', 'owner-a'), 1);
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 0);
    assert.deepEqual((await f.call('owner-a', RIGHTS, { env: restoredEnv })).body, { error: 'unavailable' });
    assert.equal((await f.call('owner-a', '/v1/consent/status')).response.status, 503);
    f.registry.exec("UPDATE recovery_control SET mode='sealed', generation=3 WHERE singleton=1");
    assert.deepEqual(await inspectRestoredD1Census(restoredDb, f.recoveryDb),
      { outcome: 'blocked', reason: 'terminal-erasure-cutoff-pending' });
    f.registry.exec("UPDATE recovery_control SET mode='open', generation=4 WHERE singleton=1");
    f.registry.exec('DROP TRIGGER terminal_unavailable');
    assert.equal((await erasureWorker.scheduled({}, f.env)).outcome, 'idle');
    assert.equal(f.registry.prepare('SELECT finalized FROM recovery_erasure_cutoffs').get().finalized, 1);
    assert.deepEqual((await f.call('owner-a', '/v1/consent/status')).body,
      { uid: 'owner-a', status: 'withdrawn', revision: 2, fenceEpoch: 2 });
    assert.equal((await f.call('owner-a', RIGHTS, { env: restoredEnv })).response.status, 503);
  } finally {
    snapshot?.close();
    f.close();
    rmSync(dir, { recursive: true, force: true });
  }
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
