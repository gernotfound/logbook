import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { applyCurrentD1RecoverySchema } from './current-d1-schema.mjs';
import worker from '../../cloudflare/api/worker.mjs';
import { releaseCloudAccountDataKey } from '../../cloudflare/api/cloud-key-store.mjs';
import { runOneHealthErasureStep } from '../../cloudflare/jobs/health-erasure-worker.mjs';
import {
  armIndependentHealthWithdrawal, recordVerifiedHealthWithdrawal,
} from '../../cloudflare/recovery/independent-owner-fence.mjs';

const ORIGIN = 'https://b01-synthetic.invalid';
const SESSION_HASH = 'a'.repeat(64);
const KEK = Buffer.alloc(32, 77).toString('base64');
const MIGRATIONS = readdirSync(new URL('../../cloudflare/api/migrations/', import.meta.url))
  .filter(name => /^[0-9]{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
assert.ok(MIGRATIONS.length >= 10, 'full erasure schema required');
assert.deepEqual(MIGRATIONS.map(name => name.slice(0, 4)),
  Array.from({ length: MIGRATIONS.length }, (_, i) => String(i + 1).padStart(4, '0')));

class Statement {
  constructor(sqlite, sql, args = []) { this.sqlite = sqlite; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.sqlite, this.sql, args); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  all() { return { results: this.sqlite.prepare(this.sql).all(...this.args) }; }
  run() {
    const meta = this.sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: meta.changes } };
  }
}
class SqliteD1 {
  constructor(sqlite) { this.sqlite = sqlite; }
  withSession(mode) { assert.equal(mode, 'first-primary'); return this; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      // SQLite/D1 executes a batch as one transaction: do not yield between
      // its statements or concurrent synthetic requests could nest BEGINs.
      const results = statements.map(statement => /^\s*SELECT\b/i.test(statement.sql)
        ? statement.all() : statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
function apply(sqlite, start = 0, end = MIGRATIONS.length) {
  for (const name of MIGRATIONS.slice(start, end)) {
    sqlite.exec(readFileSync(new URL('../../cloudflare/api/migrations/' + name, import.meta.url), 'utf8'));
  }
}
function makeFixture({ legacy = false, initialConsentAt } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  apply(sqlite, 0, legacy ? 8 : MIGRATIONS.length);
  const db = new SqliteD1(sqlite);
  const ledger = new DatabaseSync(':memory:');
  applyCurrentD1RecoverySchema(ledger);
  ledger.prepare("UPDATE recovery_control SET mode='open',generation=2 WHERE singleton=1").run();
  const env = {
    DB: db, RECOVERY_DB: new SqliteD1(ledger),
    API_ORIGIN: ORIGIN, CLOUD_ACCOUNT_KEK_V1: KEK,
    CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
    AUTH_GATE: { async fetch() {
      return new Response(JSON.stringify({
        uid: 'owner-a', authenticated: true, emailVerified: true,
        healthConsentRevision: 1, fenceEpoch: 1, csrfVerified: true,
        rateGatePassed: true, sessionHash: SESSION_HASH,
      }), { status: 200 });
    } },
  };
  function owner(uid, acceptedAt) {
    const issued = (acceptedAt ?? Date.now()) - 5000;
    sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)").run(uid, issued);
    sqlite.prepare("INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?, 'active', 1, 1)").run(uid);
    sqlite.prepare('INSERT INTO sync_state(uid,revision) VALUES (?,0)').run(uid);
    sqlite.prepare(`INSERT INTO health_consent_acceptances
      (uid,consent_revision,privacy_version,terms_version,accepted_at_ms,over_18_confirmed)
      VALUES (?,1,'1.3.9','1.2.5',?,1)`).run(uid, acceptedAt ?? issued);
    sqlite.prepare(`INSERT INTO auth_sessions
      (token_hash,uid,auth_epoch,csrf_hash,issued_at_ms,idle_expires_at_ms,absolute_expires_at_ms)
      VALUES (?,?,1,?,?,?,?)`).run(uid === 'owner-a' ? SESSION_HASH : 'b'.repeat(64),
      uid, 'c'.repeat(64), issued, issued + 86400000, issued + 172800000);
    ledger.prepare(`INSERT INTO recovery_owner_fences
      (uid,status,consent_revision,fence_epoch,erased_before_revision,change_seq)
      VALUES (?,'pending',0,1,0,1)`).run(uid);
    ledger.prepare(`UPDATE recovery_owner_fences
      SET status='active',consent_revision=1,change_seq=2 WHERE uid=?`).run(uid);
  }
  owner('owner-a', initialConsentAt);
  return { sqlite, ledger, db, env, owner, close: () => { ledger.close(); sqlite.close(); } };
}
function count(f, table, uid = 'owner-a') {
  return f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE uid=?`).get(uid).n;
}
async function provision(f, uid = 'owner-a') {
  return releaseCloudAccountDataKey(f.db, f.env, {
    uid, authenticated: true, emailVerified: true, csrfVerified: true,
    rateGatePassed: true, sessionHash: uid === 'owner-a' ? SESSION_HASH : 'b'.repeat(64),
    healthConsentRevision: 1, fenceEpoch: 1,
  });
}
async function http(f, route, data) {
  const response = await worker.fetch(new Request(ORIGIN + '/v1/sync/' + route, {
    method: 'POST',
    headers: {
      Origin: ORIGIN, 'Content-Type': 'application/json',
      Cookie: 'synthetic-session=opaque', 'X-CSRF-Token': 'synthetic',
    },
    body: JSON.stringify(data),
  }), f.env);
  return { status: response.status, body: await response.json() };
}
function claim(id = 'mutation0000000001') {
  return {
    mutationId: id, expectedRevision: 0, expectedFenceEpoch: 1,
    consentRevision: 1, candidateReplicaId: 'replica-a', currentReplica: null,
    checkpointClock: {},
  };
}
function commit(replica, id = 'batch000000000001') {
  // Enrollment responses include lease/checkpoint metadata. The commit wire
  // protocol deliberately accepts only the three immutable actor fields.
  const writerReplica = { slot: replica.slot, replicaId: replica.replicaId, generation: replica.generation };
  return {
    batchId: id, expectedRevision: 1, expectedFenceEpoch: 1, consentRevision: 1,
    replica: writerReplica, lastSeq: 1,
    documents: [{ path: '', document: {
      _schemaVersion: 1,
      _sync: { protocolVersion: 3, clock: { [replica.slot]: 1 }, fields: {},
        writer: { ...writerReplica, seq: 1, consentRevision: 1 } },
      _sealed: { format: 'thelogbook-cloud-document', version: 1,
        nonce: 'A'.repeat(32), ciphertext: 'B'.repeat(48) },
    } }],
  };
}
function currentRevision(f) {
  return f.sqlite.prepare('SELECT revision FROM sync_state WHERE uid=?').get('owner-a').revision;
}
// The scheduler uses a 30-second lease. Expiring it explicitly in this
// synthetic fixture simulates a later tick without bypassing lease fencing.
function expireErasureLease(f) {
  f.sqlite.prepare("UPDATE health_erasure_jobs SET lease_until_ms=? WHERE uid='owner-a' AND status='processing'")
    .run(Date.now() - 1);
}
async function withFixture(action, options) {
  const f = makeFixture(options);
  try { await action(f); } finally { f.close(); }
}

void test('the key issuance and writable replica fences accept the exact consent millisecond after SQL upgrade', () => {
  // At this instant the historical floating Julian conversion returns one
  // millisecond early even though consent and the DB clock agree.
  const fixed = '2026-11-23 01:22:30.000';
  const epoch = Date.parse('2026-11-23T01:22:30.000Z');
  const f = makeFixture({ legacy: true, initialConsentAt: epoch });
  try {
    const clockMigration = MIGRATIONS.findIndex(name => name.endsWith('_integer_cloud_key_clock.sql'));
    assert.equal(clockMigration, 10);
    apply(f.sqlite, 8, clockMigration);
    function freezeClock(name, type, at = fixed) {
      const definition = f.sqlite.prepare('SELECT sql FROM sqlite_schema WHERE name = ?').get(name).sql;
      f.sqlite.exec(`DROP ${type} ${name}; ${definition.replaceAll("'now'", `'${at}'`)};`);
    }
    freezeClock('cloud_key_first_issuance', 'TRIGGER');
    freezeClock('sync_writable_cloud_key', 'VIEW');
    const insert = f.sqlite.prepare(`INSERT INTO cloud_account_keys
      (uid,consent_revision,format,version,key_version,iv,ciphertext,tag,issued_at_ms)
      VALUES (?,1,'thelogbook-wrapped-account-key',1,1,?,?,?,?)`);
    const insertKey = uid => insert.run(uid, 'A'.repeat(16), 'B'.repeat(44), 'C'.repeat(24), epoch);
    assert.throws(() => insertKey('owner-a'), /cloud-key-provision-fenced/);
    assert.equal(count(f, 'cloud_key_issuance'), 0);

    apply(f.sqlite, clockMigration, clockMigration + 1);
    freezeClock('cloud_key_first_issuance', 'TRIGGER');
    freezeClock('sync_writable_cloud_key', 'VIEW');
    assert.equal(insertKey('owner-a').changes, 1);
    assert.equal(count(f, 'cloud_key_issuance'), 1);
    assert.equal(count(f, 'sync_writable_cloud_key'), 1);
    // Evaluate the same stored key a millisecond before consent. The clock
    // fix must never grant a write merely because key issuance exists.
    apply(f.sqlite, clockMigration, clockMigration + 1);
    freezeClock('sync_writable_cloud_key', 'VIEW', '2026-11-23 01:22:29.999');
    assert.equal(count(f, 'cloud_key_issuance'), 1);
    assert.equal(count(f, 'sync_writable_cloud_key'), 0);
    freezeClock('cloud_key_first_issuance', 'TRIGGER');
    f.owner('owner-future', epoch + 1);
    assert.throws(() => insertKey('owner-future'), /cloud-key-provision-fenced/);
    assert.equal(count(f, 'cloud_key_issuance', 'owner-future'), 0);
    assert.equal(count(f, 'sync_writable_cloud_key', 'owner-future'), 0);
  } finally { f.close(); }
});

function beforeKeyPrecondition(f, action) {
  const original = f.db.withSession.bind(f.db);
  f.env.DB = Object.assign(Object.create(f.db), { withSession(mode) {
    const primary = original(mode);
    const wrapped = Object.create(primary);
    wrapped.prepare = sql => {
      const statement = primary.prepare(sql);
      if (!sql.includes('AS stored_keys')) return statement;
      return { bind(...args) { return { async first() {
        await action();
        return statement.bind(...args).first();
      } }; } };
    };
    return wrapped;
  } });
}

void test('session or consent revoked before the ADK snapshot yields 403, never initial-key authority', async () => {
  for (const revoke of [
    f => f.sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?').run(Date.now(), SESSION_HASH),
    f => f.sqlite.prepare('INSERT INTO health_erasure_jobs(uid,consent_revision,fence_epoch,requested_at_ms) VALUES (?,1,1,?)')
      .run('owner-a', Date.now()),
  ]) {
    await withFixture(async f => {
      let observed = false;
      beforeKeyPrecondition(f, () => { observed = true; revoke(f); });
      assert.deepEqual(await http(f, 'replica/claim', claim()),
        { status: 403, body: { error: 'access-revoked' } });
      assert.equal(observed, true);
      assert.equal(count(f, 'cloud_account_keys'), 0);
      assert.equal(count(f, 'sync_replicas'), 0);
      assert.equal(count(f, 'sync_replica_mutations'), 0);
    });
  }
});

void test('a competing ADK issuance and claim before the snapshot retains the exact 409 conflict', () =>
  withFixture(async f => {
    let observed = false;
    beforeKeyPrecondition(f, async () => {
      observed = true;
      (await provision(f)).fill(0);
      assert.equal((await http(f, 'replica/claim', claim('mutation0000000099'))).status, 200);
    });
    assert.deepEqual(await http(f, 'replica/claim', claim()),
      { status: 409, body: { error: 'replica-fenced-or-conflict' } });
    assert.equal(observed, true);
    assert.equal(count(f, 'sync_replica_mutations'), 1);
    assert.equal(count(f, 'sync_replicas'), 1);
    assert.equal(currentRevision(f), 1);
    assert.equal(f.sqlite.prepare('SELECT mutation_id FROM sync_replica_mutations WHERE mutation_id=?')
      .get(claim().mutationId), undefined);
  }));

void test('unavailable primary key-state lookup remains 503 without a claim or fabricated precondition', () =>
  withFixture(async f => {
    let observed = false;
    beforeKeyPrecondition(f, () => { observed = true; throw Error('synthetic-primary-unavailable'); });
    assert.deepEqual(await http(f, 'replica/claim', claim()),
      { status: 503, body: { error: 'cloud-unavailable' } });
    assert.equal(observed, true);
    assert.equal(count(f, 'sync_replicas'), 0);
    assert.equal(count(f, 'sync_replica_mutations'), 0);
    assert.equal(currentRevision(f), 0);
  }));

void test('full migrations: no key means no claim; real wrapped ADK and matching marker enable claim, commit and replay', () =>
  withFixture(async f => {
    const first = await http(f, 'replica/claim', claim());
    assert.deepEqual(first, { status: 428, body: { error: 'cloud-key-required' } });
    assert.equal(count(f, 'sync_replica_mutations'), 0);
    assert.equal(count(f, 'sync_replicas'), 0);
    assert.equal(currentRevision(f), 0);

    const adk = await provision(f);
    assert.equal(adk.byteLength, 32);
    adk.fill(0);
    assert.equal(count(f, 'cloud_account_keys'), 1);
    assert.equal(count(f, 'cloud_key_issuance'), 1);
    const enrolled = await http(f, 'replica/claim', claim());
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
    assert.equal(enrolled.body.replayed, false);
    assert.equal(currentRevision(f), 1);
    const replay = await http(f, 'replica/claim', claim());
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    const input = commit(enrolled.body.replica);
    const saved = await http(f, 'commit', input);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.replayed, false);
    assert.equal((await http(f, 'commit', input)).body.replayed, true);
    assert.equal(count(f, 'sync_documents'), 1);
    assert.equal(count(f, 'sync_receipts'), 1);
    assert.equal(currentRevision(f), 2);
  }));

void test('direct document, membership and revision writes cannot bypass missing key', () =>
  withFixture(async f => {
    const now = Date.now();
    assert.throws(() => f.sqlite.prepare(
      "INSERT INTO sync_documents(uid,path,envelope_json,revision) VALUES (?,'','{}',1)"
    ).run('owner-a'), /replica-cloud-key-required/);
    assert.throws(() => f.sqlite.prepare(
      "INSERT INTO sync_replicas VALUES (?, 's00','direct-replica',1,?,?,'{}',0,'active')"
    ).run('owner-a', now + 86400000, now), /replica-cloud-key-required/);
    assert.throws(() => f.sqlite.prepare(
      'UPDATE sync_state SET revision=1 WHERE uid=?'
    ).run('owner-a'), /replica-cloud-key-required/);
    assert.equal(count(f, 'sync_documents'), 0);
    assert.equal(count(f, 'sync_replicas'), 0);
    assert.equal(currentRevision(f), 0);
    assert.throws(() => f.sqlite.prepare(
      "DELETE FROM sync_state WHERE uid='owner-a'"
    ).run(), /active-replica-delete/);
    assert.throws(() => f.sqlite.prepare(
      "INSERT INTO sync_state(uid,revision) VALUES ('poisoned-owner', 3)"
    ).run(), /replica-cloud-key-required/);
  }));

void test('other-owner key and orphan issuance marker never satisfy the ADK grant', () =>
  withFixture(async f => {
    f.owner('owner-b');
    const b = await provision(f, 'owner-b');
    b.fill(0);
    assert.equal(count(f, 'cloud_account_keys', 'owner-a'), 0);
    assert.deepEqual(await http(f, 'replica/claim', claim()),
      { status: 428, body: { error: 'cloud-key-required' } });
    f.sqlite.prepare('INSERT INTO cloud_key_issuance VALUES (?,?,?)').run('owner-a', 1, Date.now() - 1000);
    assert.equal(count(f, 'cloud_key_issuance'), 1);
    assert.equal(count(f, 'cloud_account_keys'), 0);
    assert.deepEqual(await http(f, 'replica/claim', claim('mutation0000000002')),
      { status: 503, body: { error: 'cloud-unavailable' } });
    await assert.rejects(provision(f));
    assert.equal(count(f, 'sync_replica_mutations'), 0);
  }));

void test('consent generation mismatch fences writes despite a prior valid ADK', () =>
  withFixture(async f => {
    const adk = await provision(f);
    const original = await http(f, 'replica/claim', claim());
    assert.equal(original.status, 200, JSON.stringify(original.body));
    f.sqlite.prepare("UPDATE sync_subjects SET consent_revision=2, fence_epoch=2 WHERE uid='owner-a'").run();
    assert.throws(() => f.sqlite.prepare(
      "INSERT INTO sync_documents VALUES ('owner-a', '', '{}', 2)"
    ).run(), /replica-cloud-key-required/);
    assert.equal(count(f, 'sync_documents'), 0);
    adk.fill(0);
  }));

void test('concurrent independent claims cannot both advance the revision', () =>
  withFixture(async f => {
    (await provision(f)).fill(0);
    const results = await Promise.all([
      http(f, 'replica/claim', claim('mutation0000000081')),
      http(f, 'replica/claim', { ...claim('mutation0000000082'), candidateReplicaId: 'replica-b' }),
    ]);
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.equal(count(f, 'sync_replica_mutations'), 1);
    assert.equal(count(f, 'sync_replicas'), 1);
    assert.equal(currentRevision(f), 1);
  }));

void test('late SQL failure atomically rolls back document, receipt, seq and revision; retry commits once', () =>
  withFixture(async f => {
    (await provision(f)).fill(0);
    const enrolled = await http(f, 'replica/claim', claim());
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
    f.sqlite.exec(`CREATE TRIGGER synthetic_fail_last BEFORE UPDATE ON sync_state
      BEGIN SELECT RAISE(ABORT, 'injected-sql-failure'); END`);
    const input = commit(enrolled.body.replica);
    const rejected = await http(f, 'commit', input);
    assert.notEqual(rejected.status, 200);
    assert.equal(count(f, 'sync_documents'), 0);
    assert.equal(count(f, 'sync_receipts'), 0);
    assert.equal(currentRevision(f), 1);
    assert.equal(f.sqlite.prepare("SELECT last_seq FROM sync_replicas WHERE uid='owner-a'").get().last_seq, 0);
    f.sqlite.exec('DROP TRIGGER synthetic_fail_last');
    assert.equal((await http(f, 'commit', input)).status, 200);
    assert.equal(count(f, 'sync_receipts'), 1);
    assert.equal(currentRevision(f), 2);
  }));

void test('active owner cannot delete or rewrite causal evidence outside the erasure lifecycle', () =>
  withFixture(async f => {
    (await provision(f)).fill(0);
    const enrolled = await http(f, 'replica/claim', claim());
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
    const committed = await http(f, 'commit', commit(enrolled.body.replica));
    assert.equal(committed.status, 200, JSON.stringify(committed.body));
    for (const table of ['sync_documents', 'sync_receipts', 'sync_replica_mutations', 'sync_replicas']) {
      assert.throws(() => f.sqlite.prepare(`DELETE FROM ${table} WHERE uid=?`).run('owner-a'),
        /active-replica-delete/);
      assert.equal(count(f, table), 1);
    }
    assert.throws(() => f.sqlite.prepare(
      "UPDATE sync_receipts SET request_hash=? WHERE uid='owner-a'"
    ).run('0'.repeat(64)), /sync-receipt-immutable/);
    assert.throws(() => f.sqlite.prepare(
      "UPDATE sync_replica_mutations SET request_hash=? WHERE uid='owner-a'"
    ).run('0'.repeat(64)), /sync-replica-mutation-immutable/);
    assert.throws(() => f.sqlite.prepare(
      "INSERT OR REPLACE INTO sync_receipts SELECT * FROM sync_receipts WHERE uid='owner-a'"
    ).run(), /sync-receipt-immutable/);
    assert.throws(() => f.sqlite.prepare(
      "INSERT OR REPLACE INTO sync_replica_mutations SELECT * FROM sync_replica_mutations WHERE uid='owner-a'"
    ).run(), /sync-replica-mutation-immutable/);
    assert.throws(() => f.sqlite.prepare(
      "DELETE FROM sync_state WHERE uid='owner-a'"
    ).run(), /active-replica-delete/);
    assert.throws(() => f.sqlite.prepare(
      "INSERT OR REPLACE INTO sync_state(uid,revision) VALUES ('owner-a',0)"
    ).run(), /replica-cloud-key-required/);
    assert.equal(currentRevision(f), 2);
  }));

void test('mismatched issuance timestamp cannot satisfy a granted key after simulated database corruption', () =>
  withFixture(async f => {
    (await provision(f)).fill(0);
    // Normal migrations make the marker immutable. Bypass that guard solely
    // to simulate a damaged restored database, never a legitimate SQL path.
    f.sqlite.exec('DROP TRIGGER cloud_key_issuance_immutable_update');
    f.sqlite.prepare("UPDATE cloud_key_issuance SET issued_at_ms = issued_at_ms + 1 WHERE uid='owner-a'").run();
    assert.equal(count(f, 'cloud_account_keys'), 1);
    assert.equal(count(f, 'cloud_key_issuance'), 1);
    const response = await http(f, 'replica/claim', claim());
    assert.deepEqual(response, { status: 503, body: { error: 'cloud-unavailable' } });
    assert.equal(count(f, 'sync_replica_mutations'), 0);
    assert.equal(currentRevision(f), 0);
    assert.throws(() => f.sqlite.prepare(
      "INSERT INTO sync_documents VALUES ('owner-a', '', '{}', 1)"
    ).run(), /replica-cloud-key-required/);
  }));

void test('lost HTTP acknowledgement is recovered only from the persisted matching receipt', () =>
  withFixture(async f => {
    (await provision(f)).fill(0);
    const enrolled = await http(f, 'replica/claim', claim());
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
    const original = f.db.batch.bind(f.db);
    let once = true;
    f.db.batch = async statements => {
      const result = await original(statements);
      if (once && statements[0].sql.includes('INSERT INTO sync_receipts')) {
        once = false;
        throw new Error('synthetic-post-commit-network-loss');
      }
      return result;
    };
    const answer = await http(f, 'commit', commit(enrolled.body.replica));
    assert.equal(answer.status, 200);
    assert.equal(answer.body.replayed, true);
    assert.equal(count(f, 'sync_receipts'), 1);
    assert.equal(currentRevision(f), 2);
  }));

void test('migration is additive over old synthetic rows; blocked writes do not erase records or bypass bounded erasure', () =>
  withFixture(async f => {
    const now = Date.now();
    f.sqlite.prepare("INSERT INTO sync_replicas VALUES (?, 's00','legacy-synthetic',1,?,?,'{}',0,'active')")
      .run('owner-a', now + 86400000, now);
    f.sqlite.prepare("INSERT INTO sync_documents VALUES ('owner-a','','{}',1)").run();
    const original = f.sqlite.prepare("SELECT envelope_json FROM sync_documents WHERE uid='owner-a'").get().envelope_json;
    apply(f.sqlite, 8);
    assert.equal(count(f, 'sync_replicas'), 1);
    assert.equal(count(f, 'sync_documents'), 1);
    assert.equal(f.sqlite.prepare("SELECT envelope_json FROM sync_documents WHERE uid='owner-a'").get().envelope_json, original);
    assert.throws(() => f.sqlite.prepare(
      "UPDATE sync_documents SET envelope_json='{\"changed\":true}' WHERE uid='owner-a'"
    ).run(), /replica-cloud-key-required/);
    assert.deepEqual(await http(f, 'replica/claim', claim()),
      { status: 503, body: { error: 'cloud-unavailable' } });
    await assert.rejects(provision(f));
    f.sqlite.prepare('INSERT INTO health_erasure_jobs(uid,consent_revision,fence_epoch,requested_at_ms) VALUES (?,1,1,?)')
      .run('owner-a', now);
    for (let i = 0; i < 8; i++) {
      const outcome = await runOneHealthErasureStep(f.db);
      if (outcome.outcome === 'awaiting-keys') break;
      assert.equal(outcome.outcome, 'progress');
      expireErasureLease(f);
    }
    assert.equal(count(f, 'sync_documents'), 0);
    assert.equal(count(f, 'sync_replicas'), 0);
    assert.equal(f.sqlite.prepare("SELECT phase FROM health_erasure_jobs WHERE uid='owner-a'").get().phase, 'awaiting-keys');
  }, { legacy: true }));

void test('withdrawal preserves rights-only release, then bounded erasure and key destruction without resurrection', () =>
  withFixture(async f => {
    const original = await provision(f);
    const enrolled = await http(f, 'replica/claim', claim());
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
    assert.equal((await http(f, 'commit', commit(enrolled.body.replica))).status, 200);
    await armIndependentHealthWithdrawal(f.env.RECOVERY_DB, {
      uid: 'owner-a', status: 'active', consentRevision: 1, fenceEpoch: 1, erasedBeforeRevision: 0,
    });
    f.sqlite.prepare('INSERT INTO health_erasure_jobs(uid,consent_revision,fence_epoch,requested_at_ms) VALUES (?,1,1,?)')
      .run('owner-a', Date.now());
    await recordVerifiedHealthWithdrawal(f.db, f.env.RECOVERY_DB, 'owner-a');
    const rights = await releaseCloudAccountDataKey(f.db, f.env, {
      uid: 'owner-a', authenticated: true, emailVerified: true,
      csrfVerified: true, rateGatePassed: true, sessionHash: SESSION_HASH,
      healthConsentRevision: 1, fenceEpoch: 1,
    }, 'rights-export');
    assert.deepEqual(rights, original);
    rights.fill(0);
    original.fill(0);
    for (let i = 0; i < 8; i++) {
      const result = await runOneHealthErasureStep(f.db);
      if (result.outcome === 'awaiting-keys') break;
      assert.equal(result.outcome, 'progress');
      expireErasureLease(f);
    }
    for (const table of ['sync_documents','sync_receipts','sync_replica_mutations','sync_replicas']) {
      assert.equal(count(f, table), 0);
    }
    assert.equal(count(f, 'cloud_account_keys'), 1);
    assert.throws(() => f.sqlite.prepare("DELETE FROM cloud_account_keys WHERE uid='owner-a'").run(),
      /cloud-key-erasure-fenced/);
    expireErasureLease(f);
    assert.deepEqual(await runOneHealthErasureStep(f.db),
      { outcome: 'complete', keyDisposition: 'destroyed' });
    assert.equal(f.sqlite.prepare("SELECT status FROM health_erasure_jobs WHERE uid='owner-a'").get().status, 'complete');
    assert.equal(count(f, 'health_erasure_finalizations'), 1);
    assert.equal(count(f, 'cloud_account_keys'), 0);
    assert.equal(count(f, 'cloud_key_issuance'), 1);
    await assert.rejects(provision(f));
    assert.deepEqual(await http(f, 'replica/claim', claim('mutation0000000085')),
      { status: 403, body: { error: 'access-revoked' } });
  }));

void test('D1 write quota failure returns 503 without receipt, mutation or false acknowledgement; retry succeeds', () =>
  withFixture(async f => {
    (await provision(f)).fill(0);
    const enrolled = await http(f, 'replica/claim', claim());
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
    const input = commit(enrolled.body.replica);
    const originalBatch = f.db.batch.bind(f.db);
    let rejectedWrites = 0;
    f.db.batch = async statements => {
      if (statements[0].sql.includes('INSERT INTO sync_receipts')) {
        rejectedWrites += 1;
        throw new Error('synthetic-d1-write-quota-exceeded');
      }
      return originalBatch(statements);
    };

    assert.deepEqual(await http(f, 'commit', input),
      { status: 503, body: { error: 'cloud-unavailable' } });
    assert.equal(rejectedWrites, 1);
    assert.equal(count(f, 'sync_documents'), 0);
    assert.equal(count(f, 'sync_receipts'), 0);
    assert.equal(currentRevision(f), 1);
    assert.equal(f.sqlite.prepare("SELECT last_seq FROM sync_replicas WHERE uid='owner-a'").get().last_seq, 0);
    f.db.batch = originalBatch;

    const recovered = await http(f, 'commit', input);
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal(recovered.body.replayed, false);
    assert.equal(count(f, 'sync_documents'), 1);
    assert.equal(count(f, 'sync_receipts'), 1);
    assert.equal(currentRevision(f), 2);
  }));

void test('post-commit D1 read outage is ambiguous 503 until exact durable receipt can be recovered', () =>
  withFixture(async f => {
    (await provision(f)).fill(0);
    const enrolled = await http(f, 'replica/claim', claim());
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
    const input = commit(enrolled.body.replica);
    const originalBatch = f.db.batch.bind(f.db);
    const originalWithSession = f.db.withSession.bind(f.db);
    let primaryUnavailable = false;
    f.db.batch = async statements => {
      const result = await originalBatch(statements);
      if (statements[0].sql.includes('INSERT INTO sync_receipts')) {
        primaryUnavailable = true;
        throw new Error('synthetic-lost-d1-commit-response');
      }
      return result;
    };
    f.db.withSession = mode => {
      if (primaryUnavailable) throw new Error('synthetic-d1-primary-read-quota-exceeded');
      return originalWithSession(mode);
    };

    // The SQL transaction completed, but the response and every independent
    // readback are unavailable. Nothing may be acknowledged from the exception.
    assert.deepEqual(await http(f, 'commit', input),
      { status: 503, body: { error: 'cloud-unavailable' } });
    assert.deepEqual(await http(f, 'receipt', { batchId: input.batchId }),
      { status: 503, body: { error: 'cloud-unavailable' } });
    assert.equal(count(f, 'sync_documents'), 1);
    assert.equal(count(f, 'sync_receipts'), 1);
    assert.equal(currentRevision(f), 2);

    f.db.withSession = originalWithSession;
    f.db.batch = originalBatch;
    const proof = await http(f, 'receipt', { batchId: input.batchId });
    assert.equal(proof.status, 200, JSON.stringify(proof.body));
    assert.match(proof.body.receipt.requestHash, /^[a-f0-9]{64}$/);
    assert.equal(proof.body.receipt.revision, 2);
    assert.equal(proof.body.receipt.lastSeq, 1);
    const replay = await http(f, 'commit', input);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.equal(count(f, 'sync_documents'), 1);
    assert.equal(count(f, 'sync_receipts'), 1);
    assert.equal(currentRevision(f), 2);
  }));
