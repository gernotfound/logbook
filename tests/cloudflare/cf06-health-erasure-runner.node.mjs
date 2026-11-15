import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import erasureWorker, { acquireOneHealthErasureKeyPhaseLease, runOneHealthErasureStep } from '../../cloudflare/jobs/health-erasure-worker.mjs';
import { wrapCloudAccountDataKey } from '../../cloudflare/api/cloud-key-crypto.mjs';

const SQL_FILES = readdirSync(new URL('../../cloudflare/api/migrations/', import.meta.url))
  .filter(name => /^000[1-8]_[a-z0-9_]+\.sql$/.test(name))
  .sort();
assert.deepEqual(SQL_FILES.map(name => name.slice(0, 4)),
  ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008']);

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
function withdraw(f, uid) {
  f.sqlite.prepare(`INSERT INTO health_erasure_jobs
    (uid,consent_revision,fence_epoch,requested_at_ms,status)
    VALUES (?,1,1,?,'pending')`).run(uid, Date.now() - 1000);
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
  f.sqlite.prepare(`INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch)
    VALUES (?,'active',?,1)`).run(uid, Date.now() - 20_000);
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

void test('bounded erasure drains every known replica table but never claims key erasure or completion', async () => {
  const f = fixture();
  try {
    owner(f, 'owner-a');
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
    owner(f, 'owner-a');
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
    owner(f, 'owner-a');
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
    owner(f, 'owner-a');
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
    owner(f, 'owner-a');
    owner(f, 'owner-b');
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
    owner(f, 'owner-a');
    insertDocuments(f, 'owner-a', 1);
    withdraw(f, 'owner-a');
    assert.throws(() => insertDocuments(f, 'owner-a', 2), /withdrawn-document-write/);
    assert.throws(() => f.sqlite.prepare(`UPDATE sync_documents SET envelope_json='{}' WHERE uid='owner-a'`).run(),
      /withdrawn-document-write/);
    assert.throws(() => f.sqlite.prepare(`INSERT INTO sync_replicas
      (uid,slot,replica_id,generation,lease_until_ms,checkpoint_at_ms,checkpoint_clock_json,last_seq,status)
      VALUES ('owner-a','s00','illegal',1,9999999999999,1,'{}',0,'active')`).run(),
    /withdrawn-replica-write/);
    assert.throws(() => f.sqlite.prepare(`UPDATE sync_subjects
      SET status='active', consent_revision=2, fence_epoch=2
      WHERE uid='owner-a'`).run(), /erasure-not-complete/);
    assert.equal(count(f, 'sync_documents', 'owner-a'), 1);
    assert.equal(job(f, 'owner-a').status, 'pending');
  } finally { f.sqlite.close(); }
});

void test('moving to the key phase requires all known data gone and does not bypass a lease', async () => {
  const f = fixture();
  try {
    owner(f, 'owner-a');
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
    owner(f, 'owner-a');
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

void test('scheduler has no public fetch endpoint and handles only one bounded step per tick', async () => {
  assert.equal(typeof erasureWorker.fetch, 'undefined');
  const f = fixture();
  try {
    owner(f, 'owner-a');
    insertDocuments(f, 'owner-a', 6);
    withdraw(f, 'owner-a');
    await erasureWorker.scheduled({}, { DB: f.db });
    assert.equal(count(f, 'sync_documents', 'owner-a'), 2);
    assert.equal(job(f, 'owner-a').phase, 'data');
  } finally { f.sqlite.close(); }
});
