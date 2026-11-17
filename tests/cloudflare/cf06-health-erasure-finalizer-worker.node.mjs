import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { runOneHealthErasureStep } from '../../cloudflare/jobs/health-erasure-worker.mjs';
import { wrapCloudAccountDataKey } from '../../cloudflare/api/cloud-key-crypto.mjs';
import { releaseCloudAccountDataKey } from '../../cloudflare/api/cloud-key-store.mjs';

const files = readdirSync(new URL('../../cloudflare/api/migrations/', import.meta.url))
  .filter(name => /^[0-9]{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
const versions = files.map(name => name.slice(0, 4));
const KEK = Buffer.alloc(32, 23).toString('base64');

assert.ok(files.length >= 10, 'full erasure schema required');
assert.deepEqual(versions, Array.from({ length: files.length }, (_, i) => String(i + 1).padStart(4, '0')));
class Statement {
  constructor(sqlite, sql, args = []) { this.sqlite = sqlite; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.sqlite, this.sql, args); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() {
    const r = this.sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: r.changes } };
  }
}
class DB {
  constructor(sqlite) { this.sqlite = sqlite; }
  withSession(mode) { assert.equal(mode, 'first-primary'); return this; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
}
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of files) {
    sqlite.exec(readFileSync(new URL('../../cloudflare/api/migrations/' + file, import.meta.url), 'utf8'));
  }
  return { sqlite, db: new DB(sqlite) };
}
function row(f, table, uid = 'owner-a') {
  return f.sqlite.prepare('SELECT * FROM ' + table + ' WHERE uid=?').get(uid);
}
function count(f, table, uid = 'owner-a') {
  return f.sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table + ' WHERE uid=?').get(uid).n;
}
function owner(f, uid = 'owner-a') {
  const at = Date.now() - 20000;
  f.sqlite.prepare('INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch) VALUES (?, ?, ?, 1)')
    .run(uid, 'active', at);
  f.sqlite.prepare("INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,'active',1,1)").run(uid);
  f.sqlite.prepare('INSERT INTO sync_state(uid,revision) VALUES (?,0)').run(uid);
  f.sqlite.prepare('INSERT INTO health_consent_acceptances (uid,consent_revision,privacy_version,terms_version,accepted_at_ms,over_18_confirmed) VALUES (?,1,?,?,?,1)')
    .run(uid, '1.3.10', '1.2.5', at);
  const hash = uid === 'owner-a' ? 'a'.repeat(64) : 'b'.repeat(64);
  f.sqlite.prepare('INSERT INTO auth_sessions (token_hash,uid,auth_epoch,csrf_hash,issued_at_ms,idle_expires_at_ms,absolute_expires_at_ms) VALUES (?,?,1,?,?,?,?)')
    .run(hash, uid, 'c'.repeat(64), at, at + 3600000, at + 7200000);
  return hash;
}
async function provision(f, uid = 'owner-a') {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const sealed = await wrapCloudAccountDataKey(uid, key, KEK);
  key.fill(0);
  f.sqlite.prepare('INSERT INTO cloud_account_keys (uid,consent_revision,format,version,key_version,iv,ciphertext,tag,issued_at_ms) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(uid, 1, sealed.format, sealed.version, sealed.keyVersion, sealed.iv, sealed.ciphertext, sealed.tag, Date.now() - 1000);
}
function seedData(f) {
  f.sqlite.prepare('INSERT INTO sync_documents(uid,path,envelope_json,revision) VALUES (?,?,?,1)')
    .run('owner-a', '', JSON.stringify({ _sealed: { format: 'thelogbook-cloud-document',
      version: 1, nonce: 'A'.repeat(32), ciphertext: 'B'.repeat(48) } }));
  const now = Date.now();
  f.sqlite.prepare([
    'INSERT INTO sync_replica_mutations',
    '(uid,mutation_id,request_hash,action,expected_revision,committed_revision,consent_revision,fence_epoch,',
    'slot,replica_id,generation,last_seq,checkpoint_at_ms,lease_until_ms,checkpoint_clock_json)',
    "VALUES (?,?,?,'register',0,1,1,1,'s00','replica-a',1,0,?,?,?)",
  ].join(' ')).run('owner-a', 'm'.repeat(24), 'a'.repeat(64), now-1000, now+3600000, '{}');
  f.sqlite.prepare([
    'INSERT INTO sync_replicas',
    '(uid,slot,replica_id,generation,lease_until_ms,checkpoint_at_ms,checkpoint_clock_json,last_seq,status)',
    "VALUES (?,'s00','replica-a',1,?,?,?,0,'active')",
  ].join(' ')).run('owner-a', now+3600000, now-1000, '{}');
  f.sqlite.prepare("UPDATE sync_state SET revision=1 WHERE uid='owner-a'").run();
  f.sqlite.prepare([
    'INSERT INTO sync_receipts',
    '(uid,batch_id,request_hash,expected_revision,committed_revision,consent_revision,fence_epoch,',
    'slot,replica_id,generation,last_seq,document_count)',
    "VALUES (?,?,?,1,2,1,1,'s00','replica-a',1,1,1)",
  ].join(' ')).run('owner-a', 'batch-' + 'a'.repeat(20), 'b'.repeat(64));
}
function withdraw(f, uid = 'owner-a', requestedAt = Date.now() - 1000) {
  f.sqlite.prepare('INSERT INTO health_erasure_jobs (uid,consent_revision,fence_epoch,requested_at_ms) VALUES (?,1,1,?)')
    .run(uid, requestedAt);
}
function expire(f) {
  f.sqlite.prepare("UPDATE health_erasure_jobs SET lease_until_ms=? WHERE uid='owner-a'")
    .run(Date.now() - 60000);
}
async function awaitKeys(f) {
  for (let i = 0; i < 15; i += 1) {
    const step = await runOneHealthErasureStep(f.db);
    if (step.outcome === 'awaiting-keys') return;
    assert.equal(step.outcome, 'progress');
    expire(f);
  }
  assert.fail('data phase did not finish');
}
function verify(f, disposition) {
  const p = row(f, 'health_erasure_finalizations');
  const j = row(f, 'health_erasure_jobs');
  const s = row(f, 'sync_subjects');
  assert.equal(p.key_disposition, disposition);
  assert.equal(j.key_disposition, disposition);
  assert.equal(j.status, 'complete');
  assert.equal(p.completed_at_ms, j.completed_at_ms);
  assert.equal(p.erased_before_revision, 2);
  assert.equal(j.erased_before_revision, 2);
  assert.equal(s.status, 'withdrawn');
  assert.equal(s.consent_revision, 2);
  assert.equal(s.fence_epoch, 2);
  assert.equal(s.erased_before_revision, 2);
  assert.equal(p.sync_revision_at_erasure, row(f, 'sync_state').revision);
  for (const t of ['sync_documents','sync_receipts','sync_replica_mutations',
    'sync_replicas','cloud_account_keys']) assert.equal(count(f, t), 0, t);
  assert.equal(count(f, 'cloud_key_issuance'), disposition === 'destroyed' ? 1 : 0);
  assert.equal(count(f, 'auth_principals'), 1);
  assert.equal(count(f, 'auth_sessions'), 1);
}
void test('D runner fully drains four tables then atomically destroys ADK and records complete', async () => {
  const f = fixture();
  try {
    owner(f); await provision(f); seedData(f); withdraw(f);
    await awaitKeys(f);
    assert.equal(count(f, 'cloud_account_keys'), 1);
    assert.equal((await runOneHealthErasureStep(f.db)).outcome, 'idle');
    expire(f);
    assert.deepEqual(await runOneHealthErasureStep(f.db),
      { outcome: 'complete', keyDisposition: 'destroyed' });
    verify(f, 'destroyed');
    assert.equal((await runOneHealthErasureStep(f.db)).outcome, 'idle');
  } finally { f.sqlite.close(); }
});
void test('an older eligible key finalization is not starved by newer data jobs', async () => {
  const f = fixture();
  try {
    owner(f); await provision(f);
    withdraw(f, 'owner-a', Date.now() - 10000);
    await awaitKeys(f); expire(f);
    owner(f, 'owner-b'); await provision(f, 'owner-b');
    withdraw(f, 'owner-b');
    const otherKey = { ...row(f, 'cloud_account_keys', 'owner-b') };
    const otherJob = { ...row(f, 'health_erasure_jobs', 'owner-b') };

    assert.deepEqual(await runOneHealthErasureStep(f.db),
      { outcome: 'complete', keyDisposition: 'destroyed' });
    verify(f, 'destroyed');
    assert.deepEqual({ ...row(f, 'cloud_account_keys', 'owner-b') }, otherKey);
    assert.deepEqual({ ...row(f, 'health_erasure_jobs', 'owner-b') }, otherJob);
    assert.equal((await runOneHealthErasureStep(f.db)).outcome, 'awaiting-keys');
  } finally { f.sqlite.close(); }
});
void test('D runner distinguishes never issued from previously issued but missing key', async () => {
  for (const issued of [false, true]) {
    const f = fixture();
    try {
      owner(f);
      if (issued) {
        await provision(f);
        f.sqlite.exec('DROP TRIGGER cloud_key_erasure_only');
        f.sqlite.prepare("DELETE FROM cloud_account_keys WHERE uid='owner-a'").run();
      }
      withdraw(f); await awaitKeys(f); expire(f);
      if (issued) {
        await assert.rejects(runOneHealthErasureStep(f.db), /erasure-finalization-fenced/);
        assert.equal(row(f, 'health_erasure_jobs').status, 'processing');
        assert.equal(count(f, 'health_erasure_finalizations'), 0);
      } else {
        assert.deepEqual(await runOneHealthErasureStep(f.db),
          { outcome: 'complete', keyDisposition: 'never-issued' });
        verify(f, 'never-issued');
      }
    } finally { f.sqlite.close(); }
  }
});
void test('D runner blocks finalization when an unexpected document remains after key phase', async () => {
  const f = fixture();
  try {
    owner(f); await provision(f); withdraw(f); await awaitKeys(f);
    f.sqlite.exec('DROP TRIGGER sync_document_no_write_after_withdraw');
    f.sqlite.exec('DROP TRIGGER sync_document_insert_requires_cloud_key');
    f.sqlite.prepare('INSERT INTO sync_documents VALUES (?,?,?,1)').run('owner-a','history_months/2026-01','{}');
    expire(f);
    await assert.rejects(runOneHealthErasureStep(f.db), /erasure-finalization-fenced/);
    assert.equal(count(f, 'cloud_account_keys'), 1);
    assert.equal(count(f, 'health_erasure_finalizations'), 0);
  } finally { f.sqlite.close(); }
});
void test('D runner recovers committed finalization after lost ACK from fresh primary proof', async () => {
  const f = fixture();
  try {
    owner(f); await provision(f); withdraw(f); await awaitKeys(f); expire(f);
    const flaky = { withSession(mode) {
      const real = f.db.withSession(mode);
      return { prepare(sql) {
        const statement = real.prepare(sql);
        if (!sql.includes('INSERT INTO health_erasure_finalizations')) return statement;
        return { bind(...args) { return { async first() {
          assert.equal((await statement.bind(...args).first()).key_disposition, 'destroyed');
          throw Error('synthetic-finalize-ACK-lost');
        } }; } };
      } };
    } };
    assert.deepEqual(await runOneHealthErasureStep(flaky),
      { outcome: 'complete', keyDisposition: 'destroyed' });
    verify(f, 'destroyed');
  } finally { f.sqlite.close(); }
});
void test('D runner never reports success for null RETURNING or missing primary proof', async () => {
  for (const mode of ['null', 'unavailable-proof']) {
    const f = fixture();
    try {
      owner(f); await provision(f); withdraw(f); await awaitKeys(f); expire(f);
      const intercept = { withSession(kind) {
        const real = f.db.withSession(kind);
        return { prepare(sql) {
          const statement = real.prepare(sql);
          if (mode === 'null' && sql.includes('INSERT INTO health_erasure_finalizations')) {
            return { bind(...args) { return { async first() {
              await statement.bind(...args).first();
              return null;
            } }; } };
          }
          if (mode === 'unavailable-proof' && sql.includes('FROM health_erasure_finalizations f')) {
            return { bind() { return { async first() { return null; } }; } };
          }
          return statement;
        } };
      } };
      if (mode === 'null') {
        assert.equal((await runOneHealthErasureStep(intercept)).outcome, 'contended');
      } else {
        await assert.rejects(runOneHealthErasureStep(intercept), /erasure-terminal-proof-unproven/);
      }
      verify(f, 'destroyed');
    } finally { f.sqlite.close(); }
  }
});
void test('D runner isolates other owner and tolerates competing finalizer attempts', async () => {
  const f = fixture();
  try {
    owner(f, 'owner-a'); owner(f, 'owner-b');
    await provision(f, 'owner-a'); await provision(f, 'owner-b');
    withdraw(f); await awaitKeys(f); expire(f);
    const foreignKey = { ...row(f, 'cloud_account_keys', 'owner-b') };
    const attempts = await Promise.allSettled([
      runOneHealthErasureStep(f.db), runOneHealthErasureStep(f.db),
    ]);
    assert.equal(attempts.filter(v => v.status === 'fulfilled'
      && v.value.outcome === 'complete').length, 1);
    verify(f, 'destroyed');
    assert.deepEqual({ ...row(f, 'cloud_account_keys', 'owner-b') }, foreignKey);
    assert.equal(row(f, 'sync_subjects', 'owner-b').status, 'active');
    assert.equal(count(f, 'health_erasure_finalizations', 'owner-b'), 0);
  } finally { f.sqlite.close(); }
});
void test('D runner preserves ADK and retries after quota exhaustion or lease expiry at final INSERT', async () => {
  for (const mode of ['quota', 'lease-expired']) {
    const f = fixture();
    try {
      owner(f); await provision(f); withdraw(f); await awaitKeys(f); expire(f);
      const blocked = { withSession(kind) {
        const real = f.db.withSession(kind);
        return { prepare(sql) {
          const statement = real.prepare(sql);
          if (!sql.includes('INSERT INTO health_erasure_finalizations')) return statement;
          return { bind(...args) { return { async first() {
            if (mode === 'quota') throw Error('synthetic D1 quota exhausted');
            f.sqlite.prepare("UPDATE health_erasure_jobs SET lease_until_ms=? WHERE uid='owner-a'")
              .run(Date.now() - 60000);
            return statement.bind(...args).first();
          } }; } };
        } };
      } };
      await assert.rejects(runOneHealthErasureStep(blocked),
        mode === 'quota' ? /D1 quota exhausted/ : /erasure-finalization-fenced/);
      assert.equal(count(f, 'cloud_account_keys'), 1);
      assert.equal(count(f, 'health_erasure_finalizations'), 0);
      assert.equal(row(f, 'health_erasure_jobs').status, 'processing');
      assert.equal(row(f, 'sync_subjects').erased_before_revision, 0);
      expire(f);
      assert.deepEqual(await runOneHealthErasureStep(f.db),
        { outcome: 'complete', keyDisposition: 'destroyed' });
      verify(f, 'destroyed');
    } finally { f.sqlite.close(); }
  }
});
void test('D-01 rights-only ADK read delayed through finalization is rejected', async () => {
  const f = fixture();
  try {
    const hash = owner(f);
    await provision(f); withdraw(f); await awaitKeys(f); expire(f);
    let reads = 0;
    const intercepted = { withSession(mode) {
      const real = f.db.withSession(mode);
      return { prepare(sql) {
        const stmt = real.prepare(sql);
        if (!sql.startsWith('SELECT k.uid AS key_uid')) return stmt;
        return { bind(...args) { return { async first() {
          reads += 1;
          if (reads === 2) assert.equal((await runOneHealthErasureStep(f.db)).outcome, 'complete');
          return stmt.bind(...args).first();
        } }; } };
      } };
    } };
    await assert.rejects(releaseCloudAccountDataKey(intercepted,
      { CLOUD_ACCOUNT_KEK_V1: KEK, CONSENT_PRIVACY_VERSION: '1.3.10',
        CONSENT_TERMS_VERSION: '1.2.5' },
      { uid: 'owner-a', authenticated: true, emailVerified: true,
        rateGatePassed: true, csrfVerified: true, fenceEpoch: 1,
        healthConsentRevision: 1, sessionHash: hash }, 'rights-export'),
    /cloud-account-key-unavailable/);
    assert.equal(reads, 2);
    verify(f, 'destroyed');
  } finally { f.sqlite.close(); }
});
