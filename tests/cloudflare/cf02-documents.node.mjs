import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
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
    const now = Date.now();
    db.sqlite.prepare('INSERT INTO sync_replicas (uid, slot, replica_id, generation, lease_until_ms, checkpoint_at_ms, checkpoint_clock_json, last_seq, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      owner, replica.slot, replica.replicaId, 1, now + 86400000, now, '{}', 0, 'active');
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
    batchId, expectedRevision: rev, expectedFenceEpoch: 5, consentRevision: 1,
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

void test('replica control snapshot is owner-scoped and revision-bound', () => withFixture(async db => {
  const initial = await call(db, 'control', {});
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body, {
    revision: 0, fenceEpoch: 5, consentRevision: 1,
    replicas: { s00: {
      replicaId: replica.replicaId, generation: 1, leaseUntilMs: initial.body.replicas.s00.leaseUntilMs,
      checkpointAtMs: initial.body.replicas.s00.checkpointAtMs,
      checkpointClock: {}, lastSeq: 0, status: 'active',
    } },
  });
  assert.equal((await call(db, 'control', { uid: 'another-owner' })).status, 400);
  assert.equal((await call(db, 'control', {}, { env: makeEnv(db, { fenceEpoch: 4 }) })).status, 403);
  assert.equal((await call(db, 'control', {}, { env: makeEnv(db, { healthConsentRevision: 2 }) })).status, 403);
  assert.equal((await call(db, 'commit', attempt('batch000000000061'))).status, 200);
  const after = await call(db, 'control', {});
  assert.equal(after.body.revision, 1);
  assert.equal(after.body.replicas.s00.lastSeq, 1);
}));

void test('replica control includes all active/retired actors and their checkpoint clocks', () => withFixture(async db => {
  const now = Date.now();
  db.sqlite.prepare('UPDATE sync_replicas SET checkpoint_clock_json = ? WHERE uid = ? AND slot = ?')
    .run(JSON.stringify({ s00: 7, s01: 2 }), owner, 's00');
  db.sqlite.prepare('INSERT INTO sync_replicas (uid, slot, replica_id, generation, lease_until_ms, checkpoint_at_ms, checkpoint_clock_json, last_seq, status) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(owner, 's01', 'second-synthetic-device', 2, now + 86400000, now, '{"s00":4,"s01":2}', 2, 'active');
  db.sqlite.prepare('INSERT INTO sync_replicas (uid, slot, replica_id, generation, lease_until_ms, checkpoint_at_ms, checkpoint_clock_json, last_seq, status) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(owner, 's02', 'retired-synthetic-device', 3, now - 3000, now - 10000, '{"s00":99}', 9, 'retired');
  const control = await call(db, 'control', {});
  assert.equal(control.status, 200);
  assert.equal(Object.keys(control.body.replicas).length, 3);
  assert.deepEqual(control.body.replicas.s00.checkpointClock, { s00: 7, s01: 2 });
  assert.deepEqual(control.body.replicas.s01.checkpointClock, { s00: 4, s01: 2 });
  assert.equal(control.body.replicas.s02.status, 'retired');
}));

function claim(mutationId = 'mutation0000000001', revision = 0, candidateReplicaId = 'another-synthetic-device', clock = {}, currentReplica = null) {
  return {
    mutationId, expectedRevision: revision, expectedFenceEpoch: 5, consentRevision: 1,
    candidateReplicaId, currentReplica, checkpointClock: clock,
  };
}
function retire(mutationId, revision, target = replica) {
  return { mutationId, expectedRevision: revision, expectedFenceEpoch: 5, consentRevision: 1, replica: target };
}

void test('new replica enrollment commits one guarded registration and is replayable', () => withFixture(async db => {
  const input = claim('mutation0000000002');
  const created = await call(db, 'replica/claim', input);
  assert.equal(created.status, 200);
  assert.equal(created.body.action, 'register');
  assert.equal(created.body.revision, 1);
  assert.equal(created.body.baseSeq, 0);
  assert.equal(created.body.replica.slot, 's01');
  assert.equal(created.body.replica.generation, 1);
  assert.equal(created.body.replica.replicaId, input.candidateReplicaId);
  const receipt = await call(db, 'replica/claim', input);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.replayed, true);
  assert.deepEqual(receipt.body.replica, created.body.replica);
  assert.deepEqual(await call(db, 'replica/claim', { ...input, checkpointClock: { s00: 2 } }),
    { status: 409, body: { error: 'mutation-id-conflict' } });
  const registered = db.sqlite.prepare("SELECT status,last_seq FROM sync_replicas WHERE uid=? AND slot='s01'").get(owner);
  assert.deepEqual(registered, { status: 'active', last_seq: 0 });
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 1);

  const write = attempt('batch000000000073', 1, 1);
  write.replica = { slot: 's01', replicaId: input.candidateReplicaId, generation: 1 };
  write.documents[0].document._sync.writer = { ...write.replica, seq: 1, consentRevision: 1 };
  write.documents[0].document._sync.clock = { s01: 1 };
  assert.equal((await call(db, 'commit', write)).status, 200);
  assert.equal(db.sqlite.prepare("SELECT last_seq FROM sync_replicas WHERE uid=? AND slot='s01'").get(owner).last_seq, 1);
}));

void test('checkpoint matches the public causal clock, otherwise refuses to inflate frontier', () => withFixture(async db => {
  assert.equal((await call(db, 'commit', attempt('batch000000000074'))).status, 200);
  assert.deepEqual(await call(db, 'replica/claim', claim('mutation0000000003', 1, replica.replicaId, { s00: 999 }, replica)),
    { status: 409, body: { error: 'checkpoint-changed' } });
  assert.deepEqual(await call(db, 'replica/claim', claim('mutation0000000004', 1, replica.replicaId, { s99: 1 }, replica)),
    { status: 400, body: { error: 'invalid-input' } });
  const checkpoint = await call(db, 'replica/claim',
    claim('mutation0000000005', 1, replica.replicaId, { s00: 1 }, replica));
  assert.equal(checkpoint.status, 200);
  assert.equal(checkpoint.body.action, 'checkpoint');
  assert.equal(checkpoint.body.baseSeq, 1);
  assert.equal(checkpoint.body.revision, 2);
  assert.deepEqual(JSON.parse(db.sqlite.prepare("SELECT checkpoint_clock_json AS c FROM sync_replicas WHERE uid=? AND slot='s00'").get(owner).c),
    { s00: 1 });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_documents').get().n, 1);
}));

void test('same expected revision permits only one concurrent replica registration', () => withFixture(async (db, other) => {
  const [a, b] = await Promise.all([
    call(db, 'replica/claim', claim('mutation0000000006', 0, 'device-A')),
    call(other, 'replica/claim', claim('mutation0000000007', 0, 'device-B')),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas').get().n, 2);
}));

void test('retirement requires elapsed lease plus skew; reused slot fences old journal', () => withFixture(async db => {
  assert.deepEqual(await call(db, 'replica/retire', retire('mutation0000000008', 0)),
    { status: 409, body: { error: 'replica-fenced-or-conflict' } });
  db.sqlite.prepare("UPDATE sync_replicas SET lease_until_ms=? WHERE uid=? AND slot='s00'")
    .run(Date.now() - 400000, owner);
  const retired = await call(db, 'replica/retire', retire('mutation0000000009', 0));
  assert.equal(retired.status, 200);
  assert.equal(retired.body.action, 'retire');
  assert.equal(retired.body.revision, 1);
  assert.equal((await call(db, 'replica/retire', retire('mutation0000000009', 0))).body.replayed, true);
  assert.equal(db.sqlite.prepare("SELECT status FROM sync_replicas WHERE uid=? AND slot='s00'").get(owner).status, 'retired');
  assert.equal((await call(db, 'commit', attempt('batch000000000075', 1, 1))).status, 409);
  const now = Date.now();
  for (let i = 1; i < 16; i++) {
    db.sqlite.prepare('INSERT INTO sync_replicas (uid,slot,replica_id,generation,lease_until_ms,checkpoint_at_ms,checkpoint_clock_json,last_seq,status) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(owner, `s${String(i).padStart(2, '0')}`, `occupied-device-${i}`, 1, now + 86400000, now, '{}', 0, 'active');
  }
  const again = await call(db, 'replica/claim', claim('mutation0000000010', 1, 'new-device'));
  assert.equal(again.status, 200);
  assert.equal(again.body.action, 'reuse-expired');
  assert.equal(again.body.replica.slot, 's00');
  assert.equal(again.body.replica.generation, 2);
  assert.equal(db.sqlite.prepare("SELECT generation FROM sync_replicas WHERE uid=? AND slot='s00'").get(owner).generation, 2);
  assert.equal((await call(db, 'commit', attempt('batch000000000076', 1, 2))).status, 409);
}));

void test('account, consent, CSRF, lease and snapshot fences apply to replica maintenance', () => withFixture(async db => {
  const input = claim('mutation0000000011');
  assert.equal((await call(db, 'replica/claim', input, { env: { DB: db, API_ORIGIN: origin } })).status, 503);
  assert.equal((await call(db, 'replica/claim', input, { env: makeEnv(db, { csrfVerified: false }) })).status, 403);
  assert.equal((await call(db, 'replica/claim', input, { env: makeEnv(db, { fenceEpoch: 4 }) })).status, 403);
  assert.equal((await call(db, 'replica/claim', { ...input, expectedFenceEpoch: 4 })).status, 409);
  assert.equal((await call(db, 'replica/claim', { ...input, consentRevision: 2 })).status, 403);
  assert.equal((await call(db, 'replica/claim', { ...input, expectedRevision: 1 })).status, 409);
  assert.equal((await call(db, 'replica/claim', { ...input, checkpointClock: { s00: 1 } })).status, 409);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
  db.sqlite.prepare("UPDATE sync_subjects SET status = 'withdrawn' WHERE uid = ?").run(owner);
  assert.equal((await call(db, 'replica/claim', input)).status, 403);
  assert.equal((await call(db, 'replica/retire', retire('mutation0000000012', 0))).status, 403);
}));

void test('late D1 failure rolls back mutation receipt, membership and state', () => withFixture(async db => {
  db.sqlite.exec("CREATE TRIGGER synthetic_replica_rollback BEFORE INSERT ON sync_replicas BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  const result = await call(db, 'replica/claim', claim('mutation0000000013'));
  assert.deepEqual(result, { status: 503, body: { error: 'cloud-unavailable' } });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
}));

void test('lost acknowledgement of replica registration is recovered from durable mutation receipt', () => withFixture(async db => {
  const original = db.batch.bind(db);
  db.batch = async statements => {
    const result = await original(statements);
    if (statements.some(statement => statement.sql.startsWith('INSERT INTO sync_replica_mutations'))) {
      throw new Error('synthetic response loss after successful transaction');
    }
    return result;
  };
  const outcome = await call(db, 'replica/claim', claim('mutation0000000014'));
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.replayed, true);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 1);
}));

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

void test('real XChaCha20-Poly1305 ciphertext survives D1 HTTP save/read without business plaintext', () => withFixture(async db => {
  const key = new Uint8Array(32).fill(47);
  const nonce = new Uint8Array(24).fill(23);
  const path = 'nutrition_months/2026-11';
  const business = { '2026-11-12': { weight: 'synthetic-only-75' } };
  const sealed = envelope(1);
  const canonical = value => {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value !== null && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    }
    return JSON.stringify(value);
  };
  const aad = new TextEncoder().encode(canonical([
    'thelogbook-cloud-document', 1, owner, path, 1, sealed._sync,
  ]));
  const payload = new TextEncoder().encode(canonical({ business, fields: {} }));
  const encoded = bytes => Buffer.from(bytes).toString('base64url');
  sealed._sealed.nonce = encoded(nonce);
  sealed._sealed.ciphertext = encoded(xchacha20poly1305(key, nonce, aad).encrypt(payload));
  const write = attempt('batch000000000008', 1, 0, [path]);
  write.documents[0].document = sealed;
  assert.equal((await call(db, 'commit', write)).status, 200);
  const read = await call(db, 'read', { paths: [path] });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.documents[0].document, sealed);
  const ciphertext = Buffer.from(read.body.documents[0].document._sealed.ciphertext, 'base64url');
  const actual = xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(actual)), { business, fields: {} });
  const wrongPathAad = new TextEncoder().encode(canonical([
    'thelogbook-cloud-document', 1, owner, '', 1, sealed._sync,
  ]));
  assert.throws(() => xchacha20poly1305(key, nonce, wrongPathAad).decrypt(ciphertext));
  const raw = db.sqlite.prepare('SELECT envelope_json FROM sync_documents WHERE uid=? AND path=?').get(owner, path);
  assert.ok(raw.envelope_json.includes('_sealed'));
  assert.ok(!raw.envelope_json.includes('synthetic-only-75'));
}));

void test('paginated checkpoint covers every root/month document at one revision', () => withFixture(async db => {
  const paths = ['', ...Array.from({ length: 10 }, (_, index) =>
    `history_months/2026-${String(index + 1).padStart(2, '0')}`)];
  const first = attempt('batch000000000021', 1, 0, paths.slice(0, 8));
  const second = attempt('batch000000000022', 2, 1, paths.slice(8));
  assert.equal((await call(db, 'commit', first)).status, 200);
  assert.equal((await call(db, 'commit', second)).status, 200);
  const p1 = await call(db, 'scan', { after: null, expectedRevision: null });
  assert.equal(p1.status, 200);
  assert.equal(p1.body.revision, 2);
  assert.equal(p1.body.documents.length, 8);
  assert.equal(p1.body.complete, false);
  assert.equal(p1.body.nextAfter, p1.body.documents.at(-1).path);
  const p2 = await call(db, 'scan', { after: p1.body.nextAfter, expectedRevision: p1.body.revision });
  assert.equal(p2.status, 200);
  assert.equal(p2.body.documents.length, 3);
  assert.equal(p2.body.complete, true);
  assert.equal(p2.body.nextAfter, null);
  assert.deepEqual([...p1.body.documents, ...p2.body.documents].map(doc => doc.path),
    [...paths].sort());
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM sync_documents').get().n, 11);
}));

void test('a concurrent write or changed consent fences an incomplete paginated checkpoint', () => withFixture(async db => {
  const paths = ['', ...Array.from({ length: 8 }, (_, index) =>
    `nutrition_months/2026-${String(index + 1).padStart(2, '0')}`)];
  assert.equal((await call(db, 'commit', attempt('batch000000000023', 1, 0, paths.slice(0, 8)))).status, 200);
  assert.equal((await call(db, 'commit', attempt('batch000000000024', 2, 1, paths.slice(8)))).status, 200);
  const p1 = await call(db, 'scan', { after: null, expectedRevision: null });
  assert.equal(p1.body.complete, false);
  assert.equal((await call(db, 'commit',
    attempt('batch000000000025', 3, 2, ['history_months/2025-12']))).status, 200);
  const stale = await call(db, 'scan',
    { after: p1.body.nextAfter, expectedRevision: p1.body.revision });
  assert.deepEqual(stale, { status: 409, body: { error: 'snapshot-changed' } });
  assert.equal((await call(db, 'scan', { after: '', expectedRevision: null })).status, 400);
  db.sqlite.prepare('UPDATE sync_subjects SET consent_revision = 2 WHERE uid = ?').run(owner);
  assert.equal((await call(db, 'scan', { after: null, expectedRevision: null })).status, 403);
  assert.equal((await call(db, 'scan', { after: p1.body.nextAfter, expectedRevision: 2 })).status, 403);
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

void test('idempotent new Protocol 3 batch may advance a revision without increasing lastSeq', () => withFixture(async db => {
  const first = attempt('batch000000000031', 1, 0);
  const second = attempt('batch000000000032', 1, 1);
  assert.equal((await call(db, 'commit', first)).status, 200);
  assert.equal((await call(db, 'commit', second)).status, 200);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 2);
  assert.equal(db.sqlite.prepare('SELECT last_seq FROM sync_replicas').get().last_seq, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM sync_receipts').get().n, 2);
}));

void test('SQL schema refuses invalid months and malformed checkpoint clocks', () => withFixture(async db => {
  assert.throws(() => db.sqlite.prepare('UPDATE sync_replicas SET checkpoint_clock_json=?').run('not-json'));
  assert.throws(() => db.sqlite.prepare('INSERT INTO sync_documents (uid,path,envelope_json,revision) VALUES (?,?,?,?)')
    .run(owner, 'history_months/2026-19', '{}', 1));
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM sync_documents').get().n, 0);
}));

void test('database constraints forbid revision, actor and sequence regression', () => withFixture(async db => {
  assert.throws(() => db.sqlite.prepare('UPDATE sync_state SET revision = 0 WHERE uid = ?').run(owner),
    /sync-revision-regression/);
  db.sqlite.prepare('UPDATE sync_state SET revision = 1 WHERE uid = ?').run(owner);
  assert.throws(() => db.sqlite.prepare('UPDATE sync_state SET revision = 0 WHERE uid = ?').run(owner),
    /sync-revision-regression/);
  db.sqlite.prepare('UPDATE sync_replicas SET last_seq = 5 WHERE uid = ? AND slot = ?')
    .run(owner, replica.slot);
  assert.throws(() => db.sqlite.prepare('UPDATE sync_replicas SET last_seq = 4 WHERE uid = ? AND slot = ?')
    .run(owner, replica.slot), /replica-regression/);
  db.sqlite.prepare("UPDATE sync_replicas SET status = 'retired' WHERE uid = ? AND slot = ?")
    .run(owner, replica.slot);
  assert.throws(() => db.sqlite.prepare("UPDATE sync_replicas SET status = 'active' WHERE uid = ? AND slot = ?")
    .run(owner, replica.slot), /replica-regression/);
  db.sqlite.prepare("UPDATE sync_replicas SET generation = 2, status = 'active' WHERE uid = ? AND slot = ?")
    .run(owner, replica.slot);
  assert.equal(db.sqlite.prepare('SELECT last_seq FROM sync_replicas WHERE uid = ?').get(owner).last_seq, 5);
}));

void test('account epoch change revokes receipt lookup instead of implying an absent ACK', () => withFixture(async db => {
  const batch = attempt('batch000000000065');
  assert.equal((await call(db, 'commit', batch)).status, 200);
  db.sqlite.prepare('UPDATE sync_subjects SET fence_epoch = 6 WHERE uid = ?').run(owner);
  assert.deepEqual(await call(db, 'receipt', { batchId: batch.batchId }),
    { status: 403, body: { error: 'access-revoked' } });
  const newSession = await call(db, 'receipt', { batchId: batch.batchId },
    { env: makeEnv(db, { fenceEpoch: 6 }) });
  assert.deepEqual(newSession, { status: 200, body: { receipt: null } });
}));

void test('old consent receipts are never visible after trusted reacceptance', () => withFixture(async db => {
  const batch = attempt('batch000000000066');
  assert.equal((await call(db, 'commit', batch)).status, 200);
  db.sqlite.prepare('UPDATE sync_subjects SET consent_revision = 2 WHERE uid = ?').run(owner);
  assert.deepEqual(await call(db, 'receipt', { batchId: batch.batchId }),
    { status: 403, body: { error: 'access-revoked' } });
  assert.deepEqual(await call(db, 'receipt', { batchId: batch.batchId },
    { env: makeEnv(db, { healthConsentRevision: 2 }) }),
    { status: 200, body: { receipt: null } });
}));

void test('a batch from an erased account epoch cannot resurrect data at reset revision', () => withFixture(async db => {
  const stale = attempt('batch000000000035', 1, 0);
  db.sqlite.prepare('UPDATE sync_subjects SET fence_epoch = 6 WHERE uid = ?').run(owner);
  const result = await call(db, 'commit', stale, { env: makeEnv(db, { fenceEpoch: 6 }) });
  assert.deepEqual(result, { status: 409, body: { error: 'replica-fenced-or-conflict' } });
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM sync_receipts').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM sync_documents').get().n, 0);
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
  const throttled = { DB: db, API_ORIGIN: origin,
    AUTH_GATE: { fetch: async () => new Response(null, { status: 429 }) } };
  assert.deepEqual(await call(db, 'commit', item, { env: throttled }),
    { status: 429, body: { error: 'rate-limited' } });
  assert.equal((await call(db, 'commit', item, { headers: { Origin: 'https://evil.invalid' } })).status, 403);
  const alternateHost = await worker.fetch(new Request('https://shadow.workers.dev/v1/sync/commit', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(item),
  }), makeEnv(db));
  assert.equal(alternateHost.status, 403);
  assert.equal((await call(db, 'commit', item, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await call(db, 'commit', item, { env: makeEnv(db, { csrfVerified: false }) })).status, 403);
  assert.equal((await call(db, 'commit', item, { env: makeEnv(db, { rateGatePassed: false }) })).status, 503);
  assert.equal((await call(db, 'commit', item, { env: makeEnv(db, { fenceEpoch: 4 }) })).status, 409);
  assert.equal((await call(db, 'commit', { ...item, expectedFenceEpoch: 4 })).status, 409);
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

void test('oversized streamed bodies fail with 413 before any D1 mutation', () => withFixture(async db => {
  const largeBody = JSON.stringify({ data: 'X'.repeat(1800001) });
  const response = await worker.fetch(new Request(origin + '/v1/sync/commit', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: largeBody,
  }), makeEnv(db));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'payload-too-large');
  assert.equal(db.sqlite.prepare('SELECT count(*) as n FROM sync_receipts').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
}));

void test('isolated migration has an explicit rollback, without touching external resources', () => withFixture(async db => {
  db.sqlite.exec(rollback);
  const existing = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_subjects'").get();
  assert.equal(existing, undefined);
}));
