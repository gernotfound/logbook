import assert from 'node:assert/strict';
import { test } from 'node:test';
import { owner, replica, withFixture, attempt, makeEnv, call, claim, retire } from './cf02-documents-fixture.mjs';

void test('replica control snapshot is owner-scoped and revision-bound', () => withFixture(async db => {
  const initial = await call(db, 'control', {});
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body, {
    uid: owner, revision: 0, fenceEpoch: 5, consentRevision: 1,
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
  assert.equal(receipt.body.currentRevision, 1);
  assert.equal(receipt.body.reconciliationRequired, false);
  assert.deepEqual(receipt.body.replica, created.body.replica);
  assert.deepEqual(await call(db, 'replica/claim', { ...input, checkpointClock: { s00: 2 } }),
    { status: 409, body: { error: 'mutation-id-conflict' } });
  const registered = db.sqlite.prepare("SELECT status,last_seq FROM sync_replicas WHERE uid=? AND slot='s01'").get(owner);
  assert.equal(registered.status, 'active');
  assert.equal(registered.last_seq, 0);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 1);

  const write = attempt('batch000000000073', 1, 1);
  write.replica = { slot: 's01', replicaId: input.candidateReplicaId, generation: 1 };
  write.documents[0].document._sync.writer = { ...write.replica, seq: 1, consentRevision: 1 };
  write.documents[0].document._sync.clock = { s01: 1 };
  assert.equal((await call(db, 'commit', write)).status, 200);
  assert.equal(db.sqlite.prepare("SELECT last_seq FROM sync_replicas WHERE uid=? AND slot='s01'").get(owner).last_seq, 1);
}));

void test('a retired replica ID cannot rejoin after its slot is reused by a new generation', () => withFixture(async db => {
  const identityIndex = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sync_replica_mutations' AND name = 'sync_replica_history_identity'").get();
  assert.equal(identityIndex?.name, 'sync_replica_history_identity');
  const oldId = 'prior-replica-id-0001';
  const first = await call(db, 'replica/claim', claim('mutation0000000600', 0, oldId));
  assert.equal(first.status, 200);
  assert.equal(first.body.replica.slot, 's01');

  // Age the lease rather than bypassing the actual retirement and reuse
  // APIs; the immutable receipt remains authoritative throughout the test.
  const now = Date.now();
  db.sqlite.prepare("UPDATE sync_replicas SET lease_until_ms = ? WHERE uid = ? AND slot = 's01'")
    .run(now - 600000, owner);
  const oldReplica = { slot: 's01', replicaId: oldId, generation: 1 };
  const retired = await call(db, 'replica/retire', retire('mutation0000000601', 1, oldReplica));
  assert.equal(retired.status, 200);
  assert.equal(retired.body.revision, 2);

  // Other synthetic device memberships have filled the register, so the
  // real claim endpoint must choose the retired s01 slot (generation 2).
  for (let i = 2; i < 16; i += 1) {
    db.sqlite.prepare('INSERT INTO sync_replicas (uid,slot,replica_id,generation,lease_until_ms,checkpoint_at_ms,checkpoint_clock_json,last_seq,status) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(owner, `s${String(i).padStart(2, '0')}`, `occupied-device-${i}`, 1,
        now - 600000, now - 86400000, '{}', 0, 'active');
  }
  const replacement = await call(db, 'replica/claim', claim('mutation0000000602', 2, 'successor-device-0001'));
  assert.equal(replacement.status, 200);
  assert.equal(replacement.body.action, 'reuse-expired');
  assert.equal(replacement.body.replica.slot, 's01');
  assert.equal(replacement.body.replica.generation, 2);

  // Old ID is absent from the live register, but its historical ledger row
  // must still prevent reuse at the other expired slot.
  const rejected = await call(db, 'replica/claim', claim('mutation0000000603', 3, oldId));
  assert.deepEqual(rejected, { status: 409, body: { error: 'replica-fenced-or-conflict' } });
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state WHERE uid = ?').get(owner).revision, 3);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations WHERE uid = ?').get(owner).n, 3);

  const fresh = await call(db, 'replica/claim', claim('mutation0000000604', 3, 'fresh-device-0001'));
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.action, 'reuse-expired');
  assert.equal(fresh.body.replica.slot, 's02');
  assert.equal(fresh.body.replica.generation, 2);
}));

void test('a committed registration can be checkpointed under a new mutation after independent cloud writes', () => withFixture(async db => {
  const first = claim('mutation0000000700', 0, 'resume-same-device-0001');
  const registered = await call(db, 'replica/claim', first);
  assert.equal(registered.status, 200);
  assert.equal(registered.body.action, 'register');
  assert.equal(registered.body.replica.slot, 's01');

  // A different writer advances the document clock and global revision.
  // The original new device has not adopted its slot and still sends null
  // currentReplica, but must checkpoint the same live registered identity.
  assert.equal((await call(db, 'commit', attempt('batch000000000700', 1, 1))).status, 200);
  const restaged = claim('mutation0000000701', 2, first.candidateReplicaId, { s00: 1 }, null);
  const recovered = await call(db, 'replica/claim', restaged);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.action, 'checkpoint');
  assert.equal(recovered.body.revision, 3);
  assert.equal(recovered.body.baseSeq, 0);
  assert.equal(recovered.body.replica.slot, registered.body.replica.slot);
  assert.equal(recovered.body.replica.replicaId, registered.body.replica.replicaId);
  assert.equal(recovered.body.replica.generation, registered.body.replica.generation);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas WHERE uid = ?').get(owner).n, 2);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state WHERE uid = ?').get(owner).revision, 3);
  const replayedOriginal = await call(db, 'replica/claim', first);
  assert.equal(replayedOriginal.status, 200);
  assert.equal(replayedOriginal.body.replayed, true);
  assert.equal(replayedOriginal.body.reconciliationRequired, true);
  assert.equal(replayedOriginal.body.currentRevision, 3);
}));

void test('lost claim reply after a concurrent write returns historical proof, not a fresh replica grant', () => withFixture(async db => {
  const input = claim('mutation0000000101', 0, 'device-replay-safe');
  const registered = await call(db, 'replica/claim', input);
  assert.equal(registered.status, 200);
  assert.equal(registered.body.reconciliationRequired, false);
  assert.equal((await call(db, 'commit', attempt('batch000000000081', 1, 1))).status, 200);
  const stale = await call(db, 'replica/claim', input);
  assert.equal(stale.status, 200);
  assert.equal(stale.body.replayed, true);
  assert.equal(stale.body.revision, 1);
  assert.equal(stale.body.currentRevision, 2);
  assert.equal(stale.body.reconciliationRequired, true);
  assert.deepEqual(stale.body.replica, registered.body.replica);
  assert.deepEqual(await call(db, 'replica/claim', { ...input, candidateReplicaId: 'collision-device' }),
    { status: 409, body: { error: 'mutation-id-conflict' } });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 2);

  // The original mutation is still historical proof after its slot is reused.
  db.sqlite.prepare("UPDATE sync_replicas SET status = 'retired' WHERE uid = ? AND slot = 's01'").run(owner);
  db.sqlite.prepare("UPDATE sync_replicas SET replica_id = 'replacement-device', generation = 2, status = 'active' WHERE uid = ? AND slot = 's01'").run(owner);
  const reused = await call(db, 'replica/claim', input);
  assert.equal(reused.body.reconciliationRequired, true);
  assert.equal(reused.body.currentRevision, 2);
  assert.equal(reused.body.replica.replicaId, 'device-replay-safe');
  // No action on an out-of-epoch or revoked identity can replay the receipt.
  db.sqlite.prepare('UPDATE sync_subjects SET status = ? WHERE uid = ?').run('withdrawn', owner);
  assert.equal((await call(db, 'replica/claim', input)).status, 403);
}));

void test('lost retirement reply after unrelated revision requires reconciliation, not stale retirement adoption', () => withFixture(async db => {
  db.sqlite.prepare("UPDATE sync_replicas SET lease_until_ms = ? WHERE uid = ? AND slot = ?")
    .run(Date.now() - 400000, owner, replica.slot);
  const input = retire('mutation0000000102', 0);
  const first = await call(db, 'replica/retire', input);
  assert.equal(first.status, 200);
  assert.equal(first.body.reconciliationRequired, false);
  const next = await call(db, 'replica/claim', claim('mutation0000000103', 1, 'second-device'));
  assert.equal(next.status, 200);
  const replay = await call(db, 'replica/retire', input);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.currentRevision, 2);
  assert.equal(replay.body.reconciliationRequired, true);
  assert.equal(replay.body.action, 'retire');
  assert.equal(db.sqlite.prepare("SELECT status FROM sync_replicas WHERE uid = ? AND slot = 's00'").get(owner).status, 'retired');
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

void test('five live memberships are atomic across two connections, preserve historical proof and fence direct writes', () => withFixture(async (db, second) => {
  for (let i = 1; i <= 3; i += 1) {
    const outcome = await call(db, 'replica/claim', claim('capacity-mutation-' + i, i - 1, 'capacity-device-' + i));
    assert.equal(outcome.status, 200);
  }
  const fifth = [claim('capacity-race-first', 3, 'capacity-first-device'),
    claim('capacity-race-second', 3, 'capacity-second-device')];
  const outcomes = await Promise.all([call(db, 'replica/claim', fifth[0]), call(second, 'replica/claim', fifth[1])]);
  assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409]);
  const winner = outcomes.findIndex(r => r.status === 200);
  const receipt = await call(db, 'replica/claim', fifth[winner]);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.replayed, true);
  const count = () => db.sqlite.prepare("SELECT COUNT(*) AS n FROM sync_replicas WHERE uid=? AND status='active' AND lease_until_ms+300000 >= ?").get(owner, Date.now()).n;
  assert.equal(count(), 5);
  const sixth = claim('capacity-sixth-attempt', 4, 'capacity-sixth-device');
  assert.deepEqual(await call(second, 'replica/claim', sixth), { status: 409, body: { error: 'replica-capacity' } });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 4);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 4);
  const renewed = await call(db, 'replica/claim', claim('capacity-renew-first', 4, fifth[winner].candidateReplicaId));
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.action, 'checkpoint');
  assert.equal(count(), 5);
  const now = Date.now();
  const insert = db.sqlite.prepare("INSERT INTO sync_replicas VALUES (?, 's15', 'direct-capacity-device', 1, ?, ?, '{}', 0, ?)");
  assert.throws(() => insert.run(owner, now + 86400000, now, 'active'), /replica-capacity/);
  insert.run(owner, now - 600000, now - 86400000, 'active');
  assert.throws(() => db.sqlite.prepare("UPDATE sync_replicas SET lease_until_ms=? WHERE uid=? AND slot='s15'").run(now + 86400000, owner), /replica-capacity/);
  assert.equal(count(), 5);
  // A lease beyond its skew margin frees a place; the historical actor stays.
  db.sqlite.prepare("UPDATE sync_replicas SET lease_until_ms=? WHERE uid=? AND slot='s01'").run(now - 600000, owner);
  assert.equal(count(), 4);
  const replacement = await call(db, 'replica/claim', { ...sixth, mutationId: 'capacity-sixth-rebased', expectedRevision: 5 });
  assert.equal(replacement.status, 200);
  assert.equal(count(), 5);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sync_replicas WHERE uid=? AND slot='s15'").get(owner).n, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 6);
}));
