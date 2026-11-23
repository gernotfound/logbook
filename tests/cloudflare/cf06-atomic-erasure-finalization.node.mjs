import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { releaseCloudAccountDataKey } from '../../cloudflare/api/cloud-key-store.mjs';
import { runOneHealthErasureStep } from '../../cloudflare/jobs/health-erasure-worker.mjs';
import { writeReplicaMutation } from '../../cloudflare/api/replica-maintenance.mjs';
import { commitEncryptedBatch } from '../../cloudflare/api/d1-document-store.mjs';
import { applyCurrentD1Schema } from './current-d1-schema.mjs';

const migrationDirectory = new URL('../../cloudflare/api/migrations/', import.meta.url);
const beforeFinalization = readdirSync(migrationDirectory)
  .filter(name => /^000[1-9]_[a-z0-9_]+\.sql$/.test(name)).sort();
assert.deepEqual(beforeFinalization.map(name => name.slice(0, 4)),
  Array.from({ length: 9 }, (_, i) => String(i + 1).padStart(4, '0')));
const KEK = Buffer.alloc(32, 57).toString('base64');
const NOW = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

// This is the single statement exposed to D-02. It is intentionally NOT a
// D1.batch(): every side effect must be within the INSERT trigger itself.
const FINALIZE = `
INSERT INTO health_erasure_finalizations (
  uid, consent_revision, fence_epoch, lease_epoch, lease_token,
  completed_at_ms, erased_before_revision, sync_revision_at_erasure,
  key_disposition, key_issued_at_ms
)
SELECT j.uid, j.consent_revision, j.fence_epoch, j.lease_epoch, j.lease_token,
  ${NOW}, j.consent_revision + 1, rev.revision,
  CASE WHEN issuance.uid IS NULL THEN 'never-issued' ELSE 'destroyed' END,
  issuance.issued_at_ms
FROM health_erasure_jobs j
JOIN sync_state rev ON rev.uid = j.uid
LEFT JOIN cloud_key_issuance issuance
  ON issuance.uid = j.uid AND issuance.consent_revision = j.consent_revision
WHERE j.uid = ? AND j.consent_revision = ? AND j.fence_epoch = ?
  AND j.lease_epoch = ? AND j.lease_token = ?
  AND j.status = 'processing' AND j.phase = 'awaiting-keys'
RETURNING uid, consent_revision, fence_epoch, lease_epoch, completed_at_ms,
  erased_before_revision, sync_revision_at_erasure, key_disposition
`;

class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const meta = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: meta.changes } };
  }
}
class D1Sqlite {
  constructor(db) { this.sqlite = db; }
  withSession(mode) { assert.equal(mode, 'first-primary'); return this; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(s => /^\s*SELECT\b/i.test(s.sql) ? s.all() : s.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
async function fixture(run, { testUpgradeFrom0009 = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'logbook-b02-sql-'));
  const file = join(directory, 'full-schema.sqlite');
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500');
  if (testUpgradeFrom0009) {
    for (const name of beforeFinalization) sqlite.exec(readFileSync(new URL(name, migrationDirectory), 'utf8'));
  } else applyCurrentD1Schema(sqlite);
  const db = new D1Sqlite(sqlite);
  const second = new DatabaseSync(file);
  second.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500');
  try { await run({ sqlite, db, second, db2: new D1Sqlite(second) }); }
  finally { second.close(); sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
}
function count(f, table, uid = 'owner-a') {
  return f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE uid=?`).get(uid).n;
}
function subject(f, uid = 'owner-a') {
  return f.sqlite.prepare('SELECT * FROM sync_subjects WHERE uid=?').get(uid);
}
function job(f, uid = 'owner-a') {
  return f.sqlite.prepare('SELECT * FROM health_erasure_jobs WHERE uid=? ORDER BY consent_revision DESC LIMIT 1').get(uid);
}
function proof(f, uid = 'owner-a') {
  return f.sqlite.prepare('SELECT * FROM health_erasure_finalizations WHERE uid=? ORDER BY consent_revision DESC LIMIT 1').get(uid);
}
function owner(f, uid) {
  const at = Date.now() - 10_000;
  const sessionHash = uid === 'owner-a' ? 'a'.repeat(64) : 'b'.repeat(64);
  f.sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)").run(uid, at);
  f.sqlite.prepare("INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,'active',1,1)").run(uid);
  f.sqlite.prepare('INSERT INTO sync_state(uid,revision) VALUES (?,0)').run(uid);
  f.sqlite.prepare(`INSERT INTO health_consent_acceptances
    (uid,consent_revision,privacy_version,terms_version,accepted_at_ms,over_18_confirmed)
    VALUES (?,1,'1.3.9','1.2.5',?,1)`).run(uid, at);
  f.sqlite.prepare(`INSERT INTO auth_sessions
    (token_hash,uid,auth_epoch,csrf_hash,issued_at_ms,idle_expires_at_ms,absolute_expires_at_ms)
    VALUES (?,?,1,?,?,?,?)`).run(sessionHash, uid, 'c'.repeat(64),
      at, at + 3600000, at + 7200000);
  return sessionHash;
}
async function provision(f, uid = 'owner-a') {
  const key = await releaseCloudAccountDataKey(f.db, {
    CLOUD_ACCOUNT_KEK_V1: KEK, CONSENT_PRIVACY_VERSION: '1.3.9',
    CONSENT_TERMS_VERSION: '1.2.5',
  }, {
    uid, authenticated: true, emailVerified: true, csrfVerified: true,
    rateGatePassed: true, fenceEpoch: 1, healthConsentRevision: 1,
    sessionHash: uid === 'owner-a' ? 'a'.repeat(64) : 'b'.repeat(64),
  });
  assert.equal(key.byteLength, 32);
  key.fill(0);
}
async function populate(f, uid = 'owner-a') {
  const id = 'replica-' + uid;
  const now = Date.now();
  // The real D1 adapters first insert an immutable mutation receipt and use
  // a guarded atomic batch to update membership and the revision.
  await writeReplicaMutation(f.db, uid, {
    mutationId: 'mutation-0000000001', hash: 'f'.repeat(64),
    sessionHash: uid === 'owner-a' ? 'a'.repeat(64) : 'b'.repeat(64),
    action: 'register', expectedRevision: 0,
    consentRevision: 1, fenceEpoch: 1,
    slot: 's00', replicaId: id, generation: 1, lastSeq: 0,
    checkpointAtMs: now, leaseUntilMs: now + 86400000, checkpointClock: {},
  });
  await commitEncryptedBatch(f.db, uid, 1, {
    batchId: 'batch-000000000001', expectedRevision: 1, consentRevision: 1,
    replica: { slot: 's00', replicaId: id, generation: 1 },
    lastSeq: 1, documents: [{ path: '', document: {
      _schemaVersion: 1, _sync: { protocolVersion: 3, clock: { s00: 1 },
        writer: { slot: 's00', replicaId: id, generation: 1, seq: 1, consentRevision: 1 },
        fields: {} }, _sealed: { format: 'thelogbook-cloud-document',
        version: 1, nonce: 'A'.repeat(32), ciphertext: 'B'.repeat(48) },
    } }],
  }, 'd'.repeat(64), uid === 'owner-a' ? 'a'.repeat(64) : 'b'.repeat(64));
}
function withdraw(f, uid = 'owner-a') {
  f.sqlite.prepare(`INSERT INTO health_erasure_jobs
    (uid,consent_revision,fence_epoch,requested_at_ms) VALUES (?,1,1,?)`).run(uid, Date.now());
  assert.equal(subject(f, uid).status, 'withdrawn');
}
function expireLease(f, uid = 'owner-a') {
  // Both clocks can tick at different resolutions on Windows. An already
  // claimed synthetic lease needs a positive timestamp unambiguously expired.
  const result = f.sqlite.prepare(`UPDATE health_erasure_jobs
    SET lease_until_ms=1 WHERE uid=? AND status='processing'`).run(uid);
  assert.equal(result.changes, 1);
}
async function awaitKeys(f, uid = 'owner-a') {
  for (let step = 0; step < 16; step++) {
    const result = await runOneHealthErasureStep(f.db);
    if (result.outcome === 'awaiting-keys') {
      assert.equal(job(f, uid).status, 'processing');
      assert.equal(job(f, uid).phase, 'awaiting-keys');
      return;
    }
    assert.equal(result.outcome, 'progress');
    expireLease(f, uid);
  }
  assert.fail('bounded erasure did not drain');
}
function lease(f, uid = 'owner-a') {
  const j = job(f, uid);
  return [uid, j.consent_revision, j.fence_epoch, j.lease_epoch, j.lease_token];
}
async function finalize(f, args = lease(f), db = f.db) {
  return db.withSession('first-primary').prepare(FINALIZE).bind(...args).first();
}
function verifyComplete(f, keyDisposition, uid = 'owner-a', syncRevision = 0) {
  const j = job(f, uid), p = proof(f, uid), s = subject(f, uid);
  assert.equal(j.status, 'complete');
  assert.equal(j.phase, 'awaiting-keys');
  assert.equal(j.completed_at_ms, p.completed_at_ms);
  assert.equal(j.erased_before_revision, 2);
  assert.equal(j.key_disposition, keyDisposition);
  assert.equal(p.key_disposition, keyDisposition);
  assert.equal(p.erased_before_revision, 2);
  assert.equal(p.sync_revision_at_erasure, syncRevision);
  assert.equal(s.status, 'withdrawn');
  assert.equal(s.consent_revision, 2);
  assert.equal(s.fence_epoch, 2);
  assert.equal(s.erased_before_revision, 2);
  assert.equal(f.sqlite.prepare('SELECT revision FROM sync_state WHERE uid=?').get(uid).revision, syncRevision);
  for (const table of ['sync_documents','sync_receipts','sync_replica_mutations','sync_replicas','cloud_account_keys']) {
    assert.equal(count(f, table, uid), 0, table);
  }
  assert.equal(count(f, 'cloud_key_issuance', uid), keyDisposition === 'destroyed' ? 1 : 0);
}

void test('current schema: drained encrypted data, ADK destruction, durable proof and consent floor share one statement', () =>
  fixture(async f => {
    owner(f, 'owner-a');
    await provision(f);
    await populate(f);
    assert.equal(count(f, 'sync_documents'), 1);
    assert.equal(count(f, 'sync_receipts'), 1);
    withdraw(f);
    await awaitKeys(f);
    const done = await finalize(f);
    assert.equal(done?.uid, 'owner-a');
    assert.equal(done?.key_disposition, 'destroyed');
    assert.equal(done?.erased_before_revision, 2);
    verifyComplete(f, 'destroyed', 'owner-a', 2);
    assert.equal((await finalize(f)), null);
    assert.throws(() => f.sqlite.prepare(
      'DELETE FROM health_erasure_finalizations WHERE uid=?').run('owner-a'),
      /erasure-proof-immutable/);
    assert.throws(() => f.sqlite.prepare(
      'UPDATE health_erasure_finalizations SET completed_at_ms=1 WHERE uid=?').run('owner-a'),
      /erasure-proof-immutable/);
    assert.throws(() => f.sqlite.prepare(
      "UPDATE health_erasure_jobs SET status='processing' WHERE uid='owner-a'"
    ).run(), /erasure-progress-fenced/);
    assert.throws(() => f.sqlite.prepare(
      "UPDATE sync_subjects SET erased_before_revision=1 WHERE uid='owner-a'"
    ).run(), /erasure-subject-fenced/);
    assert.throws(() => f.sqlite.prepare(
      "INSERT INTO cloud_account_keys VALUES ('owner-a', 1, 'thelogbook-wrapped-account-key', 1, 1, ?, ?, ?, ?)"
    ).run('a'.repeat(16),'a'.repeat(44),'a'.repeat(24),Date.now()), /cloud-key-provision-fenced/);
  }));

void test('0010 applies additively to an existing 0009 database with a withdrawn awaiting-keys job', () =>
  fixture(async f => {
    owner(f, 'owner-a');
    await provision(f);
    await populate(f);
    withdraw(f);
    await awaitKeys(f);
    const before = {
      consentRevision: subject(f).consent_revision,
      fenceEpoch: subject(f).fence_epoch,
      leaseEpoch: job(f).lease_epoch,
      token: job(f).lease_token,
      syncRevision: f.sqlite.prepare("SELECT revision FROM sync_state WHERE uid='owner-a'").get().revision,
      issuanceAt: f.sqlite.prepare("SELECT issued_at_ms FROM cloud_key_issuance WHERE uid='owner-a'").get().issued_at_ms,
    };
    f.sqlite.exec(readFileSync(
      new URL('0010_atomic_health_erasure_finalization.sql', migrationDirectory),
      'utf8',
    ));
    assert.equal(subject(f).consent_revision, before.consentRevision);
    assert.equal(subject(f).fence_epoch, before.fenceEpoch);
    assert.equal(subject(f).erased_before_revision, 0);
    assert.equal(job(f).lease_epoch, before.leaseEpoch);
    assert.equal(job(f).lease_token, before.token);
    assert.equal(count(f, 'cloud_account_keys'), 1);
    assert.equal(f.sqlite.prepare("SELECT issued_at_ms FROM cloud_key_issuance WHERE uid='owner-a'").get().issued_at_ms,
      before.issuanceAt);
    assert.equal((await finalize(f))?.key_disposition, 'destroyed');
    verifyComplete(f, 'destroyed', 'owner-a', before.syncRevision);
  }, { testUpgradeFrom0009: true }));

void test('ADK never issued finalizes without fabricating key deletion or issuance marker', () =>
  fixture(async f => {
    owner(f, 'owner-a');
    withdraw(f);
    await awaitKeys(f);
    const completed = await finalize(f);
    assert.equal(completed?.key_disposition, 'never-issued');
    verifyComplete(f, 'never-issued');
    assert.equal(proof(f).key_issued_at_ms, null);
  }));

void test('issued-but-missing ADK is NOT equivalent to never-issued: preserves withdrawn job', () =>
  fixture(async f => {
    owner(f, 'owner-a');
    await provision(f);
    // Simulate an anomalous database copy where a key was lost despite an
    // immutable historical issuance marker. Never a legitimate erasure path.
    f.sqlite.exec('DROP TRIGGER cloud_key_erasure_only');
    f.sqlite.prepare('DELETE FROM cloud_account_keys WHERE uid=?').run('owner-a');
    withdraw(f);
    await awaitKeys(f);
    await assert.rejects(finalize(f), /erasure-finalization-fenced/);
    assert.equal(job(f).status, 'processing');
    assert.equal(subject(f).consent_revision, 1);
    assert.equal(count(f, 'health_erasure_finalizations'), 0);
    assert.equal(count(f, 'cloud_key_issuance'), 1);
  }));

void test('an orphan wrapped key, mismatched generation or corrupted issuance timestamp cannot be finalized', () =>
  fixture(async f => {
    owner(f, 'owner-a');
    await provision(f);
    f.sqlite.exec('DROP TRIGGER cloud_key_issuance_immutable_update');
    f.sqlite.prepare("UPDATE cloud_key_issuance SET issued_at_ms=issued_at_ms+1 WHERE uid='owner-a'").run();
    withdraw(f);
    await awaitKeys(f);
    await assert.rejects(finalize(f), /erasure-finalization-fenced/);
    assert.equal(count(f, 'cloud_account_keys'), 1);
    assert.equal(count(f, 'health_erasure_finalizations'), 0);
  }));

void test('a leased job must be fully drained and must not allow an independent ADK DELETE', () =>
  fixture(async f => {
    owner(f, 'owner-a');
    await provision(f);
    await populate(f);
    withdraw(f);
    assert.throws(() => f.sqlite.prepare('DELETE FROM cloud_account_keys WHERE uid=?').run('owner-a'),
      /cloud-key-erasure-fenced/);
    const j = job(f);
    assert.equal(j.phase, 'data');
    // A crafted premature proof can never bypass a processing/awaiting-keys gate.
    assert.throws(() => f.sqlite.prepare(`INSERT INTO health_erasure_finalizations
      (uid,consent_revision,fence_epoch,lease_epoch,lease_token,
       completed_at_ms,erased_before_revision,sync_revision_at_erasure,
       key_disposition,key_issued_at_ms)
      VALUES ('owner-a',1,1,1,?,${NOW},2,2,'destroyed',?)`)
      .run('f'.repeat(64), Date.now()), /erasure-finalization-fenced/);
    assert.equal(count(f, 'sync_documents'), 1);
    assert.equal(count(f, 'cloud_account_keys'), 1);
    assert.equal(count(f, 'health_erasure_finalizations'), 0);
    assert.equal(job(f).status, 'pending');
  }));

void test('expired lease, stolen token, stale lease epoch, owner mismatch and zero-row insert cannot mean success', () =>
  fixture(async f => {
    owner(f, 'owner-a');
    await provision(f);
    withdraw(f);
    await awaitKeys(f);
    const valid = lease(f);
    assert.equal(await finalize(f, ['owner-b', ...valid.slice(1)]), null);
    assert.equal(await finalize(f, [valid[0], valid[1], valid[2], valid[3] + 1, valid[4]]), null);
    assert.equal(await finalize(f, [valid[0], valid[1], valid[2], valid[3], '0'.repeat(64)]), null);
    assert.equal(await finalize(f, [valid[0], 2, valid[2], valid[3], valid[4]]), null);
    expireLease(f);
    await assert.rejects(finalize(f, valid), /erasure-finalization-fenced/);
    assert.equal(count(f, 'health_erasure_finalizations'), 0);
    assert.equal(count(f, 'cloud_account_keys'), 1);
    assert.equal(job(f).status, 'processing');
    assert.equal(subject(f).fence_epoch, 1);
  }));

void test('a late SQL failure rolls back ADK deletion, terminal receipt and completed state', () =>
  fixture(async f => {
    owner(f, 'owner-a');
    await provision(f);
    withdraw(f);
    await awaitKeys(f);
    f.sqlite.exec(`CREATE TRIGGER fail_terminal_subject_update BEFORE UPDATE ON sync_subjects
      WHEN NEW.erased_before_revision > OLD.erased_before_revision
      BEGIN SELECT RAISE(ABORT, 'injected-finalization-failure'); END`);
    await assert.rejects(finalize(f), /injected-finalization-failure/);
    assert.equal(count(f, 'cloud_account_keys'), 1);
    assert.equal(count(f, 'cloud_key_issuance'), 1);
    assert.equal(count(f, 'health_erasure_finalizations'), 0);
    assert.equal(job(f).status, 'processing');
    assert.equal(job(f).completed_at_ms, null);
    assert.equal(subject(f).consent_revision, 1);
    f.sqlite.exec('DROP TRIGGER fail_terminal_subject_update');
    assert.equal((await finalize(f)).key_disposition, 'destroyed');
    verifyComplete(f, 'destroyed');
  }));

void test('loss of reply after commit is reconciled from immutable SQL proof, never from the network exception', () =>
  fixture(async f => {
    owner(f, 'owner-a');
    await provision(f);
    withdraw(f);
    await awaitKeys(f);
    const original = finalize(f);
    await assert.rejects(async () => {
      const committed = await original;
      assert.equal(committed.key_disposition, 'destroyed');
      throw new Error('synthetic-http-lost-ack-after-sql-commit');
    }, /synthetic-http-lost-ack-after-sql-commit/);
    const p = proof(f);
    assert.equal(p.key_disposition, 'destroyed');
    verifyComplete(f, 'destroyed');
    assert.equal(await finalize(f, lease(f)), null);
  }));

void test('simultaneous finalizers sharing a lease converge to exactly one immutable winner', () =>
  fixture(async f => {
    owner(f, 'owner-a');
    await provision(f);
    withdraw(f);
    await awaitKeys(f);
    const args = lease(f);
    const results = await Promise.allSettled([finalize(f, args), finalize(f, args, f.db2)]);
    assert.equal(results.filter(r => r.status === 'fulfilled' && r.value?.key_disposition === 'destroyed').length, 1);
    assert.equal(count(f, 'health_erasure_finalizations'), 1);
    verifyComplete(f, 'destroyed');
  }));

void test('completion cannot mutate another owner or their key, journal or consent fence', () =>
  fixture(async f => {
    owner(f, 'owner-a');
    owner(f, 'owner-b');
    await provision(f, 'owner-a');
    await provision(f, 'owner-b');
    await populate(f, 'owner-a');
    // B has its own encrypted content and must be entirely untouched.
    await populate(f, 'owner-b');
    withdraw(f, 'owner-a');
    await awaitKeys(f, 'owner-a');
    const bState = { ...subject(f, 'owner-b') };
    const bKey = { ...f.sqlite.prepare('SELECT * FROM cloud_account_keys WHERE uid=?').get('owner-b') };
    const bCount = ['sync_documents','sync_receipts','sync_replica_mutations','sync_replicas']
      .map(table => count(f, table, 'owner-b'));
    await finalize(f);
    assert.deepEqual({ ...subject(f, 'owner-b') }, bState);
    assert.deepEqual({ ...f.sqlite.prepare('SELECT * FROM cloud_account_keys WHERE uid=?').get('owner-b') }, bKey);
    assert.deepEqual(['sync_documents','sync_receipts','sync_replica_mutations','sync_replicas']
      .map(table => count(f, table, 'owner-b')), bCount);
    verifyComplete(f, 'destroyed', 'owner-a', 2);
  }));

void test('subject erasure bound cannot be advanced directly, resurrected or confused with sync revision', () =>
  fixture(async f => {
    owner(f, 'owner-a');
    await provision(f);
    withdraw(f);
    await awaitKeys(f);
    assert.throws(() => f.sqlite.prepare(
      "UPDATE sync_subjects SET erased_before_revision=2, consent_revision=2, fence_epoch=2 WHERE uid='owner-a'"
    ).run(), /erasure-subject-fenced/);
    assert.throws(() => f.sqlite.prepare(
      "UPDATE health_erasure_jobs SET status='complete' WHERE uid='owner-a'"
    ).run(), /erasure-progress-fenced/);
    await finalize(f);
    verifyComplete(f, 'destroyed');
    assert.throws(() => f.sqlite.prepare(
      "UPDATE sync_subjects SET status='active' WHERE uid='owner-a'"
    ).run(), /subject-fence-regression/);
  }));
