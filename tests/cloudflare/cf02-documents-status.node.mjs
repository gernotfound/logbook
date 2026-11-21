import assert from 'node:assert/strict';
import { test } from 'node:test';
import { origin, owner, withFixture, makeEnv, call, claim, retire } from './cf02-documents-fixture.mjs';

void test('primary D1 claim outcome proves non-commit only after irreversible revision advance', () => withFixture(async db => {
  const old = claim('mutation0000000400', 0, 'device-not-registered');
  assert.deepEqual(await call(db, 'replica/status', old),
    { status: 200, body: { outcome: 'inconclusive', currentRevision: 0 } });
  assert.equal((await call(db, 'replica/claim', claim('mutation0000000401', 0, 'other-device'))).status, 200);
  assert.deepEqual(await call(db, 'replica/claim', old),
    { status: 409, body: { error: 'replica-fenced-or-conflict' } });
  assert.deepEqual(await call(db, 'replica/status', old),
    { status: 200, body: { outcome: 'not-committed', currentRevision: 1 } });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations WHERE mutation_id = ?')
    .get(old.mutationId).n, 0);
  // The original stale CAS cannot subsequently register a second replica.
  assert.equal((await call(db, 'replica/claim', old)).status, 409);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas').get().n, 2);
}));

void test('a committed original mutation never reports not-committed after another revision', () => withFixture(async db => {
  const original = claim('mutation0000000410', 0, 'first-device');
  assert.equal((await call(db, 'replica/claim', original)).status, 200);
  assert.deepEqual(await call(db, 'replica/status', original),
    { status: 200, body: { outcome: 'committed', currentRevision: 1 } });
  assert.equal((await call(db, 'replica/claim', claim('mutation0000000411', 1, 'second-device'))).status, 200);
  assert.deepEqual(await call(db, 'replica/status', original),
    { status: 200, body: { outcome: 'committed', currentRevision: 2 } });
  assert.deepEqual(await call(db, 'replica/status', { ...original, candidateReplicaId: 'forged-device' }),
    { status: 409, body: { error: 'mutation-id-conflict' } });
  assert.equal((await call(db, 'replica/claim', original)).body.replayed, true);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 2);
}));

void test('claim non-commit proof is strictly session/consent/CSRF-gated and requires a primary', () => withFixture(async db => {
  const original = claim('mutation0000000420', 0, 'new-device');
  assert.equal((await call(db, 'replica/status', original, { env: { DB: db, API_ORIGIN: origin } })).status, 503);
  assert.equal((await call(db, 'replica/status', original, { env: makeEnv(db, { csrfVerified: false }) })).status, 403);
  assert.equal((await call(db, 'replica/status', { ...original, consentRevision: 2 })).status, 403);
  assert.equal((await call(db, 'replica/status', { ...original, expectedFenceEpoch: 7 })).status, 403);
  assert.equal((await call(db, 'replica/status', { ...original, mutationId: 'tiny' })).status, 400);
  const withSession = db.withSession;
  db.withSession = undefined;
  assert.deepEqual(await call(db, 'replica/status', original),
    { status: 503, body: { error: 'cloud-unavailable' } });
  db.withSession = withSession;
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
}));

void test('retirement status on the primary distinguishes absent, committed and hash-conflicted mutations', () => withFixture(async db => {
  db.sqlite.prepare("UPDATE sync_replicas SET lease_until_ms = ? WHERE uid = ? AND slot = 's00'")
    .run(Date.now() - 600000, owner);
  const old = retire('mutation0000000500', 0);
  assert.deepEqual(await call(db, 'replica/status', old),
    { status: 200, body: { outcome: 'inconclusive', currentRevision: 0 } });
  assert.equal((await call(db, 'replica/claim', claim('mutation0000000501', 0, 'other-device'))).status, 200);
  assert.deepEqual(await call(db, 'replica/retire', old),
    { status: 409, body: { error: 'replica-fenced-or-conflict' } });
  assert.deepEqual(await call(db, 'replica/status', old),
    { status: 200, body: { outcome: 'not-committed', currentRevision: 1 } });
  // Once the old CAS cannot commit, a new mutation at revision 1 may retire
  // the original incarnation while leaving unrelated memberships untouched.
  const next = retire('mutation0000000502', 1);
  const saved = await call(db, 'replica/retire', next);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.action, 'retire');
  assert.equal(saved.body.revision, 2);
  assert.deepEqual(await call(db, 'replica/status', next),
    { status: 200, body: { outcome: 'committed', currentRevision: 2 } });
  assert.deepEqual(await call(db, 'replica/status', old),
    { status: 200, body: { outcome: 'not-committed', currentRevision: 2 } });
  assert.deepEqual(await call(db, 'replica/status', { ...next, replica: {
    ...next.replica, generation: 2,
  } }), { status: 409, body: { error: 'mutation-id-conflict' } });
  assert.equal(db.sqlite.prepare("SELECT status FROM sync_replicas WHERE uid = ? AND slot = 's00'")
    .get(owner).status, 'retired');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 2);
}));

void test('retirement status rejects ambiguous shapes, stale consent and unauthenticated clients', () => withFixture(async db => {
  const old = retire('mutation0000000510', 0);
  assert.equal((await call(db, 'replica/status', { ...old, checkpointClock: {} })).status, 400);
  assert.equal((await call(db, 'replica/status', { ...old, replica: {
    ...old.replica, slot: 's99',
  } })).status, 400);
  assert.equal((await call(db, 'replica/status', old, { env: { DB: db, API_ORIGIN: origin } })).status, 503);
  assert.equal((await call(db, 'replica/status', old, {
    env: makeEnv(db, { csrfVerified: false }),
  })).status, 403);
  assert.equal((await call(db, 'replica/status', { ...old, consentRevision: 2 })).status, 403);
  assert.equal((await call(db, 'replica/status', { ...old, expectedFenceEpoch: 6 })).status, 403);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
}));
