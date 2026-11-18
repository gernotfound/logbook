import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { RECOVERY_MIGRATIONS, verifyLocalRecoveryTarget, verifyRecoveryLedger, verifyRecoverySnapshot } from '../../scripts/verify-cloudflare-recovery-d1-schema.mjs';
import { applyCurrentD1RecoverySchema, applyCurrentD1Schema } from './current-d1-schema.mjs';
import { runOneHealthErasureStep } from '../../cloudflare/jobs/health-erasure-worker.mjs';
import { inspectRestoredD1Census } from '../../cloudflare/recovery/restore-census.mjs';
import {
  IndependentFenceUnavailableError, enrollIndependentOwner,
  recordVerifiedInitialConsent, armIndependentHealthWithdrawal,
  recordVerifiedHealthWithdrawal, recordVerifiedTerminalErasure,
  requireIndependentOwnerFence,
} from '../../cloudflare/recovery/independent-owner-fence.mjs';

class Statement {
  constructor(sqlite, sql, args = []) { this.sqlite = sqlite; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.sqlite, this.sql, args); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async all() {
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.args) };
  }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: result.changes } };
  }
}
class D1Sqlite {
  constructor(sqlite) { this.sqlite = sqlite; }
  withSession(mode) { assert.equal(mode, 'first-primary'); return this; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
}
function addOwner(sqlite, uid) {
  const now = Date.now() - 10000;
  sqlite.prepare("INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch) VALUES (?,'active',?,1)")
    .run(uid, now);
  sqlite.prepare("INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,'active',1,1)")
    .run(uid);
  sqlite.prepare('INSERT INTO sync_state(uid,revision) VALUES (?,0)').run(uid);
  sqlite.prepare(`INSERT INTO health_consent_acceptances
    (uid,consent_revision,privacy_version,terms_version,accepted_at_ms,over_18_confirmed)
    VALUES (?,1,'1.3.9','1.2.5',?,1)`).run(uid, now);
}
function subject(sqlite, uid) {
  const row = sqlite.prepare(`SELECT uid, status, consent_revision, fence_epoch,
    erased_before_revision FROM sync_subjects WHERE uid = ?`).get(uid);
  return row && {
    uid: row.uid, status: row.status,
    consentRevision: row.consent_revision, fenceEpoch: row.fence_epoch,
    erasedBeforeRevision: row.erased_before_revision,
  };
}
function fence(sqlite, uid) {
  return sqlite.prepare('SELECT * FROM recovery_owner_fences WHERE uid=?').get(uid);
}
const rejected = promise => assert.rejects(promise, IndependentFenceUnavailableError);

void test('independent monotone fence blocks old consent after a physical application DB rollback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-cf08-authority-'));
  const dbFile = join(dir, 'primary.sqlite');
  const oldFile = join(dir, 'before-withdrawal.sqlite');
  const fenceFile = join(dir, 'independent.sqlite');
  let app;
  let ledger;
  try {
    app = new DatabaseSync(dbFile);
    app.exec('PRAGMA foreign_keys=ON');
    applyCurrentD1Schema(app);
    ledger = new DatabaseSync(fenceFile);
    applyCurrentD1RecoverySchema(ledger);
    const appDb = new D1Sqlite(app);
    const fenceDb = new D1Sqlite(ledger);
    addOwner(app, 'owner-a');
    addOwner(app, 'owner-b');
    for (const uid of ['owner-a', 'owner-b']) {
      assert.equal((await enrollIndependentOwner(fenceDb, uid)).status, 'pending');
      assert.equal((await recordVerifiedInitialConsent(appDb, fenceDb, uid)).status, 'active');
    }
    // An independent registry starts SEALED, even for a valid app consent.
    await rejected(requireIndependentOwnerFence(fenceDb, subject(app, 'owner-a')));
    ledger.prepare("UPDATE recovery_control SET mode='open',generation=2 WHERE singleton=1").run();
    assert.equal(await requireIndependentOwnerFence(fenceDb, subject(app, 'owner-a')), true);
    app.close();
    app = undefined;
    copyFileSync(dbFile, oldFile);

    app = new DatabaseSync(dbFile);
    app.exec('PRAGMA foreign_keys=ON');
    const currentApp = new D1Sqlite(app);
    const armed = await armIndependentHealthWithdrawal(fenceDb, subject(app, 'owner-a'));
    assert.equal(armed.status, 'blocked');
    // Crash here: the main DB is still active, but the external floor already denies fitness.
    assert.equal(subject(app, 'owner-a').status, 'active');
    await rejected(requireIndependentOwnerFence(fenceDb, subject(app, 'owner-a')));
    await rejected(recordVerifiedHealthWithdrawal(currentApp, fenceDb, 'owner-a'));
    app.prepare(`INSERT INTO health_erasure_jobs
      (uid,consent_revision,fence_epoch,requested_at_ms) VALUES (?,1,1,?)`)
      .run('owner-a', Date.now());
    assert.equal(subject(app, 'owner-a').status, 'withdrawn');
    await rejected(requireIndependentOwnerFence(fenceDb, subject(app, 'owner-a'), 'rights'));
    assert.equal((await recordVerifiedHealthWithdrawal(currentApp, fenceDb, 'owner-a')).status, 'withdrawn');
    assert.equal(await requireIndependentOwnerFence(fenceDb, subject(app, 'owner-a'), 'rights'), true);
    assert.equal((await runOneHealthErasureStep(currentApp)).outcome, 'awaiting-keys');
    app.prepare(`UPDATE health_erasure_jobs SET lease_until_ms = ?
      WHERE uid = ? AND status = 'processing'`).run(Date.now() - 1000, 'owner-a');
    assert.deepEqual(await runOneHealthErasureStep(currentApp),
      { outcome: 'complete', keyDisposition: 'never-issued' });
    const closed = await recordVerifiedTerminalErasure(currentApp, fenceDb, 'owner-a');
    assert.equal(closed.consentRevision, 2);
    assert.equal(closed.erasedBeforeRevision, 2);
    assert.equal(fence(ledger, 'owner-a').fence_epoch, 2);
    assert.equal(fence(ledger, 'owner-b').status, 'active');

    app.close();
    app = undefined;
    copyFileSync(oldFile, dbFile);
    app = new DatabaseSync(dbFile);
    app.exec('PRAGMA foreign_keys=ON');
    assert.equal(subject(app, 'owner-a').status, 'active');
    assert.equal(subject(app, 'owner-a').consentRevision, 1);
    await rejected(requireIndependentOwnerFence(fenceDb, subject(app, 'owner-a')));
    assert.equal(await requireIndependentOwnerFence(fenceDb, subject(app, 'owner-b')), true);
    await rejected(recordVerifiedTerminalErasure(new D1Sqlite(app), fenceDb, 'owner-a'));
    assert.equal(fence(ledger, 'owner-a').erased_before_revision, 2);
    ledger.prepare("UPDATE recovery_control SET mode='sealed',generation=3 WHERE singleton=1").run();
    assert.deepEqual(await inspectRestoredD1Census(new D1Sqlite(app), fenceDb), {
      outcome: 'blocked', reason: 'restored-generation-older-than-independent-floor',
    });
  } finally {
    app?.close();
    ledger?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('missing, unavailable or altered external proof and duplicate enrollment fail closed', async () => {
  const ledger = new DatabaseSync(':memory:');
  try {
    applyCurrentD1RecoverySchema(ledger);
    const db = new D1Sqlite(ledger);
    const subjectA = {
      uid: 'owner-a', status: 'active', consentRevision: 1,
      fenceEpoch: 1, erasedBeforeRevision: 0,
    };
    await rejected(requireIndependentOwnerFence(db, subjectA));
    await rejected(requireIndependentOwnerFence(null, subjectA));
    await rejected(requireIndependentOwnerFence({ withSession() { throw Error('quota-outage'); } }, subjectA));
    await rejected(requireIndependentOwnerFence(db, { ...subjectA, uid: 'owner-b' }));
    await rejected(enrollIndependentOwner(db, '../untrusted'));
    assert.equal((await enrollIndependentOwner(db, 'owner-a')).status, 'pending');
    assert.equal((await enrollIndependentOwner(db, 'owner-a')).status, 'pending');
    await rejected(enrollIndependentOwner(db, 'owner-a', 2));
    await rejected(enrollIndependentOwner(db, 'new-owner', 2));
    assert.equal(fence(ledger, 'new-owner'), undefined);
    await rejected(armIndependentHealthWithdrawal(db, { ...subjectA, uid: 'unenrolled' }));
    await rejected(armIndependentHealthWithdrawal(db, { ...subjectA, fenceEpoch: 2 }));
    const original = fence(ledger, 'owner-a');
    assert.equal(original.status, 'pending');
    assert.throws(() => ledger.prepare(
      "UPDATE recovery_owner_fences SET status='active', consent_revision=2, change_seq=2 WHERE uid='owner-a'"
    ).run(), /recovery-fence-regression/);
    assert.throws(() => ledger.prepare(
      "DELETE FROM recovery_owner_fences WHERE uid='owner-a'"
    ).run(), /recovery-owner-immutable/);
    assert.throws(() => ledger.prepare(
      "UPDATE recovery_control SET mode='open',generation=1 WHERE singleton=1"
    ).run(), /recovery-control-regression/);
    assert.equal(ledger.prepare('PRAGMA recursive_triggers').get().recursive_triggers, 0);
    assert.throws(() => ledger.prepare(
      "INSERT OR REPLACE INTO recovery_control(singleton,mode,generation) VALUES (1,'open',2)"
    ).run(), /recovery-control-exists/);
    assert.deepEqual({ ...ledger.prepare('SELECT mode,generation FROM recovery_control').get() },
      { mode: 'sealed', generation: 1 });
    assert.throws(() => ledger.prepare(
      "INSERT OR REPLACE INTO recovery_owner_fences VALUES ('owner-a','pending',0,1,0,1)"
    ).run(), /recovery-owner-exists/);
    assert.throws(() => ledger.prepare(
      "INSERT OR IGNORE INTO recovery_owner_fences VALUES ('owner-a','pending',0,1,0,1)"
    ).run(), /recovery-owner-exists/);
    assert.equal(fence(ledger, 'owner-a').status, 'pending');
    assert.equal(fence(ledger, 'owner-a').change_seq, 1);
  } finally { ledger.close(); }
});

void test('duplicate or late write does not undo a durable independent deny', async () => {
  const ledger = new DatabaseSync(':memory:');
  try {
    applyCurrentD1RecoverySchema(ledger);
    const fenceDb = new D1Sqlite(ledger);
    const a = {
      uid: 'owner-a', status: 'active', consentRevision: 1,
      fenceEpoch: 1, erasedBeforeRevision: 0,
    };
    await enrollIndependentOwner(fenceDb, 'owner-a');
    ledger.prepare(`UPDATE recovery_owner_fences SET status='active',
      consent_revision=1,change_seq=2 WHERE uid='owner-a'`).run();
    const blocked = await armIndependentHealthWithdrawal(fenceDb, a);
    assert.equal(blocked.status, 'blocked');
    assert.deepEqual(await armIndependentHealthWithdrawal(fenceDb, a), blocked);
    assert.equal(fence(ledger, 'owner-a').change_seq, 3);
    assert.throws(() => ledger.prepare(`UPDATE recovery_owner_fences
      SET status='active',change_seq=4 WHERE uid='owner-a'`).run(),
      /recovery-fence-regression/);
    assert.equal(fence(ledger, 'owner-a').status, 'blocked');
    ledger.prepare("UPDATE recovery_control SET mode='open',generation=2 WHERE singleton=1").run();
    await rejected(requireIndependentOwnerFence(fenceDb, a));
    await rejected(requireIndependentOwnerFence(fenceDb,
      { ...a, uid: 'owner-b' }, 'rights'));
  } finally { ledger.close(); }
});

void test('isolated migration manifest cannot route traffic or bind the primary D1', () => {
  const cfg = JSON.parse(readFileSync(new URL(
    '../../cloudflare/recovery/wrangler.isolated.jsonc', import.meta.url), 'utf8'));
  assert.equal(cfg.name, 'thelogbook-cf08-fence-schema-isolated');
  assert.equal(cfg.workers_dev, false);
  assert.equal(cfg.preview_urls, false);
  for (const forbidden of ['main', 'routes', 'route', 'triggers', 'assets', 'services', 'vars']) {
    assert.equal(Object.hasOwn(cfg, forbidden), false);
  }
  assert.equal(cfg.d1_databases?.length, 1);
  assert.deepEqual(cfg.d1_databases[0], {
    binding: 'RECOVERY_DB',
    database_name: 'thelogbook-cf08-fence-eu-isolated-20261116',
    database_id: '19dad53f-0dda-4503-b161-758ac8cb7b21',
    migrations_dir: './migrations',
  });
});

void test('operator census scans both full D1 tables while sealed, not caller-selected owner lists', async () => {
  const app = new DatabaseSync(':memory:');
  const ledger = new DatabaseSync(':memory:');
  try {
    app.exec('PRAGMA foreign_keys=ON');
    applyCurrentD1Schema(app);
    applyCurrentD1RecoverySchema(ledger);
    const appDb = new D1Sqlite(app);
    const fenceDb = new D1Sqlite(ledger);
    assert.deepEqual(await inspectRestoredD1Census(appDb, fenceDb), {
      outcome: 'blocked', reason: 'independent-coverage-empty',
    });
    for (const uid of ['owner-a', 'owner-b']) {
      addOwner(app, uid);
      await enrollIndependentOwner(fenceDb, uid);
      await recordVerifiedInitialConsent(appDb, fenceDb, uid);
    }
    assert.deepEqual(await inspectRestoredD1Census(appDb, fenceDb), {
      outcome: 'consistent-for-diagnostics-only',
    });
    assert.deepEqual(await inspectRestoredD1Census(appDb, appDb), {
      outcome: 'blocked', reason: 'independent-database-required',
    });
    assert.deepEqual(await inspectRestoredD1Census(null, fenceDb), {
      outcome: 'blocked', reason: 'independent-database-required',
    });

    ledger.prepare("UPDATE recovery_control SET mode='open',generation=2 WHERE singleton=1").run();
    assert.deepEqual(await inspectRestoredD1Census(appDb, fenceDb), {
      outcome: 'blocked', reason: 'independent-authority-not-sealed',
    });
    ledger.prepare("UPDATE recovery_control SET mode='sealed',generation=3 WHERE singleton=1").run();
    addOwner(app, 'owner-c');
    assert.deepEqual(await inspectRestoredD1Census(appDb, fenceDb), {
      outcome: 'blocked', reason: 'owner-coverage-mismatch',
    });
  } finally {
    app.close();
    ledger.close();
  }
});

void test('operator census detects a registry write racing two primary reads', async () => {
  const app = new DatabaseSync(':memory:');
  const ledger = new DatabaseSync(':memory:');
  try {
    app.exec('PRAGMA foreign_keys=ON');
    applyCurrentD1Schema(app);
    applyCurrentD1RecoverySchema(ledger);
    const appDb = new D1Sqlite(app);
    const fenceDb = new D1Sqlite(ledger);
    addOwner(app, 'owner-a');
    await enrollIndependentOwner(fenceDb, 'owner-a');
    await recordVerifiedInitialConsent(appDb, fenceDb, 'owner-a');
    let changed = false;
    class RacingD1 extends D1Sqlite {
      prepare(sql) {
        const original = super.prepare(sql);
        if (!sql.includes('FROM recovery_owner_fences') || !sql.includes('ORDER BY uid')) {
          return original;
        }
        return {
          bind(...args) {
            const bound = original.bind(...args);
            return {
              async all() {
                const reply = await bound.all();
                if (!changed) {
                  changed = true;
                  ledger.prepare(`UPDATE recovery_owner_fences
                    SET status='blocked', change_seq=change_seq+1 WHERE uid='owner-a'`).run();
                }
                return reply;
              },
            };
          },
        };
      }
    }
    assert.deepEqual(await inspectRestoredD1Census(appDb, new RacingD1(ledger)), {
      outcome: 'blocked', reason: 'coverage-changed-during-scan',
    });
    assert.equal(changed, true);
    assert.equal(fence(ledger, 'owner-a').status, 'blocked');
  } finally {
    app.close();
    ledger.close();
  }
});

void test('operator census rejects failed D1 reads and malformed independent row sequences', async () => {
  const app = new DatabaseSync(':memory:');
  const ledger = new DatabaseSync(':memory:');
  try {
    app.exec('PRAGMA foreign_keys=ON');
    applyCurrentD1Schema(app);
    applyCurrentD1RecoverySchema(ledger);
    const appDb = new D1Sqlite(app);
    addOwner(app, 'owner-a');
    const fenceDb = new D1Sqlite(ledger);
    await enrollIndependentOwner(fenceDb, 'owner-a');
    await recordVerifiedInitialConsent(appDb, fenceDb, 'owner-a');
    const unavailable = {
      withSession(mode) {
        assert.equal(mode, 'first-primary');
        throw new Error('synthetic D1 read quota exceeded');
      },
    };
    assert.deepEqual(await inspectRestoredD1Census(appDb, unavailable), {
      outcome: 'blocked', reason: 'scan-unavailable',
    });
    class MissingSequenceD1 extends D1Sqlite {
      prepare(sql) {
        const statement = super.prepare(sql);
        if (!sql.includes('FROM recovery_owner_fences') || !sql.includes('ORDER BY uid')) {
          return statement;
        }
        return {
          bind(...args) {
            const bound = statement.bind(...args);
            return {
              async all() {
                const reply = await bound.all();
                return { ...reply, results: reply.results.map(row => ({ ...row, change_seq: null })) };
              },
            };
          },
        };
      }
    }
    assert.deepEqual(await inspectRestoredD1Census(appDb, new MissingSequenceD1(ledger)), {
      outcome: 'blocked', reason: 'independent-row-sequence-invalid',
    });
  } finally {
    app.close();
    ledger.close();
  }
});

void test('operator census rejects owner counts beyond its bounded D1 read budget', async () => {
  const app = new DatabaseSync(':memory:');
  const ledger = new DatabaseSync(':memory:');
  try {
    app.exec('PRAGMA foreign_keys=ON');
    applyCurrentD1Schema(app);
    applyCurrentD1RecoverySchema(ledger);
    for (let i = 0; i < 513; i++) {
      const uid = 'owner-' + String(i).padStart(4, '0');
      addOwner(app, uid);
      ledger.prepare(`INSERT INTO recovery_owner_fences
        (uid,status,consent_revision,fence_epoch,erased_before_revision,change_seq)
        VALUES (?,'pending',0,1,0,1)`).run(uid);
      ledger.prepare(`UPDATE recovery_owner_fences SET status='active',
        consent_revision=1,change_seq=2 WHERE uid=?`).run(uid);
    }
    assert.deepEqual(await inspectRestoredD1Census(new D1Sqlite(app), new D1Sqlite(ledger)), {
      outcome: 'blocked', reason: 'coverage-limit-exceeded',
    });
    assert.equal(app.prepare('SELECT COUNT(*) AS n FROM sync_subjects').get().n, 513);
    assert.equal(ledger.prepare('SELECT COUNT(*) AS n FROM recovery_owner_fences').get().n, 513);
  } finally {
    app.close();
    ledger.close();
  }
});


void test('recovery operator pins isolation and additive migration set', () => {
  const config = JSON.parse(readFileSync(
    new URL('../../cloudflare/api/wrangler.isolated.jsonc', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => verifyLocalRecoveryTarget(config, RECOVERY_MIGRATIONS));
  assert.throws(() => verifyLocalRecoveryTarget(config, [...RECOVERY_MIGRATIONS, '0005_unknown.sql']));
  assert.throws(() => verifyLocalRecoveryTarget({
    ...config, d1_databases: [{ ...config.d1_databases[0] }, {
      ...config.d1_databases[1], database_id: config.d1_databases[0].database_id,
    }],
  }, RECOVERY_MIGRATIONS));
});

void test('recovery operator accepts only contiguous known migrations', () => {
  const rows = RECOVERY_MIGRATIONS.map((name, i) => ({ id: i + 1, name }));
  assert.equal(verifyRecoveryLedger(rows.slice(0, 2), 'before'), 2);
  assert.equal(verifyRecoveryLedger(rows.slice(0, 3), 'before'), 3);
  assert.equal(verifyRecoveryLedger(rows, 'after'), 4);
  assert.throws(() => verifyRecoveryLedger(rows.slice(0, 2), 'after'));
  assert.throws(() => verifyRecoveryLedger([{ ...rows[0], name: 'bad.sql' }, rows[1]], 'before'));
  assert.throws(() => verifyRecoveryLedger([rows[0], rows[2]], 'before'));
});

void test('recovery operator fails closed for opened, populated or wrong-jurisdiction D1', () => {
  const metadata = { uuid: '19dad53f-0dda-4503-b161-758ac8cb7b21',
    name: 'thelogbook-cf08-fence-eu-isolated-20261116',
    jurisdiction: 'eu', read_replication: { mode: 'disabled' } };
  const ledger = RECOVERY_MIGRATIONS.slice(0, 2).map((name, i) => ({ id: i + 1, name }));
  const control = [{ mode: 'sealed', generation: 1, owners: 0, cutoffs: 0 }];
  const original = { metadata, bookmark: 'synthetic-checkpoint', ledger, control, phase: 'before' };
  assert.equal(verifyRecoverySnapshot(original).applied, 2);
  for (const change of [
    { control: [{ ...control[0], mode: 'open' }] },
    { control: [{ ...control[0], owners: 1 }] },
    { metadata: { ...metadata, jurisdiction: 'apac' } },
    { metadata: { ...metadata, uuid: 'unexpected' } },
    { bookmark: '' },
  ]) assert.throws(() => verifyRecoverySnapshot({ ...original, ...change }));
  assert.throws(() => verifyRecoverySnapshot({ ...original, phase: 'after' }));
});
