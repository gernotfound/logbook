import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyCurrentD1Schema } from './current-d1-schema.mjs';
import { inspectRestoredOwnerFence } from '../../cloudflare/recovery/restore-preflight.mjs';
import { runOneHealthErasureStep } from '../../cloudflare/jobs/health-erasure-worker.mjs';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';
import sessionGate from '../../cloudflare/auth/session-gate.mjs';

const ORIGIN = 'https://candidate.invalid';
class Statement {
  constructor(sqlite, sql, args = []) { this.sqlite = sqlite; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.sqlite, this.sql, args); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.args) ?? null; }
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
function createOwner(sqlite, uid) {
  const acceptedAt = Date.now() - 10000;
  sqlite.prepare("INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch) VALUES (?,'active',?,1)")
    .run(uid, acceptedAt);
  sqlite.prepare("INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,'active',1,1)")
    .run(uid);
  sqlite.prepare('INSERT INTO sync_state(uid,revision) VALUES (?,0)').run(uid);
  sqlite.prepare(`INSERT INTO health_consent_acceptances
    (uid,consent_revision,privacy_version,terms_version,accepted_at_ms,over_18_confirmed)
    VALUES (?,1,'1.3.9','1.2.5',?,1)`).run(uid, acceptedAt);
}
function subject(sqlite, uid) {
  const row = sqlite.prepare(`SELECT uid, status, consent_revision, fence_epoch, erased_before_revision
    FROM sync_subjects WHERE uid=?`).get(uid);
  return row && {
    uid: row.uid, status: row.status, consentRevision: row.consent_revision,
    fenceEpoch: row.fence_epoch, erasedBeforeRevision: row.erased_before_revision,
  };
}
function gateRequest(cookie) {
  return new Request('https://auth-gate.internal/__internal/authorize', {
    method: 'POST', headers: {
      origin: ORIGIN, cookie, 'x-original-method': 'POST',
      'x-original-route': '/v1/sync/control',
    },
  });
}
function gateEnv(sqlite) {
  return { DB: new D1Sqlite(sqlite), API_ORIGIN: ORIGIN,
    CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
    API_RATE_LIMITER: { limit: async () => ({ success: true }) } };
}

void test('SQLite snapshot rollback resurrects old consent; independent external floor detects it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-cf08-'));
  const sourcePath = join(dir, 'source.sqlite');
  const oldPath = join(dir, 'before-erasure.sqlite');
  const restoredPath = join(dir, 'restored.sqlite');
  const ledgerPath = join(dir, 'independent-ledger.sqlite');
  let sqlite;
  let restored;
  let ledger;
  try {
    sqlite = new DatabaseSync(sourcePath);
    sqlite.exec('PRAGMA foreign_keys=ON');
    applyCurrentD1Schema(sqlite);
    createOwner(sqlite, 'owner-a');
    createOwner(sqlite, 'owner-b');
    const issued = await issueVerifiedSession(new D1Sqlite(sqlite), 'owner-a');
    const cookie = issued.setCookies.map(x => x.split(';')[0]).join('; ';
    assert.equal((await sessionGate.fetch(gateRequest(cookie), gateEnv(sqlite))).status, 200);
    sqlite.close();
    sqlite = undefined;
    copyFileSync(sourcePath, oldPath);

    sqlite = new DatabaseSync(sourcePath);
    sqlite.exec('PRAGMA foreign_keys=ON');
    sqlite.prepare(`INSERT INTO health_erasure_jobs
      (uid,consent_revision,fence_epoch,requested_at_ms) VALUES (?,1,1,?)`)
      .run('owner-a', Date.now());
    assert.equal(subject(sqlite, 'owner-a').status, 'withdrawn');
    assert.equal((await runOneHealthErasureStep(new D1Sqlite(sqlite))).outcome, 'awaiting-keys');
    sqlite.prepare(`UPDATE health_erasure_jobs SET lease_until_ms=?
      WHERE uid=? AND status='processing'`).run(Date.now() - 1000, 'owner-a');
    assert.deepEqual(await runOneHealthErasureStep(new D1Sqlite(sqlite)),
      { outcome: 'complete', keyDisposition: 'never-issued' });
    const finalFloor = subject(sqlite, 'owner-a');
    assert.equal(finalFloor.consentRevision, 2);
    assert.equal(finalFloor.erasedBeforeRevision, 2);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM health_erasure_finalizations').get().n, 1);
    assert.equal((await sessionGate.fetch(gateRequest(cookie), gateEnv(sqlite))).status, 401);

    // This fixture represents independently retained evidence, not a
    // deployed trustworthy ledger. It must survive a restore of sourcePath.
    ledger = new DatabaseSync(ledgerPath);
    ledger.exec(`CREATE TABLE recovery_floors (
      uid TEXT PRIMARY KEY, status TEXT NOT NULL, consent_revision INTEGER NOT NULL,
      fence_epoch INTEGER NOT NULL, erased_before_revision INTEGER NOT NULL)`);
    for (const uid of ['owner-a', 'owner-b']) {
      const row = subject(sqlite, uid);
      ledger.prepare('INSERT INTO recovery_floors VALUES (?,?,?,?,?)')
        .run(uid, row.status, row.consentRevision, row.fenceEpoch, row.erasedBeforeRevision);
    }
    sqlite.close();
    sqlite = undefined;

    // A destructive Time Travel restore reproduces an older full DB image.
    // SQLite copy here is a synthetic model, not a D1 provider restore.
    copyFileSync(oldPath, restoredPath);
    restored = new DatabaseSync(restoredPath);
    restored.exec('PRAGMA foreign_keys=ON');
    assert.equal(subject(restored, 'owner-a').status, 'active');
    assert.equal(subject(restored, 'owner-a').erasedBeforeRevision, 0);
    assert.equal(restored.prepare('SELECT count(*) AS n FROM health_erasure_finalizations').get().n, 0);
    // The same old valid session and consent now pass the actual gate.
    assert.equal((await sessionGate.fetch(gateRequest(cookie), gateEnv(restored))).status, 200);

    const evidence = uid => {
      const row = ledger.prepare('SELECT * FROM recovery_floors WHERE uid=?').get(uid);
      return row && { uid: row.uid, status: row.status,
        consentRevision: row.consent_revision, fenceEpoch: row.fence_epoch,
        erasedBeforeRevision: row.erased_before_revision };
    };
    assert.deepEqual(inspectRestoredOwnerFence(subject(restored, 'owner-a'), evidence('owner-a')), {
      outcome: 'blocked', reason: 'restored-generation-older-than-independent-floor',
    });
    assert.deepEqual(inspectRestoredOwnerFence(subject(restored, 'owner-b'), evidence('owner-b')), {
      outcome: 'consistent-for-diagnostics-only',
    });
    assert.deepEqual(inspectRestoredOwnerFence(subject(restored, 'owner-a'), null), {
      outcome: 'blocked', reason: 'independent-proof-missing-or-invalid',
    });
  } finally {
    restored?.close();
    ledger?.close();
    sqlite?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('restore preflight fails closed for unknown, mismatched, stale and deleted identities', () => {
  const floor = {
    uid: 'owner-a', status: 'withdrawn',
    consentRevision: 2, fenceEpoch: 2, erasedBeforeRevision: 2,
  };
  const current = { ...floor };
  assert.deepEqual(inspectRestoredOwnerFence(current, floor),
    { outcome: 'consistent-for-diagnostics-only' });
  assert.deepEqual(inspectRestoredOwnerFence(current, { ...floor, uid: 'owner-b' }), {
    outcome: 'blocked', reason: 'owner-mismatch',
  });
  assert.deepEqual(inspectRestoredOwnerFence({ ...current, status: 'active' }, floor), {
    outcome: 'blocked', reason: 'withdrawn-owner-resurrected',
  });
  assert.deepEqual(inspectRestoredOwnerFence({ ...current, status: 'active' },
    { ...floor, status: 'deleted' }), {
    outcome: 'blocked', reason: 'deleted-owner-resurrected',
  });
  for (const row of [
    null, { ...current, consentRevision: 1, erasedBeforeRevision: 1 },
    { ...current, fenceEpoch: 1 }, { ...current, erasedBeforeRevision: 1 },
  ]) {
    assert.equal(inspectRestoredOwnerFence(row, floor).outcome, 'blocked');
  }
  for (const invalid of [null, {}, { ...floor, erasedBeforeRevision: -1 },
    { ...floor, fenceEpoch: 0 }, { ...floor, status: 'unknown' }]) {
    assert.deepEqual(inspectRestoredOwnerFence(current, invalid), {
      outcome: 'blocked', reason: 'independent-proof-missing-or-invalid',
    });
  }
});
