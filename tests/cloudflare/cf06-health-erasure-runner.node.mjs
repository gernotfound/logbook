import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { applyCurrentD1RecoverySchema } from './current-d1-schema.mjs';
import erasureWorker, { acquireOneHealthErasureKeyPhaseLease, runOneHealthErasureStep } from '../../cloudflare/jobs/health-erasure-worker.mjs';
import { wrapCloudAccountDataKey } from '../../cloudflare/api/cloud-key-crypto.mjs';
import {
  armIndependentHealthWithdrawal, enrollIndependentOwner, recordVerifiedInitialConsent,
} from '../../cloudflare/recovery/independent-owner-fence.mjs';

const SQL_FILES = readdirSync(new URL('../../cloudflare/api/migrations/', import.meta.url))
  .filter(name => /^[0-9]{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
assert.ok(SQL_FILES.length >= 10, 'full erasure schema required');
assert.deepEqual(SQL_FILES.map(name => name.slice(0, 4)),
  Array.from({ length: SQL_FILES.length }, (_, i) => String(i + 1).padStart(4, '0')));

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
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of SQL_FILES) {
    sqlite.exec(readFileSync(new URL('../../cloudflare/api/migrations/' + name, import.meta.url), 'utf8'));
  }
  return { sqlite, db: new D1Sqlite(sqlite) };
}
function owner(f, uid) {
  f.sqlite.prepare(`INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch)
    VALUES (?,'active',?,1)`).run(uid, Date.now() - 20_000);
  f.sqlite.prepare('INSERT INTO sync_subjects (uid,status,consent_revision,fence_epoch) VALUES (?,\'active\',1,1)').run(uid);
  f.sqlite.prepare('INSERT INTO sync_state (uid,revision) VALUES (?,0)').run(uid);
  f.sqlite.prepare(`INSERT INTO health_consent_acceptances
    (uid,consent_revision,privacy_version,terms_version,accepted_at_ms,over_18_confirmed)
    VALUES (?,1,'1.3.9','1.2.5',?,1)`).run(uid, Date.now() - 10_000);
}
function insertDocuments(f, uid, count) {
  for (let i = 0; i < count; i += 1) {
    const path = i === 0 ? '' : 'history_months/2026-' + String(i).padStart(2, '0');
    f.sqlite.prepare('INSERT INTO sync_documents (uid,path,envelope_json,revision) VALUES (?,?,?,1)')
      .run(uid, path, '{"_sealed":"ciphertext-only"}');
  }
}
function seedReplicaHistory(f, uid) {
  const now = Date.now();
  const registration = [
    'INSERT INTO sync_replica_mutations',
    '(uid, mutation_id, request_hash, action, expected_revision, committed_revision,',
    ' consent_revision, fence_epoch, slot, replica_id, generation, last_seq,',
    ' checkpoint_at_ms, lease_until_ms, checkpoint_clock_json)',
    "VALUES (?,? ,?,'register',0,1,1,1,'s00','replica-a',1,0,?,?,?)",
  ].join(' ');
  f.sqlite.prepare(registration).run(uid, 'm'.repeat(24), 'a'.repeat(64),
    now - 1000, now + 3600000, '{}');
  f.sqlite.prepare(`INSERT INTO sync_replicas
    (uid,slot,replica_id,generation,lease_until_ms,checkpoint_at_ms,
      checkpoint_clock_json,last_seq,status)
    VALUES (?,'s00','replica-a',1,?,?,?,0,'active')`)
    .run(uid, now + 3600000, now - 1000, '{}');
  f.sqlite.prepare('UPDATE sync_state SET revision=1 WHERE uid=?').run(uid);
  f.sqlite.prepare(`INSERT INTO sync_receipts
    (uid,batch_id,request_hash,expected_revision,committed_revision,
      consent_revision,fence_epoch,slot,replica_id,generation,last_seq,document_count)
    VALUES (?,?,?,1,2,1,1,'s00','replica-a',1,1,1)`)
    .run(uid, 'batch-' + 'a'.repeat(20), 'b'.repeat(64));
}
function withdraw(f, uid, requestedAt = Date.now() - 1000) {
  f.sqlite.prepare(`INSERT INTO health_erasure_jobs
    (uid,consent_revision,fence_epoch,requested_at_ms,status)
    VALUES (?,1,1,?,'pending')`).run(uid, requestedAt);
  assert.equal(f.sqlite.prepare('SELECT status FROM sync_subjects WHERE uid=?').get(uid).status, 'withdrawn');
}
function count(f, table, uid) {
  return f.sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table + ' WHERE uid=?').get(uid).n;
}
function expire(f, uid) {
  f.sqlite.prepare('UPDATE health_erasure_jobs SET lease_until_ms=? WHERE uid=?')
    .run(Date.now() - 60_000, uid);
}
function job(f, uid) {
  return f.sqlite.prepare('SELECT * FROM health_erasure_jobs WHERE uid=?').get(uid);
}

const SYNTHETIC_KEK = Buffer.alloc(32, 71).toString('base64');

async function ownerWithWrappedKey(f, uid) {
  owner(f, uid);
  const adk = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await wrapCloudAccountDataKey(uid, adk, SYNTHETIC_KEK);
  adk.fill(0);
  f.sqlite.prepare(`INSERT INTO cloud_account_keys
    (uid,consent_revision,format,version,key_version,iv,ciphertext,tag,issued_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(uid, 1, wrapped.format, wrapped.version,
    wrapped.keyVersion, wrapped.iv, wrapped.ciphertext, wrapped.tag, Date.now() - 1_000);
  assert.equal(count(f, 'cloud_key_issuance', uid), 1);
}

async function drainDataToKeyPhase(f, uid) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const result = await runOneHealthErasureStep(f.db);
    if (result.outcome === 'awaiting-keys') return;
    assert.equal(result.outcome, 'progress');
    expire(f, uid);
  }
  assert.fail('bounded runner did not reach awaiting-keys');
}

void test('bounded data steps drain known replica tables and preserve keys until terminal proof', async () => {
  const f = fixture();
  try {
    await ownerWithWrappedKey(f, 'owner-a');
    insertDocuments(f, 'owner-a', 7);
    seedReplicaHistory(f, 'owner-a');
    withdraw(f, 'owner-a');
    const seen = [];
    for (let i = 0; i < 12; i += 1) {
      const step = await runOneHealthErasureStep(f.db);
      seen.push(step);
      if (step.outcome === 'awaiting-keys') break;
      assert.equal(step.outcome, 'progress');
      assert.ok(step.removed >= 1 && step.removed <= 4);
      expire(f, 'owner-a');
    }
    assert.deepEqual(seen.filter(s => s.outcome === 'progress').map(s => [s.table, s.removed]), [
      ['sync_documents', 4], ['sync_documents', 3],
      ['sync_receipts', 1], ['sync_replica_mutations', 1], ['sync_replicas', 1],
    ]);
    assert.equal(seen.at(-1).outcome, 'awaiting-keys');
    for (const table of ['sync_documents','sync_receipts','sync_replica_mutations','sync_replicas']) {
      assert.equal(count(f, table, 'owner-a'), 0);
    }
    assert.equal(job(f, 'owner-a').status, 'processing');
    assert.equal(job(f, 'owner-a').phase, 'awaiting-keys');
    assert.equal(count(f, 'health_consent_acceptances', 'owner-a'), 1);
    assert.equal(count(f, 'sync_state', 'owner-a'), 1);
    assert.equal((await runOneHealthErasureStep(f.db)).outcome, 'idle');
    assert.throws(() => f.sqlite.exec("UPDATE health_erasure_jobs SET status='complete'"));
  } finally { f.sqlite.close(); }
});

void test('simultaneous workers cannot both acquire one lease and double-delete a batch', async () => {
  const f = fixture();
  try {
    await ownerWithWrappedKey(f, 'owner-a');
    insertDocuments(f, 'owner-a', 7);
    withdraw(f, 'owner-a');
    const results = await Promise.all([
      runOneHealthErasureStep(f.db), runOneHealthErasureStep(f.db),
    ]);
    assert.deepEqual(results.map(x => x.outcome).sort(), ['contended', 'progress']);
    assert.equal(count(f, 'sync_documents', 'owner-a'), 3);
    assert.equal(job(f, 'owner-a').lease_epoch, 1);
    assert.equal(job(f, 'owner-a').status, 'processing');
    assert.equal((await runOneHealthErasureStep(f.db)).outcome, 'idle');
  } finally { f.sqlite.close(); }
});

void test('a stolen lease blocks the old worker even when it had already selected the owner', async () => {
  const f = fixture();
  try {
    await ownerWithWrappedKey(f, 'owner-a');
    insertDocuments(f, 'owner-a', 3);
    withdraw(f, 'owner-a');
    const db = {
      withSession: mode => {
        const actual = f.db.withSession(mode);
        return {
          prepare(sql) {
            if (!sql.startsWith('DELETE FROM sync_documents')) return actual.prepare(sql);
            const statement = actual.prepare(sql);
            return {
              bind(...args) {
                return {
                  async run() {
                    f.sqlite.prepare(`UPDATE health_erasure_jobs
                      SET lease_epoch=lease_epoch+1, lease_token=?,
                          lease_until_ms=?
                      WHERE uid='owner-a'`).run('b'.repeat(64), Date.now() + 30000);
                    return statement.bind(...args).run();
                  },
                };
              },
            };
          },
        };
      },
    };
    const result = await runOneHealthErasureStep(db);
    assert.equal(result.outcome, 'contended');
    assert.equal(count(f, 'sync_documents', 'owner-a'), 3);
    assert.equal(job(f, 'owner-a').lease_epoch, 2);
  } finally { f.sqlite.close(); }
});

void test('a lost DELETE acknowledgement never returns success and retries from durable remaining rows', async () => {
  const f = fixture();
  try {
    await ownerWithWrappedKey(f, 'owner-a');
    insertDocuments(f, 'owner-a', 6);
    withdraw(f, 'owner-a');
    let lost = false;
    const flaky = {
      withSession(mode) {
        const actual = f.db.withSession(mode);
        return {
          prepare(sql) {
            const statement = actual.prepare(sql);
            if (!sql.startsWith('DELETE FROM sync_documents')) return statement;
            return { bind(...args) { return { async run() {
              const result = await statement.bind(...args).run();
              if (!lost) { lost = true; throw Error('synthetic lost ACK'); }
              return result;
            } }; } };
          },
        };
      },
    };
    await assert.rejects(runOneHealthErasureStep(flaky), /synthetic lost ACK/);
    assert.equal(lost, true);
    assert.equal(count(f, 'sync_documents', 'owner-a'), 2);
    assert.equal(job(f, 'owner-a').phase, 'data');
    expire(f, 'owner-a');
    const retry = await runOneHealthErasureStep(f.db);
    assert.equal(retry.outcome, 'progress');
    assert.equal(retry.removed, 2);
    assert.equal(count(f, 'sync_documents', 'owner-a'), 0);
    assert.equal(job(f, 'owner-a').status, 'processing');
  } finally { f.sqlite.close(); }
});

void test('owner isolation and oldest eligible job selection preserve other users', async () => {
  const f = fixture();
  try {
    await ownerWithWrappedKey(f, 'owner-a');
    await ownerWithWrappedKey(f, 'owner-b');
    insertDocuments(f, 'owner-a', 3);
    insertDocuments(f, 'owner-b', 2);
    withdraw(f, 'owner-a');
    // User B has no withdrawal and must remain fully readable.
    const result = await runOneHealthErasureStep(f.db);
    assert.equal(result.outcome, 'progress');
    assert.equal(count(f, 'sync_documents', 'owner-a'), 0);
    assert.equal(count(f, 'sync_documents', 'owner-b'), 2);
    assert.equal(f.sqlite.prepare("SELECT status FROM sync_subjects WHERE uid='owner-b'").get().status, 'active');
    assert.equal(count(f, 'health_erasure_jobs', 'owner-b'), 0);
  } finally { f.sqlite.close(); }
});

void test('direct writes and premature reacceptance cannot resurrect a withdrawn owner', async () => {
  const f = fixture();
  try {
    await ownerWithWrappedKey(f, 'owner-a');
    insertDocuments(f, 'owner-a', 1);
    withdraw(f, 'owner-a');
    // Both the withdrawal trigger and the ADK grant fence reject this write.
    // SQLite does not promise which BEFORE trigger reports the denial first.
    const documentDenied = /withdrawn-document-write|replica-cloud-key-required/;
    assert.throws(() => insertDocuments(f, 'owner-a', 2), documentDenied);
    assert.throws(() => f.sqlite.prepare(`UPDATE sync_documents SET envelope_json='{}' WHERE uid='owner-a'`).run(),
      documentDenied);
    assert.throws(() => f.sqlite.prepare(`INSERT INTO sync_replicas
      (uid,slot,replica_id,generation,lease_until_ms,checkpoint_at_ms,checkpoint_clock_json,last_seq,status)
      VALUES ('owner-a','s00','illegal',1,9999999999999,1,'{}',0,'active')`).run(),
    /withdrawn-replica-write|replica-cloud-key-required/);
    assert.throws(() => f.sqlite.prepare(`UPDATE sync_subjects
      SET status='active', consent_revision=2, fence_epoch=2
      WHERE uid='owner-a'`).run(), /erasure-not-complete/);
    assert.equal(count(f, 'sync_documents', 'owner-a'), 1);
    assert.equal(count(f, 'cloud_account_keys', 'owner-a'), 1);
    assert.equal(count(f, 'sync_replicas', 'owner-a'), 0);
    assert.equal(job(f, 'owner-a').status, 'pending');
  } finally { f.sqlite.close(); }
});

void test('moving to the key phase requires all known data gone and does not bypass a lease', async () => {
  const f = fixture();
  try {
    await ownerWithWrappedKey(f, 'owner-a');
    insertDocuments(f, 'owner-a', 2);
    withdraw(f, 'owner-a');
    assert.throws(() => f.sqlite.prepare(`UPDATE health_erasure_jobs SET
      status='processing', lease_epoch=1, lease_token=?, phase='awaiting-keys'
      WHERE uid='owner-a'`).run('f'.repeat(64)), /erasure-progress-fenced/);
    const initial = await runOneHealthErasureStep(f.db);
    assert.equal(initial.outcome, 'progress');
    assert.equal(job(f, 'owner-a').phase, 'data');
    assert.equal((await runOneHealthErasureStep(f.db)).outcome, 'idle');
    expire(f, 'owner-a');
    assert.equal((await runOneHealthErasureStep(f.db)).outcome, 'awaiting-keys');
  } finally { f.sqlite.close(); }
});

void test('missing D1 schema and failed provider writes never claim deletion success', async () => {
  await assert.rejects(runOneHealthErasureStep({}), /erasure-db-unavailable/);
  const f = fixture();
  try {
    await ownerWithWrappedKey(f, 'owner-a');
    insertDocuments(f, 'owner-a', 1);
    withdraw(f, 'owner-a');
    const blocked = {
      withSession(mode) {
        const d = f.db.withSession(mode);
        return { prepare(sql) {
          if (sql.startsWith('UPDATE health_erasure_jobs SET')) return {
            bind() { return { async first() { throw Error('D1 quota exhausted'); } }; },
          };
          return d.prepare(sql);
        } };
      },
    };
    await assert.rejects(runOneHealthErasureStep(blocked), /D1 quota exhausted/);
    assert.equal(count(f, 'sync_documents', 'owner-a'), 1);
    assert.equal(job(f, 'owner-a').status, 'pending');
    assert.equal(job(f, 'owner-a').lease_epoch, 0);
  } finally { f.sqlite.close(); }
});

void test('awaiting-keys reacquires the exact leased generation without deleting the ADK', async () => {
  const f = fixture();
  try {
    await ownerWithWrappedKey(f, 'owner-a');
    await ownerWithWrappedKey(f, 'owner-b');
    insertDocuments(f, 'owner-a', 7);
    withdraw(f, 'owner-a');
    await drainDataToKeyPhase(f, 'owner-a');
    assert.equal((await acquireOneHealthErasureKeyPhaseLease(f.db)).outcome, 'idle');
    expire(f, 'owner-a');
    const initialEpoch = job(f, 'owner-a').lease_epoch;
    const first = await acquireOneHealthErasureKeyPhaseLease(f.db);
    assert.equal(first.outcome, 'leased');
    assert.equal(first.uid, 'owner-a');
    assert.equal(first.consentRevision, 1);
    assert.equal(first.fenceEpoch, 1);
    assert.equal(first.leaseEpoch, initialEpoch + 1);
    assert.match(first.leaseToken, /^[0-9a-f]{64}$/);
    assert.equal(first.leaseUntilMs, job(f, 'owner-a').lease_until_ms);
    assert.equal(first.leaseToken, job(f, 'owner-a').lease_token);
    assert.equal(job(f, 'owner-a').status, 'processing');
    assert.equal(job(f, 'owner-a').phase, 'awaiting-keys');
    for (const uid of ['owner-a', 'owner-b']) {
      assert.equal(count(f, 'cloud_account_keys', uid), 1);
      assert.equal(count(f, 'cloud_key_issuance', uid), 1);
    }
    assert.throws(() => f.sqlite.exec("UPDATE health_erasure_jobs SET status='complete'"),
      /erasure-progress-fenced/);
    assert.equal((await acquireOneHealthErasureKeyPhaseLease(f.db)).outcome, 'idle');
    expire(f, 'owner-a');
    const second = await acquireOneHealthErasureKeyPhaseLease(f.db);
    assert.equal(second.outcome, 'leased');
    assert.equal(second.leaseEpoch, first.leaseEpoch + 1);
    assert.notEqual(second.leaseToken, first.leaseToken);
    assert.equal(count(f, 'cloud_account_keys', 'owner-a'), 1);
    assert.equal(job(f, 'owner-a').status, 'processing');
    assert.equal((await runOneHealthErasureStep(f.db)).outcome, 'idle');
  } finally { f.sqlite.close(); }
});

void test('concurrent key-phase lease claims have at most one winner', async () => {
  const f = fixture();
  try {
    await ownerWithWrappedKey(f, 'owner-a');
    withdraw(f, 'owner-a');
    await drainDataToKeyPhase(f, 'owner-a');
    expire(f, 'owner-a');
    const results = await Promise.all([
      acquireOneHealthErasureKeyPhaseLease(f.db),
      acquireOneHealthErasureKeyPhaseLease(f.db),
    ]);
    assert.equal(results.filter(result => result.outcome === 'leased').length, 1);
    assert.ok(results.some(result => result.outcome === 'idle' || result.outcome === 'contended'));
    assert.equal(count(f, 'cloud_account_keys', 'owner-a'), 1);
    assert.equal(count(f, 'cloud_key_issuance', 'owner-a'), 1);
    assert.equal(job(f, 'owner-a').status, 'processing');
  } finally { f.sqlite.close(); }
});

void test('ambiguous key-phase lease ACK fails closed and can resume only after expiration', async () => {
  const f = fixture();
  try {
    await ownerWithWrappedKey(f, 'owner-a');
    withdraw(f, 'owner-a');
    await drainDataToKeyPhase(f, 'owner-a');
    expire(f, 'owner-a');
    let lost = false;
    const flaky = {
      withSession(mode) {
        const real = f.db.withSession(mode);
        return { prepare(sql) {
          const statement = real.prepare(sql);
          if (!sql.startsWith('UPDATE health_erasure_jobs SET')) return statement;
          return { bind(...args) { return { async first() {
            const result = await statement.bind(...args).first();
            if (!lost) { lost = true; throw new Error('synthetic lease ACK lost'); }
            return result;
          } }; } };
        } };
      },
    };
    await assert.rejects(acquireOneHealthErasureKeyPhaseLease(flaky),
      /synthetic lease ACK lost/);
    assert.equal(lost, true);
    assert.equal(job(f, 'owner-a').phase, 'awaiting-keys');
    assert.equal(job(f, 'owner-a').status, 'processing');
    assert.equal(count(f, 'cloud_account_keys', 'owner-a'), 1);
    assert.equal((await acquireOneHealthErasureKeyPhaseLease(f.db)).outcome, 'idle');
    expire(f, 'owner-a');
    assert.equal((await acquireOneHealthErasureKeyPhaseLease(f.db)).outcome, 'leased');
    assert.equal(count(f, 'cloud_account_keys', 'owner-a'), 1);
  } finally { f.sqlite.close(); }
});

void test('withdrawn owner and consent epoch must still match before key-phase lease', async () => {
  for (const mutation of [
    "UPDATE sync_subjects SET status='deleting' WHERE uid='owner-a'",
    "UPDATE sync_subjects SET fence_epoch=fence_epoch+1 WHERE uid='owner-a'",
  ]) {
    const f = fixture();
    try {
      await ownerWithWrappedKey(f, 'owner-a');
      withdraw(f, 'owner-a');
      await drainDataToKeyPhase(f, 'owner-a');
      expire(f, 'owner-a');
      f.sqlite.prepare(mutation).run();
      assert.equal((await acquireOneHealthErasureKeyPhaseLease(f.db)).outcome, 'idle');
      assert.equal(count(f, 'cloud_account_keys', 'owner-a'), 1);
      assert.equal(job(f, 'owner-a').status, 'processing');
    } finally { f.sqlite.close(); }
  }
});

void test('a changed consent epoch between SELECT and lease claim prevents acquisition', async () => {
  const f = fixture();
  try {
    await ownerWithWrappedKey(f, 'owner-a');
    withdraw(f, 'owner-a');
    await drainDataToKeyPhase(f, 'owner-a');
    expire(f, 'owner-a');
    const previousLeaseEpoch = job(f, 'owner-a').lease_epoch;
    let raced = false;
    const racingDb = {
      withSession(mode) {
        const primary = f.db.withSession(mode);
        return { prepare(sql) {
          const statement = primary.prepare(sql);
          if (!sql.startsWith('UPDATE health_erasure_jobs SET')) return statement;
          return { bind(...args) { return { async first() {
            if (!raced) {
              raced = true;
              f.sqlite.prepare("UPDATE sync_subjects SET fence_epoch=2 WHERE uid='owner-a'").run();
            }
            return statement.bind(...args).first();
          } }; } };
        } };
      },
    };
    assert.equal((await acquireOneHealthErasureKeyPhaseLease(racingDb)).outcome, 'contended');
    assert.equal(raced, true);
    assert.equal(job(f, 'owner-a').lease_epoch, previousLeaseEpoch);
    assert.equal(count(f, 'cloud_account_keys', 'owner-a'), 1);
    assert.equal(job(f, 'owner-a').status, 'processing');
  } finally { f.sqlite.close(); }
});

void test('keyless never-issued and missing-issued-key jobs remain incomplete, distinct and recoverable', async () => {
  for (const issued of [false, true]) {
    const f = fixture();
    try {
      owner(f, 'owner-a');
      if (issued) {
        f.sqlite.prepare('INSERT INTO cloud_key_issuance(uid,consent_revision,issued_at_ms) VALUES (?,1,?)')
          .run('owner-a', Date.now() - 1000);
      }
      withdraw(f, 'owner-a');
      await drainDataToKeyPhase(f, 'owner-a');
      expire(f, 'owner-a');
      const lease = await acquireOneHealthErasureKeyPhaseLease(f.db);
      assert.equal(lease.outcome, 'leased');
      assert.equal(count(f, 'cloud_account_keys', 'owner-a'), 0);
      assert.equal(count(f, 'cloud_key_issuance', 'owner-a'), issued ? 1 : 0);
      assert.equal(job(f, 'owner-a').status, 'processing');
      assert.throws(() => f.sqlite.exec("UPDATE health_erasure_jobs SET status='complete'"),
        /erasure-progress-fenced/);
    } finally { f.sqlite.close(); }
  }
});

void test('job selection starts from the runnable index even with unrelated subjects and a key-only scan', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 128; i += 1) owner(f, 'unrelated-' + i);
    owner(f, 'owner-key');
    withdraw(f, 'owner-key');
    assert.deepEqual(await runOneHealthErasureStep(f.db), { outcome: 'awaiting-keys' });
    expire(f, 'owner-key');
    owner(f, 'owner-data');
    withdraw(f, 'owner-data', Date.now() - 2000);
    const plans = [];
    const db = { withSession(mode) {
      const primary = f.db.withSession(mode);
      return { prepare(sql) {
        const statement = primary.prepare(sql);
        if (!sql.includes('ORDER BY MAX(j.requested_at_ms, j.lease_until_ms)')) return statement;
        return { bind(...args) {
          plans.push(f.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args).map(row => row.detail));
          return statement.bind(...args);
        } };
      } };
    } };
    const key = await acquireOneHealthErasureKeyPhaseLease(db);
    assert.equal(key.outcome, 'leased');
    assert.equal(key.uid, 'owner-key');
    assert.equal(job(f, 'owner-data').lease_epoch, 0);
    assert.deepEqual(await runOneHealthErasureStep(db), { outcome: 'awaiting-keys' });
    assert.equal(job(f, 'owner-data').lease_epoch, 1);
    assert.equal(plans.length, 2);
    for (const plan of plans) {
      assert.ok(plan.some(line => /SEARCH j USING INDEX health_erasure_runnable .*lease_until_ms/.test(line)),
        JSON.stringify(plan));
      assert.ok(!plan.some(line => /SCAN s(?:\s|$)/.test(line)), JSON.stringify(plan));
    }
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sync_subjects WHERE status='active'").get().n, 128);
  } finally { f.sqlite.close(); }
});

void test('an expired failed owner yields to waiting owners and retries without losing its request', async () => {
  const f = fixture();
  const registry = new DatabaseSync(':memory:');
  const clock = new DatabaseSync(':memory:');
  try {
    applyCurrentD1RecoverySchema(registry);
    registry.exec("UPDATE recovery_control SET mode='open', generation=2 WHERE singleton=1");
    const recovery = new D1Sqlite(registry);
    for (const uid of ['owner-a', 'owner-b']) {
      await ownerWithWrappedKey(f, uid);
      insertDocuments(f, uid, 5);
      await enrollIndependentOwner(recovery, uid);
      await armIndependentHealthWithdrawal(recovery,
        await recordVerifiedInitialConsent(f.db, recovery, uid));
    }
    let now = Date.now() + 1000;
    const time = clock.prepare('SELECT strftime(?, ?) AS value');
    f.sqlite.function('strftime', (format, date) =>
      time.get(format, date === 'now' ? new Date(now).toISOString() : date).value);
    withdraw(f, 'owner-a', now - 2000);
    withdraw(f, 'owner-b', now - 1000);
    f.sqlite.exec(`CREATE TRIGGER synthetic_owner_failure BEFORE DELETE ON sync_documents
      WHEN OLD.uid = 'owner-a'
      BEGIN SELECT RAISE(ABORT, 'synthetic-owner-failure'); END`);
    const env = { DB: f.db, RECOVERY_DB: recovery, CF06_ERASURE_RUN_ENABLED: 'enabled', CF06_RECOVERY_GENERATION: '2' };
    const tick = () => erasureWorker.scheduled({}, env);
    await assert.rejects(tick(), /synthetic-owner-failure/);
    assert.equal(job(f, 'owner-a').lease_epoch, 1);
    assert.equal(count(f, 'sync_documents', 'owner-a'), 5);
    const firstExpiry = job(f, 'owner-a').lease_until_ms;

    // Move the SQL clock, not the stored lease, past its real deadline.
    // Both jobs are eligible; original-request ordering would pick A again.
    now = firstExpiry;
    assert.deepEqual(await tick(), { outcome: 'progress', phase: 'data', removed: 4, table: 'sync_documents' });
    assert.equal(count(f, 'sync_documents', 'owner-b'), 1);
    assert.equal(job(f, 'owner-a').lease_epoch, 1);
    now = job(f, 'owner-b').lease_until_ms;
    await assert.rejects(tick(), /synthetic-owner-failure/);
    assert.equal(job(f, 'owner-a').lease_epoch, 2);
    now = job(f, 'owner-a').lease_until_ms;
    assert.deepEqual(await tick(), { outcome: 'progress', phase: 'data', removed: 1, table: 'sync_documents' });
    assert.equal(count(f, 'sync_documents', 'owner-b'), 0);
    assert.equal(count(f, 'sync_documents', 'owner-a'), 5);

    f.sqlite.exec('DROP TRIGGER synthetic_owner_failure');
    now = job(f, 'owner-b').lease_until_ms;
    assert.deepEqual(await tick(), { outcome: 'progress', phase: 'data', removed: 4, table: 'sync_documents' });
    assert.equal(count(f, 'sync_documents', 'owner-a'), 1);
    assert.equal(job(f, 'owner-a').lease_epoch, 3);
    for (const uid of ['owner-a', 'owner-b']) {
      assert.equal(count(f, 'cloud_account_keys', uid), 1);
      assert.equal(count(f, 'health_erasure_finalizations', uid), 0);
      assert.equal(job(f, uid).status, 'processing');
    }
  } finally { clock.close(); registry.close(); f.sqlite.close(); }
});

void test('a failed reserved cutoff retry does not block another independently fenced health job', async () => {
  const f = fixture();
  const registry = new DatabaseSync(':memory:');
  const clock = new DatabaseSync(':memory:');
  try {
    applyCurrentD1RecoverySchema(registry);
    registry.exec("UPDATE recovery_control SET mode='open', generation=2 WHERE singleton=1");
    const recovery = new D1Sqlite(registry);
    const env = { DB: f.db, RECOVERY_DB: recovery, CF06_ERASURE_RUN_ENABLED: 'enabled', CF06_RECOVERY_GENERATION: '2' };
    const tick = () => erasureWorker.scheduled({}, env);
    await ownerWithWrappedKey(f, 'owner-a');
    await enrollIndependentOwner(recovery, 'owner-a');
    await armIndependentHealthWithdrawal(recovery,
      await recordVerifiedInitialConsent(f.db, recovery, 'owner-a'));
    withdraw(f, 'owner-a');
    assert.deepEqual(await tick(), { outcome: 'awaiting-keys' });
    expire(f, 'owner-a');
    registry.exec(`CREATE TRIGGER synthetic_terminal_failure BEFORE UPDATE ON recovery_owner_fences
      WHEN OLD.uid = 'owner-a' AND NEW.erased_before_revision > 0
      BEGIN SELECT RAISE(ABORT, 'synthetic-terminal-failure'); END`);
    await assert.rejects(tick(), /independent-recovery-fence-unavailable/);
    assert.equal(count(f, 'health_erasure_finalizations', 'owner-a'), 1);
    assert.equal(count(f, 'cloud_account_keys', 'owner-a'), 0);
    const cutoff = () => registry.prepare("SELECT finalized, next_check_ms FROM recovery_erasure_cutoffs WHERE uid='owner-a'").get();
    assert.equal(cutoff().finalized, 0);

    await ownerWithWrappedKey(f, 'owner-b');
    insertDocuments(f, 'owner-b', 5);
    await enrollIndependentOwner(recovery, 'owner-b');
    await armIndependentHealthWithdrawal(recovery,
      await recordVerifiedInitialConsent(f.db, recovery, 'owner-b'));
    withdraw(f, 'owner-b');
    // The retry still fails, but the independent B fence authorizes its
    // own bounded data step. The invocation must not claim success.
    await assert.rejects(tick(), /independent-recovery-fence-unavailable/);
    assert.equal(cutoff().finalized, 0);
    assert.ok(cutoff().next_check_ms > 0);
    assert.equal(count(f, 'sync_documents', 'owner-b'), 1);
    assert.equal(count(f, 'cloud_account_keys', 'owner-b'), 1);
    assert.equal(count(f, 'health_erasure_finalizations', 'owner-b'), 0);

    const previousLease = job(f, 'owner-b').lease_epoch;
    expire(f, 'owner-b');
    registry.exec("UPDATE recovery_control SET mode='sealed', generation=3 WHERE singleton=1");
    await assert.rejects(tick(), /independent-recovery-fence-unavailable/);
    assert.equal(job(f, 'owner-b').lease_epoch, previousLease);
    assert.equal(count(f, 'sync_documents', 'owner-b'), 1);

    registry.exec("UPDATE recovery_control SET mode='open', generation=4 WHERE singleton=1");
    registry.exec('DROP TRIGGER synthetic_terminal_failure');
    await assert.rejects(tick(), /independent-recovery-fence-unavailable/);
    const deadline = cutoff().next_check_ms;
    const formatTime = clock.prepare('SELECT strftime(?, ?) AS value');
    registry.function('strftime', (format, date) =>
      formatTime.get(format, date === 'now' ? new Date(deadline).toISOString() : date).value);
    assert.deepEqual(await erasureWorker.scheduled({}, { ...env, CF06_RECOVERY_GENERATION: '4' }),
      { outcome: 'progress', phase: 'data', removed: 1, table: 'sync_documents' });
    assert.equal(cutoff().finalized, 1);
    assert.equal(count(f, 'health_erasure_finalizations', 'owner-a'), 1);
    assert.equal(count(f, 'cloud_account_keys', 'owner-b'), 1);
    assert.equal(count(f, 'health_erasure_finalizations', 'owner-b'), 0);
  } finally { clock.close(); registry.close(); f.sqlite.close(); }
});

void test('one scheduled health tick cannot cross a recovery generation at a destructive boundary', async () => {
  for (const interruption of ['reservation', 'selection', 'data-write', 'cutoff', 'terminal-write']) {
    const f = fixture();
    const registry = new DatabaseSync(':memory:');
    try {
      applyCurrentD1RecoverySchema(registry);
      registry.exec("UPDATE recovery_control SET mode='open', generation=2");
      const recovery = new D1Sqlite(registry);
      await ownerWithWrappedKey(f, 'owner-a');
      await enrollIndependentOwner(recovery, 'owner-a');
      await armIndependentHealthWithdrawal(recovery,
        await recordVerifiedInitialConsent(f.db, recovery, 'owner-a'));
      const keyPhase = interruption === 'cutoff' || interruption === 'terminal-write';
      if (!keyPhase) insertDocuments(f, 'owner-a', 5);
      withdraw(f, 'owner-a');
      const env = { DB: f.db, RECOVERY_DB: recovery, CF06_ERASURE_RUN_ENABLED: 'enabled', CF06_RECOVERY_GENERATION: '2' };
      if (keyPhase) {
        assert.deepEqual(await erasureWorker.scheduled({}, env), { outcome: 'awaiting-keys' });
        expire(f, 'owner-a');
      }
      let interrupted = false;
      const reopen = () => {
        assert.equal(interrupted, false);
        interrupted = true;
        registry.exec("UPDATE recovery_control SET mode='sealed', generation=3");
        registry.exec("UPDATE recovery_control SET mode='open', generation=4");
      };
      const intercept = (db, predicate, method) => ({
        withSession(mode) {
          const primary = db.withSession(mode);
          return { prepare(sql) {
            const statement = primary.prepare(sql);
            if (!predicate(sql)) return statement;
            const wrap = (bound) => ({
              async first() {
                const value = await bound.first();
                if (method === 'first') reopen();
                return value;
              },
              async run() {
                const value = await bound.run();
                if (method === 'run') reopen();
                return value;
              },
            });
            return { ...wrap(statement), bind(...args) { return wrap(statement.bind(...args)); } };
          } };
        },
      });
      if (interruption === 'reservation') {
        env.RECOVERY_DB = intercept(recovery, sql => sql.includes('UPDATE recovery_erasure_cutoffs SET next_check_ms'), 'first');
      } else if (interruption === 'selection') {
        env.DB = intercept(f.db, sql => sql.includes('ORDER BY MAX(j.requested_at_ms'), 'first');
      } else if (interruption === 'data-write') {
        env.DB = intercept(f.db, sql => sql.startsWith('DELETE FROM sync_documents'), 'run');
      } else if (interruption === 'cutoff') {
        env.RECOVERY_DB = intercept(recovery, sql => sql.includes('INSERT INTO recovery_erasure_cutoffs'), 'run');
      } else {
        env.DB = intercept(f.db, sql => sql.includes('INSERT INTO health_erasure_finalizations'), 'first');
      }
      await assert.rejects(erasureWorker.scheduled({}, env), /independent-recovery-fence-unavailable/);
      assert.equal(interrupted, true);
      assert.equal(count(f, 'sync_documents', 'owner-a'), keyPhase ? 0 : interruption === 'data-write' ? 1 : 5);
      assert.equal(count(f, 'cloud_account_keys', 'owner-a'), interruption === 'terminal-write' ? 0 : 1);
      assert.equal(count(f, 'health_erasure_finalizations', 'owner-a'), interruption === 'terminal-write' ? 1 : 0);
      const cutoff = registry.prepare('SELECT finalized FROM recovery_erasure_cutoffs WHERE uid=?').get('owner-a');
      assert.equal(cutoff?.finalized ?? 0, 0);
      if (interruption === 'reservation' || interruption === 'selection') assert.equal(job(f, 'owner-a').lease_epoch, 0);
      // A fresh invocation can resume only under the new generation, with the
      // original owner fence, durable cutoff and exact SQL lease.
      if (keyPhase) {
        // A completed job is immutable; only the incomplete cutoff path
        // needs another lease. A terminal commit is reconciled separately.
        if (interruption === 'cutoff') expire(f, 'owner-a');
        await assert.rejects(erasureWorker.scheduled({}, { ...env, DB: f.db, RECOVERY_DB: recovery }),
          /independent-recovery-fence-unavailable/);
        await erasureWorker.scheduled({}, { ...env, DB: f.db, RECOVERY_DB: recovery,
          CF06_RECOVERY_GENERATION: '4' });
        assert.equal(count(f, 'health_erasure_finalizations', 'owner-a'), 1);
        assert.equal(registry.prepare('SELECT finalized FROM recovery_erasure_cutoffs WHERE uid=?').get('owner-a').finalized, 1);
      }
    } finally { registry.close(); f.sqlite.close(); }
  }
});

void test('scheduler has no public fetch endpoint and handles only one bounded step per tick', async () => {
  assert.equal(typeof erasureWorker.fetch, 'undefined');
  const f = fixture();
  const registry = new DatabaseSync(':memory:');
  try {
    await ownerWithWrappedKey(f, 'owner-a');
    insertDocuments(f, 'owner-a', 6);
    applyCurrentD1RecoverySchema(registry);
    registry.exec("UPDATE recovery_control SET mode='open', generation=2 WHERE singleton=1");
    const recovery = new D1Sqlite(registry);
    await enrollIndependentOwner(recovery, 'owner-a');
    await armIndependentHealthWithdrawal(recovery,
      await recordVerifiedInitialConsent(f.db, recovery, 'owner-a'));
    withdraw(f, 'owner-a');
    for (const RECOVERY_DB of [undefined, f.db]) {
      await assert.rejects(erasureWorker.scheduled({}, { DB: f.db, RECOVERY_DB, CF06_ERASURE_RUN_ENABLED: 'enabled', CF06_RECOVERY_GENERATION: '2' }),
        /independent-recovery-fence-unavailable/);
      assert.equal(count(f, 'sync_documents', 'owner-a'), 6);
    }
    await erasureWorker.scheduled({}, { DB: f.db, RECOVERY_DB: recovery, CF06_ERASURE_RUN_ENABLED: 'enabled', CF06_RECOVERY_GENERATION: '2' });
    assert.equal(count(f, 'sync_documents', 'owner-a'), 2);
    assert.equal(job(f, 'owner-a').phase, 'data');
  } finally { registry.close(); f.sqlite.close(); }
});
