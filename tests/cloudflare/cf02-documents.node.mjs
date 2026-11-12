import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import worker from '../../cloudflare/api/worker.mjs';

const migration = readFileSync(new URL('../../cloudflare/api/migrations/0001_encrypted_replica.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../../cloudflare/api/rollback/0001_encrypted_replica_down.sql', import.meta.url), 'utf8');
const origin = 'https://candidate.invalid';
const owner = 'cf02-synthetic-owner';
const replica = { slot: 's00', replicaId: 'synthetic-replica-0001', generation: 1 };

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  run() { return this.db.prepare(this.sql).run(...this.args); }
}
class D1SqliteAdapter {
  constructor(file) {
    this.sqlite = new DatabaseSync(file);
    this.sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const values = statements.map(statement => /^\s*SELECT\b/i.test(statement.sql)
        ? statement.all() : { results: [], meta: statement.run() });
      this.sqlite.exec('COMMIT');
      return values;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}
async function withFixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'thelogbook-cf02-'));
  const filename = join(dir, 'synthetic.sqlite');
  const db = new D1SqliteAdapter(filename);
  const second = new D1SqliteAdapter(filename);
  try {
    db.sqlite.exec(migration);
    db.sqlite.prepare('INSERT INTO sync_subjects VALUES (?, ?, ?, ?)').run(owner, 'active', 1, 5);
    db.sqlite.prepare('INSERT INTO sync_state (uid, revision) VALUES (?, 0)').run(owner);
    db.sqlite.prepare('INSERT INTO sync_replicas VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      owner, replica.slot, replica.replicaId, 1, Date.now() + 86400000, 0, 'active');
    await run(db, second);
  } finally { second.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
}

function envelope(seq = 1) {
  return {
    _schemaVersion: 1,
    _sync: {
      protocolVersion: 3, clock: { s00: seq }, fields: {},
      writer: { ...replica, seq, consentRevision: 1 },
    },
    _sealed: {
      format: 'thelogbook-cloud-document', version: 1,
      nonce: 'A'.repeat(32), ciphertext: 'B'.repeat(48),
    },
  };
}

function attempt(batchId = 'batch000000000001', seq = 1, rev = 0, paths = ['']) {
  return {
    batchId, expectedRevision: rev, consentRevision: 1,
    replica, lastSeq: seq, documents: paths.map(path => ({ path, document: envelope(seq) })),
  };
}
function makeEnv(db, claims = {}) {
  return {
    DB: db, API_ORIGIN: origin,
    AUTH_GATE: {
      async fetch() {
        return new Response(JSON.stringify({
          uid: owner, authenticated: true, emailVerified: true,
          healthConsentRevision: 1, fenceEpoch: 5, csrfVerified: true, rateGatePassed: true, ...claims,
        }), { status: 200 });
      },
    },
  };
}
async function call(db, route, body, config = {}) {
  const env = config.env ?? makeEnv(db);
  const headers = {
    'Origin': origin, 'Content-Type': 'application/json', 'Cookie': 'synthetic-session=opaque',
    'X-CSRF-Token': 'synthetic-csrf',
    ...(config.headers ?? {}),
  };
  const response = await worker.fetch(new Request(origin + '/v1/sync/' + route, {
    method: config.method ?? 'POST', headers, body: JSON.stringify(body),
  }), env);
  return { status: response.status, body: await response.json() };
}

void test('first encrypted root/month write, coherent read and durable receipt replay', () => withFixture(async db => {
  const before = await call(db, 'read', { paths: ['', 'history_months/2026-11'] });
  assert.equal(before.status, 200);
  assert.deepEqual(before.body.documents.map(item => item.document), [null, null]);
  const item = attempt('batch000000000001', 1, 0, ['', 'history_months/2026-11']);
  const saved = await call(db, 'commit', item);
  assert.deepEqual(saved, { status: 200, body: { batchId: item.batchId, revision: 1, lastSeq: 1, replayed: false } });
  const fetched = await call(db, 'read', { paths: ['', 'history_months/2026-11'] });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.revision, 1);
  assert.deepEqual(fetched.body.documents.map(item => item.document), [envelope(), envelope()]);
  const receipt = await call(db, 'receipt', { batchId: item.batchId });
  assert.equal(receipt.body.receipt.revision, 1);
  assert.equal(receipt.body.receipt.lastSeq, 1);
  assert.match(receipt.body.receipt.requestHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.body.receipt.replica, replica);
  const replay = await call(db, 'commit', item);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  const collision = await call(db, 'commit', { ...item, documents: [{ path: '', document: envelope(1) }] });
  assert.deepEqual(collision, { status: 409, body: { error: 'batch-id-conflict' } });
  assert.equal(db.sqlite.prepare('SELECT count(*) as n FROM sync_receipts').get().n, 1);
}));

void test('CAS conflict and invalid replica cannot persist documents or receipts', () => withFixture(async db => {
  const a = attempt('batch000000000002', 1, 1);
  const stale = await call(db, 'commit', a);
  assert.equal(stale.status, 409);
  assert.equal(db.sqlite.prepare('SELECT count(*) as n FROM sync_receipts').get().n, 0);
  const mismatchedReplica = attempt('batch000000000003', 1);
  mismatchedReplica.replica = { ...replica, generation: 2 };
  mismatchedReplica.documents[0].document._sync.writer.generation = 2;
  const fenced = await call(db, 'commit', mismatchedReplica);
  assert.equal(fenced.status, 409);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) as n FROM sync_documents').get().n, 0);
}));

void test('late SQL failure rolls back receipt, ciphertext and control revision atomically', () => withFixture(async db => {
  db.sqlite.exec("CREATE TRIGGER synthetic_rollback BEFORE INSERT ON sync_documents BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  const failed = await call(db, 'commit', attempt('batch000000000004'));
  assert.deepEqual(failed, { status: 503, body: { error: 'cloud-unavailable' } });
  assert.equal(db.sqlite.prepare('SELECT count(*) as n FROM sync_receipts').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) as n FROM sync_documents').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
  assert.equal(db.sqlite.prepare('SELECT last_seq FROM sync_replicas').get().last_seq, 0);
}));

void test('trusted identity, epoch, consent, origin, CSRF and strict schemas fail closed', () => withFixture(async db => {
  const item = attempt('batch000000000005');
  assert.equal((await call(db, 'commit', item, { env: { DB: db, API_ORIGIN: origin } })).status, 503);
  assert.equal((await call(db, 'commit', item, { headers: { Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await call(db, 'commit', item, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await call(db, 'commit', item, { env: makeEnv(db, { csrfVerified: false }) })).status, 403);
  assert.equal((await call(db, 'commit', item, { env: makeEnv(db, { rateGatePassed: false }) })).status, 503);
  assert.equal((await call(db, 'commit', item, { env: makeEnv(db, { fenceEpoch: 4 }) })).status, 409);
  assert.equal((await call(db, 'commit', item, { env: makeEnv(db, { healthConsentRevision: 2 }) })).status, 403);
  assert.equal((await call(db, 'commit', { ...item, uid: 'other-user' })).status, 400);
  assert.equal((await call(db, 'commit', { ...item, documents: [{ path: '', document: { ...envelope(), health: 'plaintext' } }] })).status, 400);
  assert.equal((await call(db, 'commit', { ...item, documents: [{ path: '../escape', document: envelope() }] })).status, 400);
  const missingCausalDot = envelope();
  delete missingCausalDot._sync.clock.s00;
  assert.equal((await call(db, 'commit', { ...item, documents: [{ path: '', document: missingCausalDot }] })).status, 400);
  assert.equal((await call(db, 'commit', { ...item, documents: [{ path: '', document: envelope() }, { path: '', document: envelope() }] })).status, 400);
  db.sqlite.prepare("UPDATE sync_subjects SET status = 'withdrawn' WHERE uid = ?").run(owner);
  assert.equal((await call(db, 'read', { paths: [''] })).status, 403);
  assert.equal((await call(db, 'commit', item)).status, 403);
  assert.equal(db.sqlite.prepare('SELECT count(*) as n FROM sync_documents').get().n, 0);
}));

void test('simultaneous stale revisions have one winner and no phantom receipt', () => withFixture(async (db, other) => {
  const [a, b] = await Promise.all([
    call(db, 'commit', attempt('batch000000000006', 1, 0)),
    call(other, 'commit', attempt('batch000000000007', 1, 0)),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) as n FROM sync_receipts').get().n, 1);
}));

void test('isolated migration has an explicit rollback, without touching external resources', () => withFixture(async db => {
  db.sqlite.exec(rollback);
  const existing = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_subjects'").get();
  assert.equal(existing, undefined);
}));
