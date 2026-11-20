import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import gate from '../../cloudflare/auth/session-gate.mjs';
import erasureWorker from '../../cloudflare/jobs/health-erasure-worker.mjs';
import { inspectRestoredD1Census } from '../../cloudflare/recovery/restore-census.mjs';
import { SYNC, RIGHTS, ACCEPT, createCloudKeyHttpFixture as fixture,
  renewSessionWithoutEmail } from './cloud-key-http-fixture.mjs';

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
