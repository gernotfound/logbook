import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syntheticSessionHash, owner, independentDatabases, withFixture, attempt, makeEnv, call, claim } from './cf02-documents-fixture.mjs';

void test('a logout racing after AuthGate cannot commit ciphertext or its receipt', () => withFixture(async db => {
  const intercepted = Object.create(db);
  intercepted.batch = async statements => {
    if (statements[0]?.sql.includes('INSERT INTO sync_receipts')) {
      db.sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms = ? WHERE token_hash = ?')
        .run(Date.now(), syntheticSessionHash);
    }
    return db.batch(statements);
  };
  const result = await call(db, 'commit', attempt('batch000000000991'), {
    env: { ...makeEnv(db), DB: intercepted },
  });
  assert.deepEqual(result, { status: 403, body: { error: 'access-revoked' } });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_documents').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
}));

void test('a logout racing after AuthGate cannot mutate replica membership', () => withFixture(async db => {
  const intercepted = Object.create(db);
  intercepted.batch = async statements => {
    if (statements[0]?.sql.includes('INSERT INTO sync_replica_mutations')) {
      db.sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms = ? WHERE token_hash = ?')
        .run(Date.now(), syntheticSessionHash);
    }
    return db.batch(statements);
  };
  const result = await call(db, 'replica/claim', claim('mutation0000000991'), {
    env: { ...makeEnv(db), DB: intercepted },
  });
  assert.deepEqual(result, { status: 403, body: { error: 'access-revoked' } });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
}));

void test('an expired or foreign session digest cannot authorize a D1 write', () => withFixture(async db => {
  const forged = await call(db, 'commit', attempt('batch000000000992'), {
    env: makeEnv(db, { sessionHash: 'f'.repeat(64) }),
  });
  assert.equal(forged.status, 403);
  const intercepted = Object.create(db);
  intercepted.batch = async statements => {
    if (statements[0]?.sql.includes('INSERT INTO sync_receipts')) {
      db.sqlite.prepare('UPDATE auth_sessions SET idle_expires_at_ms = issued_at_ms + 1, absolute_expires_at_ms = issued_at_ms + 2 WHERE token_hash = ?')
        .run(syntheticSessionHash);
    }
    return db.batch(statements);
  };
  const expired = await call(db, 'commit', attempt('batch000000000993'), {
    env: { ...makeEnv(db), DB: intercepted },
  });
  assert.equal(expired.status, 403);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
}));

void test('missing trusted session digest rejects mutations before D1', () => withFixture(async db => {
  const noDigest = await call(db, 'commit', attempt('batch000000000994'), {
    env: makeEnv(db, { sessionHash: undefined }),
  });
  assert.equal(noDigest.status, 503);
  const malformed = await call(db, 'replica/claim', claim('mutation0000000995'), {
    env: makeEnv(db, { sessionHash: 'broken' }),
  });
  assert.equal(malformed.status, 503);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
}));

void test('revoked Auth session after private gate cannot read snapshots, replica control or receipts', () => withFixture(async db => {
  const original = attempt('batch000000000997');
  assert.equal((await call(db, 'commit', original)).status, 200);
  assert.equal((await call(db, 'read', { paths: [''] })).status, 200);
  db.sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms = ? WHERE token_hash = ?')
    .run(Date.now(), syntheticSessionHash);

  // makeEnv deliberately returns the earlier trusted gate claims. Every D1
  // read must independently refuse them after the subsequent logout.
  const cases = [
    ['control', {}],
    ['read', { paths: [''] }],
    ['scan', { after: null, expectedRevision: null }],
    ['receipt', { batchId: original.batchId }],
    ['replica/status', claim('mutation0000000996')],
    ['replica/claim', claim('mutation0000000997')],
    ['commit', original],
  ];
  for (const [route, request] of cases) {
    const result = await call(db, route, request);
    assert.equal(result.status, 403, route);
    assert.deepEqual(result.body, { error: 'access-revoked' }, route);
  }
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 1);
}));

void test('expired, foreign and fenced-epoch sessions cannot read D1 account state', () => withFixture(async db => {
  const routes = [
    ['control', {}],
    ['read', { paths: [''] }],
    ['scan', { after: null, expectedRevision: null }],
    ['receipt', { batchId: 'batch000000000998' }],
  ];
  for (const [route, request] of routes) {
    const foreign = await call(db, route, request, {
      env: makeEnv(db, { sessionHash: 'f'.repeat(64) }),
    });
    assert.equal(foreign.status, 403, route);
  }

  db.sqlite.prepare('UPDATE auth_sessions SET idle_expires_at_ms = issued_at_ms + 1, absolute_expires_at_ms = issued_at_ms + 2 WHERE token_hash = ?')
    .run(syntheticSessionHash);
  assert.equal((await call(db, 'control', {})).status, 403);
  db.sqlite.prepare('UPDATE auth_principals SET auth_epoch = 6 WHERE uid = ?')
    .run(owner);
  assert.equal((await call(db, 'read', { paths: [''] })).status, 403);
}));

void test('revocation between replica-control read and clock scan prevents a new membership receipt', () => withFixture(async db => {
  const raced = Object.create(db);
  let interrupted = false;
  raced.batch = async statements => {
    if (!interrupted && statements[0]?.sql.includes('HAVING')) {
      interrupted = true;
      db.sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms = ? WHERE token_hash = ?')
        .run(Date.now(), syntheticSessionHash);
    }
    return db.batch(statements);
  };
  const result = await call(db, 'replica/claim', claim('mutation0000000999'), {
    env: { ...makeEnv(db), DB: raced },
  });
  assert.equal(interrupted, true);
  assert.equal(result.status, 503);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
}));

void test('a deleted consent proof after AuthGate cannot authorize D1 data or historical receipts', () => withFixture(async db => {
  const original = attempt('batch000000001001');
  assert.equal((await call(db, 'commit', original)).status, 200);
  db.sqlite.prepare('DELETE FROM health_consent_acceptances WHERE uid = ?').run(owner);
  // The synthetic gate deliberately returns claims issued before deletion.
  const cases = [
    ['control', {}],
    ['read', { paths: [''] }],
    ['scan', { after: null, expectedRevision: null }],
    ['receipt', { batchId: original.batchId }],
    ['replica/status', claim('mutation0000001001', 1)],
    ['replica/claim', claim('mutation0000001002', 1)],
    ['commit', attempt('batch000000001002', 2, 1)],
  ];
  for (const [route, body] of cases) {
    const result = await call(db, route, body);
    assert.deepEqual(result, { status: 403, body: { error: 'access-revoked' } }, route);
  }
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 1);
}));

void test('a consent proof removed after the gate but before SQL cannot commit ciphertext', () => withFixture(async db => {
  const intercepted = Object.create(db);
  intercepted.batch = async statements => {
    if (statements[0]?.sql.includes('INSERT INTO sync_receipts')) {
      db.sqlite.prepare('DELETE FROM health_consent_acceptances WHERE uid = ?').run(owner);
    }
    return db.batch(statements);
  };
  const result = await call(db, 'commit', attempt('batch000000001003'), {
    env: { ...makeEnv(db), DB: intercepted },
  });
  assert.deepEqual(result, { status: 403, body: { error: 'access-revoked' } });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_documents').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
}));

void test('a consent proof removed between gate and SQL rolls back replica membership', () => withFixture(async db => {
  const intercepted = Object.create(db);
  intercepted.batch = async statements => {
    if (statements[0]?.sql.includes('INSERT INTO sync_replica_mutations')) {
      db.sqlite.prepare('DELETE FROM health_consent_acceptances WHERE uid = ?').run(owner);
    }
    return db.batch(statements);
  };
  const result = await call(db, 'replica/claim', claim('mutation0000001003'), {
    env: { ...makeEnv(db), DB: intercepted },
  });
  assert.deepEqual(result, { status: 403, body: { error: 'access-revoked' } });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replicas').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
}));

void test('CF-08 sync rejects absent or sealed independent authority before reading ciphertext', () => withFixture(async (db, _second, fence) => {
  const success = await call(db, 'control', {});
  assert.equal(success.status, 200);
  const missing = makeEnv(db);
  delete missing.RECOVERY_DB;
  assert.deepEqual(await call(db, 'control', {}, { env: missing }),
    { status: 503, body: { error: 'cloud-unavailable' } });

  fence.sqlite.prepare("UPDATE recovery_control SET mode='sealed',generation=3 WHERE singleton=1").run();
  assert.deepEqual(await call(db, 'control', {}),
    { status: 503, body: { error: 'cloud-unavailable' } });
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state WHERE uid=?').get(owner).revision, 0);
}));

void test('CF-08 independent withdrawal blocks stale application consent and sync writes', () => withFixture(async (db, _second, fence) => {
  const current = await call(db, 'control', {});
  assert.equal(current.status, 200);
  fence.sqlite.prepare(`UPDATE recovery_owner_fences
    SET status='blocked',change_seq=change_seq+1 WHERE uid=?`).run(owner);
  const rejected = await call(db, 'commit', attempt('batch000000000098'));
  assert.deepEqual(rejected, { status: 503, body: { error: 'cloud-unavailable' } });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts WHERE uid=?').get(owner).n, 0);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state WHERE uid=?').get(owner).revision, 0);
}));

void test('CF-08 late independent withdrawal hides a committed sync receipt, never invents ACK', () => withFixture(async (db, _second, fence) => {
  let changed = false;
  const intercepted = Object.assign(Object.create(db), {
    async batch(...args) {
      const result = await db.batch(...args);
      if (!changed && args[0]?.some(statement => statement.sql?.includes('INSERT INTO sync_receipts'))) {
        changed = true;
        fence.sqlite.prepare(`UPDATE recovery_owner_fences
          SET status='blocked',change_seq=change_seq+1 WHERE uid=?`).run(owner);
      }
      return result;
    },
  });
  independentDatabases.set(intercepted, fence);
  const rejected = await call(db, 'commit', attempt('batch000000000099'), {
    env: makeEnv(intercepted),
  });
  assert.equal(changed, true);
  assert.deepEqual(rejected, { status: 503, body: { error: 'cloud-unavailable' } });
  // The application D1 did commit. The external floor nevertheless prevents
  // an ACK for the old consent, leaving the local journal to recover safely.
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state WHERE uid=?').get(owner).revision, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts WHERE uid=?').get(owner).n, 1);
  assert.deepEqual(await call(db, 'receipt', { batchId: 'batch000000000099' }),
    { status: 503, body: { error: 'cloud-unavailable' } });
  independentDatabases.delete(intercepted);
}));

void test('current independent registry enforces pending withdrawal and erasure cutoff transitions', () => withFixture(async (_db, _other, registry) => {
  const pendingUid = 'cf02-pending-withdrawal';
  const sqlite = registry.sqlite;
  // An active consent cannot enqueue erasure before independent revocation.
  assert.throws(() => sqlite.prepare(
    'INSERT INTO recovery_erasure_cutoffs (uid,consent_revision,fence_epoch) VALUES (?,?,?)',
  ).run(owner, 1, 5), /recovery-erasure-cutoff-fenced/);

  sqlite.prepare(`INSERT INTO recovery_owner_fences
    (uid,status,consent_revision,fence_epoch,erased_before_revision,change_seq)
    VALUES (?,'pending',0,5,0,1)`).run(pendingUid);
  // Migration 0003 permits withdrawing an initial consent before activation.
  sqlite.prepare(`UPDATE recovery_owner_fences
    SET status='blocked',consent_revision=1,change_seq=2 WHERE uid=?`).run(pendingUid);
  assert.deepEqual(sqlite.prepare(
    'SELECT status,consent_revision,fence_epoch,change_seq FROM recovery_owner_fences WHERE uid=?',
  ).get(pendingUid), { status: 'blocked', consent_revision: 1, fence_epoch: 5, change_seq: 2 });

  // Migration 0004 guards a persistent queue item against deletion.
  sqlite.prepare(
    'INSERT INTO recovery_erasure_cutoffs (uid,consent_revision,fence_epoch) VALUES (?,?,?)',
  ).run(pendingUid, 1, 5);
  assert.deepEqual(sqlite.prepare(
    'SELECT next_check_ms,finalized FROM recovery_erasure_cutoffs WHERE uid=? AND consent_revision=1 AND fence_epoch=5',
  ).get(pendingUid), { next_check_ms: 0, finalized: 0 });
  assert.throws(() => sqlite.prepare('DELETE FROM recovery_erasure_cutoffs WHERE uid=?').run(pendingUid),
    /recovery-erasure-cutoff-immutable/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM recovery_erasure_cutoffs WHERE uid=?').get(pendingUid).n, 1);
}));
