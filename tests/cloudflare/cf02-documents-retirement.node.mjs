import assert from 'node:assert/strict';
import { test } from 'node:test';
import { origin, owner, withFixture, attempt, makeEnv, call, claim, retire } from './cf02-documents-fixture.mjs';

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
      .run(owner, `s${String(i).padStart(2, '0')}`, `occupied-device-${i}`, 1, now - 600000, now - 86400000, '{}', 0, 'active');
  }
  const again = await call(db, 'replica/claim', claim('mutation0000000010', 1, 'new-device'));
  assert.equal(again.status, 200);
  assert.equal(again.body.action, 'reuse-expired');
  assert.equal(again.body.replica.slot, 's00');
  assert.equal(again.body.replica.generation, 2);
  assert.equal(db.sqlite.prepare("SELECT generation FROM sync_replicas WHERE uid=? AND slot='s00'").get(owner).generation, 2);
  assert.equal((await call(db, 'commit', attempt('batch000000000076', 1, 2))).status, 409);
}));

void test('slot reuse carries a committed sequence across generations without reviving the old writer', () => withFixture(async db => {
  const committed = attempt('old-replica-sequence-02', 2, 0);
  assert.equal((await call(db, 'commit', committed)).status, 200);
  assert.equal(db.sqlite.prepare("SELECT last_seq FROM sync_replicas WHERE uid=? AND slot='s00'").get(owner).last_seq, 2);
  const originalReceipt = (await call(db, 'receipt', { batchId: committed.batchId })).body.receipt;
  assert.equal(originalReceipt.revision, 1);
  assert.equal(originalReceipt.lastSeq, 2);
  assert.deepEqual(originalReceipt.replica, committed.replica);
  assert.match(originalReceipt.requestHash, /^[a-f0-9]{64}$/);

  db.sqlite.prepare("UPDATE sync_replicas SET lease_until_ms=? WHERE uid=? AND slot='s00'")
    .run(Date.now() - 600000, owner);
  const retired = await call(db, 'replica/retire', retire('retire-old-sequence-02', 1));
  assert.equal(retired.status, 200);
  assert.equal(retired.body.baseSeq, 2);

  const now = Date.now();
  for (let i = 1; i < 16; i++) {
    db.sqlite.prepare('INSERT INTO sync_replicas (uid,slot,replica_id,generation,lease_until_ms,checkpoint_at_ms,checkpoint_clock_json,last_seq,status) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(owner, `s${String(i).padStart(2, '0')}`, `occupied-device-${i}`, 1,
        now - 600000, now - 86400000, '{}', 0, 'active');
  }
  const successor = await call(db, 'replica/claim', claim('claim-new-sequence-02', 2, 'successor-device', { s00: 2 }));
  assert.equal(successor.status, 200);
  assert.equal(successor.body.action, 'reuse-expired');
  assert.equal(successor.body.replica.slot, 's00');
  assert.equal(successor.body.replica.generation, 2);
  assert.equal(successor.body.baseSeq, 2);
  assert.equal(db.sqlite.prepare("SELECT last_seq FROM sync_replicas WHERE uid=? AND slot='s00'").get(owner).last_seq, 2);
  // A retired device can query the original immutable receipt, but its old
  // identity is not a grant to write after the successor takes its slot.
  assert.deepEqual((await call(db, 'receipt', { batchId: committed.batchId })).body.receipt, originalReceipt);

  // The old receipt is durable historical evidence, not a renewed writer grant.
  const replay = await call(db, 'commit', committed);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.revision, 1);
  assert.equal((await call(db, 'commit', attempt('old-replica-after-reuse', 3, 3))).status, 409);

  const next = attempt('successor-sequence-03', 3, 3);
  next.replica = { slot: successor.body.replica.slot,
    replicaId: successor.body.replica.replicaId,
    generation: successor.body.replica.generation };
  next.documents[0].document._sync.writer = { ...next.replica, seq: 3, consentRevision: 1 };
  const saved = await call(db, 'commit', next);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 4);
  assert.equal(saved.body.lastSeq, 3);
  assert.equal(db.sqlite.prepare("SELECT last_seq FROM sync_replicas WHERE uid=? AND slot='s00'").get(owner).last_seq, 3);
  assert.deepEqual((await call(db, 'receipt', { batchId: committed.batchId })).body.receipt, originalReceipt);
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
  const originalRequest = claim('mutation0000000014');
  const outcome = await call(db, 'replica/claim', originalRequest);
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.replayed, true);
  assert.equal(outcome.body.mutationId, originalRequest.mutationId);
  assert.equal(outcome.body.replica.replicaId, originalRequest.candidateReplicaId);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 1);
  const persisted = db.sqlite.prepare('SELECT mutation_id, replica_id FROM sync_replica_mutations').get();
  assert.equal(persisted.mutation_id, originalRequest.mutationId);
  assert.equal(persisted.replica_id, originalRequest.candidateReplicaId);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 1);
}));

void test('explicit retirement is exact, session-fenced and replayable without deleting data or sessions', () => withFixture(async db => {
  assert.equal((await call(db, 'commit', attempt('batch-explicit-retire-01'))).status, 200);
  const control = (await call(db, 'control', {})).body;
  const { lastSeq, checkpointAtMs, leaseUntilMs } = control.replicas.s00;
  const input = { ...retire('explicit-retirement-01', 1), confirmation: { lastSeq, checkpointAtMs, leaseUntilMs } };
  assert.equal((await call(db, 'replica/retire', retire('automatic-retirement-1', 1))).status, 409);
  assert.equal((await call(db, 'replica/retire', { ...input, confirmation: true })).status, 400);
  assert.equal((await call(db, 'replica/retire', { ...input, confirmation: { ...input.confirmation, lastSeq: lastSeq + 1 } })).status, 409);
  assert.equal((await call(db, 'replica/retire', { ...input, expectedRevision: 0 })).status, 409);
  assert.equal((await call(db, 'replica/retire', input, { env: makeEnv(db, { csrfVerified: false }) })).status, 403);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);

  // Simulate a stale control at the SQL boundary, independently of the
  // Worker's snapshot/revision check. An exact witness is required in D1.
  const original = db.batch.bind(db);
  db.batch = async statements => {
    if (statements[0]?.sql.includes('INSERT INTO sync_replica_mutations')) {
      db.sqlite.prepare("UPDATE sync_replicas SET lease_until_ms=lease_until_ms+1 WHERE uid=? AND slot='s00'").run(owner);
    }
    return original(statements);
  };
  assert.equal((await call(db, 'replica/retire', input)).status, 409);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
  assert.equal(db.sqlite.prepare("SELECT status FROM sync_replicas WHERE uid=? AND slot='s00'").get(owner).status, 'active');
  db.batch = original;
  const latest = (await call(db, 'control', {})).body.replicas.s00;
  const confirmed = { ...input, confirmation: { lastSeq: latest.lastSeq, checkpointAtMs: latest.checkpointAtMs, leaseUntilMs: latest.leaseUntilMs } };
  db.batch = async statements => {
    const result = await original(statements);
    if (statements[0]?.sql.includes('INSERT INTO sync_replica_mutations')) {
      throw new Error('synthetic explicit retirement response lost after commit');
    }
    return result;
  };
  const removed = await call(db, 'replica/retire', confirmed);
  db.batch = original;
  assert.equal(removed.status, 200);
  assert.equal(removed.body.replayed, true);
  assert.equal(removed.body.action, 'retire');
  assert.equal(removed.body.baseSeq, lastSeq);
  assert.equal(removed.body.revision, 2);
  assert.equal(db.sqlite.prepare('SELECT retirement_mode FROM sync_replica_mutations').get().retirement_mode, 'explicit');
  assert.equal((await call(db, 'replica/retire', confirmed)).body.replayed, true);
  assert.deepEqual(await call(db, 'replica/status', confirmed), { status: 200, body: { outcome: 'committed', currentRevision: 2 } });
  assert.deepEqual(await call(db, 'replica/retire', input), { status: 409, body: { error: 'mutation-id-conflict' } });
  assert.equal((await call(db, 'commit', attempt('batch-after-retire-001', 2, 2))).status, 409);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_documents').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 1);
  assert.equal((await call(db, 'control', {})).status, 200);
  const next = await call(db, 'replica/claim', claim('claim-after-retire-001', 2, 'new-active-device', { s00: 1 }));
  assert.equal(next.status, 200);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 2);
}));
