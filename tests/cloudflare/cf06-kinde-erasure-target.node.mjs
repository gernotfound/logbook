import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { consumeKindeDeletionAttempt, saveKindeDeletionAttempt } from '../../cloudflare/auth/kinde-deletion-attempts.mjs';
import { deriveKindeOwnerId } from '../../cloudflare/auth/kinde-owner-id.mjs';
import healthErasureWorker from '../../cloudflare/jobs/health-erasure-worker.mjs';
import { runKindeAccountErasureAppStep } from '../../cloudflare/jobs/kinde-account-erasure-app-step.mjs';
import { acceptKindeAccountErasure, recordKindeAccountErasureIntent, requestKindeAccountErasure } from '../../cloudflare/jobs/kinde-account-erasure-requests.mjs';
import { createKindeErasureManagement } from '../../cloudflare/jobs/kinde-erasure-management.mjs';
import { createKindeErasureTargetCodec } from '../../cloudflare/jobs/kinde-erasure-target.mjs';
import { createKindeErasureTargetWriter } from '../../cloudflare/jobs/kinde-erasure-target-store.mjs';
import { requireIndependentAccountAccess } from '../../cloudflare/recovery/account-erasure-denials.mjs';
import { requireIndependentOwnerFence } from '../../cloudflare/recovery/independent-owner-fence.mjs';
import { applyCurrentD1RecoverySchema, applyCurrentD1Schema } from './current-d1-schema.mjs';

const issuer = 'https://synthetic-tenant.kinde.com';
const subject = 'kp_synthetic-deletion-reference';
const keyId = 'synthetic-erasure-v1';
const error = { message: 'kinde-erasure-target-unavailable' };
const keyFor = (extractable = false) => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);

function d1For(sqlite, { beforeWrite = () => {}, afterWrite = () => {} } = {}) {
  return {
    withSession(policy) {
      assert.equal(policy, 'first-primary');
      return { prepare(sql) {
        const statement = sqlite.prepare(sql);
        const bind = (...args) => ({
          async first() { return statement.get(...args) ?? null; },
          async run() {
            beforeWrite();
            const { changes } = statement.run(...args);
            afterWrite();
            return { success: true, meta: { changes } };
          },
          bind,
        });
        return bind();
      } };
    },
  };
}

async function erasureStoreFixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyCurrentD1Schema(sqlite);
  const uid = await deriveKindeOwnerId(issuer, subject);
  sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)").run(uid, Date.now() - 1000);
  const codec = createKindeErasureTargetCodec({ issuer, keyId, key: await keyFor() });
  return { sqlite, write: createKindeErasureTargetWriter(codec), identity: { uid, subject, authEpoch: 1 } };
}

async function deletionAttemptFixture(t) {
  const { sqlite, identity, write } = await erasureStoreFixture(t);
  const issuedAt = Date.now() - 1000;
  const sessionHash = 'b'.repeat(64);
  const alternateSession = 'a'.repeat(64);
  const createSession = sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)');
  for (const hash of [sessionHash, alternateSession]) {
    createSession.run(hash, identity.uid, 'c'.repeat(64), issuedAt, issuedAt + 30_000, issuedAt + 60_000);
  }
  const attempt = {
    uid: identity.uid, authEpoch: 1, sessionHash, stateHash: 'd'.repeat(64), browserHash: 'e'.repeat(64),
    verifier: Buffer.alloc(32, 10).toString('base64url'), nonce: Buffer.alloc(32, 11).toString('base64url'),
  };
  return { sqlite, db: d1For(sqlite), attempt, alternateSession, identity, write };
}

function deletionRequestProof(attempt) {
  const { uid, authEpoch, sessionHash } = attempt;
  return {
    uid, authEpoch, sessionHash, receiptHash: '9'.repeat(64),
    authenticatedAtMs: Math.floor(Date.now() / 1000) * 1000 - 1000,
  };
}

function openRecoveryFixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyCurrentD1RecoverySchema(sqlite);
  sqlite.exec("UPDATE recovery_control SET mode='open', generation=2");
  return { sqlite, db: d1For(sqlite) };
}

test('derives the same public owner identifier as the trusted callback contract', async () => {
  const expected = 'k_' + createHash('sha256')
    .update('thelogbook:kinde-owner:v1\0' + issuer + '\0' + subject)
    .digest('base64url');
  assert.equal(await deriveKindeOwnerId(issuer, subject), expected);
  assert.notEqual(await deriveKindeOwnerId('https://other-tenant.kinde.com', subject), expected);
  for (const invalid of ['https://synthetic-tenant.kinde.com/extra', 'https://name@synthetic-tenant.kinde.com', 'http://synthetic-tenant.kinde.com']) {
    await assert.rejects(deriveKindeOwnerId(invalid, subject), /invalid-kinde-owner-input/);
  }
});

test('seals only the subject bound to its owner and keeps the provider identifier outside stored metadata', async () => {
  const key = await keyFor();
  const uid = await deriveKindeOwnerId(issuer, subject);
  const codec = createKindeErasureTargetCodec({ issuer, keyId, key });
  const first = await codec.seal({ uid, subject });
  const second = await codec.seal({ uid, subject });
  assert.equal(await codec.open(uid, structuredClone(first)), subject);
  assert.notEqual(first.iv, second.iv);
  assert.equal(JSON.stringify(first).includes(subject), false);
  await assert.rejects(codec.seal({ uid, subject: 'kp_different-synthetic-user' }), error);
});

test('fails closed on owner, tenant, key or ciphertext changes', async () => {
  const key = await keyFor();
  const uid = await deriveKindeOwnerId(issuer, subject);
  const otherUid = await deriveKindeOwnerId(issuer, 'kp_other-synthetic-user');
  const codec = createKindeErasureTargetCodec({ issuer, keyId, key });
  const record = await codec.seal({ uid, subject });
  const wrongKey = createKindeErasureTargetCodec({ issuer, keyId, key: await keyFor() });
  const wrongIssuer = createKindeErasureTargetCodec({ issuer: 'https://other-tenant.kinde.com', keyId, key });
  const wrongVersion = createKindeErasureTargetCodec({ issuer, keyId: 'next', key });
  await assert.rejects(codec.open(otherUid, { ...record, uid: otherUid }), error);
  await assert.rejects(wrongKey.open(uid, record), error);
  await assert.rejects(wrongIssuer.open(uid, record), error);
  await assert.rejects(wrongVersion.open(uid, { ...record, keyId: 'next' }), error);
  for (const invalid of [{ ...record, version: 2 }, { ...record, subject }, { ...record, iv: record.iv + '=' },
    { ...record, ciphertext: (record.ciphertext[0] === 'A' ? 'B' : 'A') + record.ciphertext.slice(1) }]) {
    await assert.rejects(codec.open(uid, invalid), error);
  }
});

test('rejects a key that can be exported or a missing key identifier', async () => {
  const key = await keyFor(true);
  const privateKey = await keyFor();
  assert.throws(() => createKindeErasureTargetCodec({ issuer, keyId, key }), error);
  assert.throws(() => createKindeErasureTargetCodec({ issuer, keyId: '', key: privateKey }), error);
});

test('stores one recoverable encrypted target for repeated and concurrent verified callbacks', async (t) => {
  const { sqlite, write, identity } = await erasureStoreFixture(t);
  const db = d1For(sqlite);
  await Promise.all([write(db, identity), write(db, identity)]);
  const targetRows = sqlite.prepare('SELECT * FROM kinde_erasure_targets');
  const before = targetRows.all();
  assert.equal(before.length, 1);
  assert.equal(before[0].uid, identity.uid);
  assert.equal(JSON.stringify(before).includes(identity.subject), false);
  await write(db, identity);
  await assert.rejects(write(db, { ...identity, subject: 'kp_foreign' }), /kinde-erasure-target-storage-unavailable/);
  assert.deepEqual(targetRows.all(), before);
  assert.throws(() => sqlite.exec('INSERT OR REPLACE INTO kinde_erasure_targets SELECT * FROM kinde_erasure_targets'),
    /kinde-erasure-target-fenced/);
  assert.throws(() => sqlite.exec('UPDATE kinde_erasure_targets SET iv=iv'), /kinde-erasure-target-immutable/);
  assert.throws(() => sqlite.exec('DELETE FROM kinde_erasure_targets'), /kinde-erasure-target-retained/);
});

test('the candidate schema adds empty erasure tables to populated 0011 without altering identities', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys = ON');
  const migrations = new URL('../../cloudflare/api/migrations/', import.meta.url);
  const beforeTargets = readdirSync(migrations).filter(name => /^00(0[1-9]|1[01])_.*\.sql$/.test(name)).sort();
  assert.equal(beforeTargets.length, 11);
  for (const name of beforeTargets) sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'));
  const uid = await deriveKindeOwnerId(issuer, subject);
  const issued = Date.now() - 1000;
  sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)").run(uid, issued);
  sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)')
    .run('a'.repeat(64), uid, 'b'.repeat(64), issued, issued + 30_000, issued + 60_000);
  const principals = sqlite.prepare('SELECT * FROM auth_principals');
  const sessions = sqlite.prepare('SELECT * FROM auth_sessions');
  const oldPrincipals = principals.all();
  const oldSessions = sessions.all();

  sqlite.exec(readFileSync(new URL('0012_kinde_account_erasure.sql', migrations), 'utf8'));

  assert.deepEqual(principals.all(), oldPrincipals);
  assert.deepEqual(sessions.all(), oldSessions);
  assert.deepEqual(sqlite.prepare('SELECT * FROM kinde_erasure_targets').all(), []);
  assert.deepEqual(sqlite.prepare('SELECT * FROM kinde_deletion_oauth_attempts').all(), []);
  assert.deepEqual(sqlite.prepare('SELECT * FROM kinde_account_erasure_intents').all(), []);
  assert.deepEqual(sqlite.prepare('SELECT * FROM kinde_account_erasure_requests').all(), []);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('requires a new primary read to recover a lost insertion response and fences an epoch change', async (t) => {
  const { sqlite, write, identity } = await erasureStoreFixture(t);
  const count = sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_erasure_targets');
  let writes = 0;
  await assert.rejects(write(d1For(sqlite, { beforeWrite() {
    sqlite.exec("UPDATE auth_principals SET status='disabled', auth_epoch=2");
  } }), identity), /kinde-erasure-target-storage-unavailable/);
  assert.equal(count.get().n, 0);

  sqlite.exec("UPDATE auth_principals SET status='active', auth_epoch=3");
  const current = { ...identity, authEpoch: 3 };
  await write(d1For(sqlite, { afterWrite() {
    writes += 1;
    throw new Error('committed but synthetic D1 reply lost');
  } }), current);
  assert.equal(writes, 1);
  assert.equal(count.get().n, 1);
  await assert.rejects(write(d1For(sqlite), identity), /kinde-erasure-target-storage-unavailable/);
});

test('uses one deletion proof across concurrent callbacks and binds it to the original browser and session', async (t) => {
  const { db, sqlite, attempt, alternateSession } = await deletionAttemptFixture(t);
  assert.equal(await saveKindeDeletionAttempt(db, attempt), true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
  assert.equal(await consumeKindeDeletionAttempt(db, { ...attempt, browserHash: 'f'.repeat(64) }), null);
  assert.equal(await consumeKindeDeletionAttempt(db, { ...attempt, sessionHash: alternateSession }), null);
  const results = await Promise.all([
    consumeKindeDeletionAttempt(db, attempt), consumeKindeDeletionAttempt(db, attempt),
  ]);
  const saved = results.find(Boolean);
  assert.equal(results.filter(Boolean).length, 1);
  assert.deepEqual(saved, {
    expectedUid: attempt.uid, authEpoch: 1, startedAtMs: saved.startedAtMs,
    verifier: attempt.verifier, nonce: attempt.nonce,
  });
  assert.ok(Number.isSafeInteger(saved.startedAtMs) && saved.startedAtMs > 0);
  assert.equal(await consumeKindeDeletionAttempt(db, attempt), null);
});

test('rejects expired and revoked deletion proof and keeps ordinary login isolated', async (t) => {
  const { db, sqlite, attempt } = await deletionAttemptFixture(t);
  assert.equal(await saveKindeDeletionAttempt(db, { ...attempt, authEpoch: 2 }), false);
  assert.equal(await saveKindeDeletionAttempt(db, { ...attempt, uid: 'k_' + 'a'.repeat(43) }), false);
  assert.equal(await saveKindeDeletionAttempt(db, attempt), true);
  sqlite.exec('UPDATE kinde_deletion_oauth_attempts SET issued_at_ms = 1, expires_at_ms = 300001');
  assert.equal(await consumeKindeDeletionAttempt(db, attempt), null);
  assert.equal(await saveKindeDeletionAttempt(db, attempt), true, 'expired state is pruned');
  sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms = ? WHERE token_hash = ?')
    .run(Date.now(), attempt.sessionHash);
  assert.equal(await consumeKindeDeletionAttempt(db, attempt), null);
  assert.equal(await saveKindeDeletionAttempt(db, attempt), false);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_attempts').get().n, 0);
});

test('one reauthenticated request fences the owner and queues active health erasure even after lost acknowledgement', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const proof = deletionRequestProof(attempt);
  const denied = async (intent) => intent.uid === proof.uid && intent.authEpoch === proof.authEpoch;
  await write(db, identity);
  const foreignUid = await deriveKindeOwnerId(issuer, 'kp_other-owner');
  sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)").run(foreignUid, Date.now() - 1000);
  sqlite.prepare("INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,'active',1,1)").run(attempt.uid);
  assert.equal(await recordKindeAccountErasureIntent(db, { ...proof, authenticatedAtMs: proof.authenticatedAtMs - 300_000 }), null);
  assert.equal(await recordKindeAccountErasureIntent(db, { ...proof, sessionHash: '2'.repeat(64) }), null);
  const lostAck = d1For(sqlite, { afterWrite() { throw new Error('synthetic request ACK lost'); } });
  const intent = await recordKindeAccountErasureIntent(lostAck, proof);
  assert.equal(intent.uid, proof.uid);
  assert.equal(await requestKindeAccountErasure(db, intent, async () => false), false);
  assert.equal(await requestKindeAccountErasure(db, { ...intent, receiptHash: '8'.repeat(64) }, denied), false);
  assert.equal(sqlite.prepare('SELECT status FROM sync_subjects WHERE uid=?').get(attempt.uid).status, 'active');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM health_erasure_jobs').get().n, 0);
  // All sessions were invalidated after the durable decision. Acceptance
  // must resume from that decision while fencing the new auth epoch.
  sqlite.prepare('UPDATE auth_principals SET auth_epoch = 2 WHERE uid=?').run(attempt.uid);
  sqlite.exec(`CREATE TRIGGER synthetic_late_failure BEFORE UPDATE ON auth_principals
    WHEN NEW.status = 'disabled' BEGIN SELECT RAISE(ABORT, 'synthetic late failure'); END`);
  await assert.rejects(requestKindeAccountErasure(db, intent, denied), /kinde-erasure-request-unavailable/);
  assert.equal(sqlite.prepare('SELECT status FROM sync_subjects WHERE uid=?').get(attempt.uid).status, 'active');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM health_erasure_jobs').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
  sqlite.exec('DROP TRIGGER synthetic_late_failure');

  assert.equal(await requestKindeAccountErasure(lostAck, intent, denied), true);
  assert.equal(await requestKindeAccountErasure(db, intent, denied), true);
  const principals = sqlite.prepare('SELECT status, auth_epoch FROM auth_principals WHERE uid=?');
  assert.deepEqual({ ...principals.get(attempt.uid) }, { status: 'disabled', auth_epoch: 3 });
  assert.deepEqual({ ...principals.get(foreignUid) }, { status: 'active', auth_epoch: 1 });
  assert.equal(sqlite.prepare('SELECT status FROM sync_subjects WHERE uid=?').get(attempt.uid).status, 'withdrawn');
  assert.equal(sqlite.prepare('SELECT status FROM health_erasure_jobs WHERE uid=?').get(attempt.uid).status, 'pending');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM health_erasure_jobs').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 1);
  assert.throws(() => sqlite.prepare("UPDATE auth_principals SET status='active', auth_epoch=4 WHERE uid=?").run(attempt.uid),
    /kinde-account-erasure-request-retained/);
});

test('an atomic erasure request rolls back on failure and identity-only owners get no synthetic health job', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const proof = deletionRequestProof(attempt);
  const denied = async () => true;
  assert.equal(await recordKindeAccountErasureIntent(db, proof), null, 'an unrecorded Kinde target cannot queue');
  await write(db, identity);
  const intent = await recordKindeAccountErasureIntent(db, proof);
  sqlite.exec(`CREATE TRIGGER synthetic_failure BEFORE UPDATE ON auth_principals
    WHEN NEW.status = 'disabled' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);
  await assert.rejects(requestKindeAccountErasure(db, intent, denied), /kinde-erasure-request-unavailable/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid = ?').get(attempt.uid).status, 'active');
  sqlite.exec('DROP TRIGGER synthetic_failure');
  assert.equal(await requestKindeAccountErasure(db, intent, denied), true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM health_erasure_jobs').get().n, 0);
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid = ?').get(attempt.uid).status, 'disabled');
});

test('the independent denial survives application failure while the primary still shows active access', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const registry = new DatabaseSync(':memory:');
  t.after(() => registry.close());
  registry.exec('PRAGMA foreign_keys = ON');
  applyCurrentD1RecoverySchema(registry);
  const registryDb = d1For(registry);
  const otherUid = await deriveKindeOwnerId(issuer, 'kp_independent-other');
  const proof = deletionRequestProof(attempt);
  await write(db, identity);
  const intent = await recordKindeAccountErasureIntent(db, proof);
  assert.throws(() => acceptKindeAccountErasure(db, db, intent), /kinde-erasure-request-unavailable/);
  await assert.rejects(acceptKindeAccountErasure(db, registryDb, intent), /kinde-erasure-request-unavailable/);
  assert.equal(registry.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n, 0);
  await assert.rejects(requireIndependentAccountAccess(registryDb, identity.uid), /independent-recovery-fence-unavailable/);

  registry.exec("UPDATE recovery_control SET mode='open', generation=2");
  const enroll = registry.prepare("INSERT INTO recovery_owner_fences VALUES (?, 'pending', 0, 1, 0, 1)");
  const activate = registry.prepare("UPDATE recovery_owner_fences SET status='active', consent_revision=1, change_seq=2 WHERE uid=?");
  for (const uid of [identity.uid, otherUid]) { enroll.run(uid); activate.run(uid); }
  const originalScope = { uid: identity.uid, status: 'active', consentRevision: 1, fenceEpoch: 1, erasedBeforeRevision: 0 };
  await requireIndependentAccountAccess(registryDb, identity.uid);
  assert.equal(await requireIndependentOwnerFence(registryDb, originalScope), true);
  sqlite.prepare("INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,'active',1,1)").run(identity.uid);
  sqlite.exec(`CREATE TRIGGER pause_application_acceptance BEFORE UPDATE ON auth_principals
    WHEN NEW.status = 'disabled' BEGIN SELECT RAISE(ABORT, 'synthetic application outage'); END`);
  const unknownRegistryAck = d1For(registry, { afterWrite() { throw new Error('synthetic registry ACK lost'); } });
  await assert.rejects(acceptKindeAccountErasure(db, unknownRegistryAck, intent), /kinde-erasure-request-unavailable/);
  const denied = registry.prepare('SELECT * FROM recovery_account_erasure_denials').get();
  assert.equal(denied.uid, identity.uid);
  assert.notEqual(denied.intent_digest, intent.receiptHash);
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(identity.uid).status, 'active');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
  await assert.rejects(requireIndependentAccountAccess(registryDb, identity.uid), /independent-recovery-fence-unavailable/);
  await assert.rejects(requireIndependentOwnerFence(registryDb, originalScope), /independent-recovery-fence-unavailable/);
  await requireIndependentAccountAccess(registryDb, otherUid);
  assert.throws(() => registry.exec('DELETE FROM recovery_account_erasure_denials'), /account-erasure-denial-immutable/);
  assert.equal(await acceptKindeAccountErasure(db, registryDb, { ...intent, receiptHash: '8'.repeat(64) }), false);

  sqlite.exec('DROP TRIGGER pause_application_acceptance');
  sqlite.prepare('UPDATE auth_principals SET auth_epoch=2 WHERE uid=?').run(identity.uid);
  assert.equal(await acceptKindeAccountErasure(db, registryDb, intent), true);
  assert.equal(sqlite.prepare('SELECT status FROM sync_subjects WHERE uid=?').get(identity.uid).status, 'withdrawn');
  assert.equal(sqlite.prepare('SELECT status FROM health_erasure_jobs WHERE uid=?').get(identity.uid).status, 'pending');
  assert.equal(registry.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n, 1);
});

test('application erasure drains only the requesting owner’s sessions and attempts within one bounded step', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const proof = deletionRequestProof(attempt);
  await write(db, identity);
  const intent = await recordKindeAccountErasureIntent(db, proof);
  await assert.rejects(runKindeAccountErasureAppStep(db, recovery.db, intent), /independent-recovery-fence-unavailable/);
  await saveKindeDeletionAttempt(db, attempt);
  const foreignUid = await deriveKindeOwnerId(issuer, 'kp_independent-session');
  const issuedAt = Date.now() - 1000;
  sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)").run(foreignUid, issuedAt);
  const addSession = sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)');
  for (let i = 0; i < 18; i += 1) {
    addSession.run(i.toString(16).padStart(64, '0'), identity.uid, 'c'.repeat(64),
      issuedAt, issuedAt + 30_000, issuedAt + 60_000);
  }
  addSession.run('f'.repeat(64), foreignUid, 'c'.repeat(64), issuedAt, issuedAt + 30_000, issuedAt + 60_000);
  assert.equal(await acceptKindeAccountErasure(db, recovery.db, intent), true);

  const exactCount = sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE uid=?');
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'progress', removed: 16 });
  assert.equal(exactCount.get(identity.uid).n, 4);
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'progress', removed: 4 });
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'progress', removed: 1 });
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'application-complete' });
  assert.equal(exactCount.get(identity.uid).n, 0);
  assert.equal(exactCount.get(foreignUid).n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_erasure_targets').get().n, 1);
});

test('application readiness for a health owner requires the real SQL erasure proof and the independent terminal floor', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const proof = deletionRequestProof(attempt);
  await write(db, identity);
  const intent = await recordKindeAccountErasureIntent(db, proof);
  sqlite.prepare("INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,'active',1,1)").run(identity.uid);
  sqlite.prepare('INSERT INTO sync_state(uid,revision) VALUES (?,0)').run(identity.uid);
  recovery.sqlite.prepare("INSERT INTO recovery_owner_fences VALUES (?, 'pending', 0, 1, 0, 1)").run(identity.uid);
  recovery.sqlite.prepare("UPDATE recovery_owner_fences SET status='active', consent_revision=1, change_seq=2 WHERE uid=?").run(identity.uid);
  assert.equal(await acceptKindeAccountErasure(db, recovery.db, intent), true);
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'progress', removed: 2 });
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'health-pending' });

  const env = { DB: db, RECOVERY_DB: recovery.db, CF06_ERASURE_RUN_ENABLED: 'enabled' };
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), { outcome: 'awaiting-keys' });
  sqlite.exec('UPDATE health_erasure_jobs SET lease_until_ms=1');
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), { outcome: 'complete', keyDisposition: 'never-issued' });
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'application-complete' });
  assert.equal(recovery.sqlite.prepare('SELECT finalized FROM recovery_erasure_cutoffs').get().finalized, 1);
});

test('requests full profile erasure only after proof for the exact linked owner', async () => {
  const uid = await deriveKindeOwnerId(issuer, subject);
  const token = 'synthetic.worker.token';
  const phases = [];
  const { requestErasure } = createKindeErasureManagement({
    issuer,
    async proveTerminalFence(owner) {
      assert.equal(owner, uid);
      phases.push('fenced');
      return true;
    },
    async fetchImpl(request) {
      phases.push('management');
      const url = new URL(request.url);
      assert.equal(url.origin, issuer);
      assert.equal(url.pathname, '/api/v1/user');
      assert.deepEqual([...url.searchParams], [['id', subject], ['is_delete_profile', 'true']]);
      assert.equal(request.method, 'DELETE');
      assert.equal(request.redirect, 'manual');
      assert.equal(request.headers.get('authorization'), 'Bearer ' + token);
      assert.equal(request.body, null);
      return Response.json({ code: 'OK', message: 'Synthetic acknowledgement' });
    },
  });
  assert.equal(await requestErasure({ uid, subject, accessToken: token }), 'acknowledged');
  assert.deepEqual(phases, ['fenced', 'management']);
});

test('withholds the operation on mismatched identity, invalid token or missing durable fence', async () => {
  const uid = await deriveKindeOwnerId(issuer, subject);
  for (const proveTerminalFence of [async () => false, async () => { throw new Error('D1 unavailable'); }]) {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return Response.json({ code: 'OK', message: 'Synthetic' }); };
    const { requestErasure, readPresence } = createKindeErasureManagement({ issuer, fetchImpl, proveTerminalFence });
    const target = { uid, subject, accessToken: 'synthetic.worker.token' };
    assert.equal(await requestErasure(target), 'withheld');
    assert.equal(await requestErasure({ ...target, subject: 'kp_foreign' }), 'withheld');
    assert.equal(await requestErasure({ ...target, accessToken: 'invalid\nheader' }), 'withheld');
    assert.equal(await readPresence(target), 'withheld');
    assert.equal(calls, 0);
    assert.throws(() => createKindeErasureManagement({
      issuer: 'https://other.test', fetchImpl, proveTerminalFence,
    }), /kinde-erasure-management-unavailable/);
  }
});

test('never interprets ambiguous provider results as account erasure', async () => {
  const uid = await deriveKindeOwnerId(issuer, subject);
  const target = { uid, subject, accessToken: 'synthetic.worker.token' };
  const responseFactories = [
    ...[204, 401, 403, 404, 429, 500].map(status => () => new Response(null, { status })),
    () => new Response(null, { status: 302, headers: { location: 'https://another.example/profile' } }),
    () => new Response('proxy page', { headers: { 'content-type': 'text/html' } }),
    () => new Response('invalid json', { headers: { 'content-type': 'application/json' } }),
    () => Response.json({ code: 'ERROR', message: 'Rejected' }),
    () => Response.json({ code: 'OK', message: 'x'.repeat(2048) }),
    () => { throw new Error('reply lost after a synthetic submission'); },
  ];
  for (const response of responseFactories) {
    let calls = 0;
    const { requestErasure } = createKindeErasureManagement({
      issuer,
      async proveTerminalFence() { return true; },
      async fetchImpl() { calls += 1; return response(); },
    });
    assert.equal(await requestErasure(target), 'unconfirmed');
    assert.equal(calls, 1);
  }
});

test('readback after a lost delete reply uses an exact uncached Kinde profile listing', async () => {
  const uid = await deriveKindeOwnerId(issuer, subject);
  const observedMethods = [];
  let present = true;
  const target = { uid, subject, accessToken: 'synthetic.worker.token' };
  const management = createKindeErasureManagement({
    issuer, async proveTerminalFence(owner) { return owner === uid; },
    async fetchImpl(request) {
      observedMethods.push(request.method);
      const url = new URL(request.url);
      if (request.method === 'DELETE') {
        present = false;
        throw new Error('synthetic response lost after submission');
      }
      assert.equal(url.origin, issuer);
      assert.equal(url.pathname, '/api/v1/users');
      assert.deepEqual([...url.searchParams], [['user_id', subject], ['page_size', '1']]);
      assert.equal(request.cache, 'no-store');
      assert.equal(request.redirect, 'manual');
      return Response.json({ code: 'OK', message: 'Synthetic exact lookup', users: present ? [{ id: subject }] : [] });
    },
  });
  assert.equal(await management.readPresence(target), 'present');
  assert.equal(await management.requestErasure(target), 'unconfirmed');
  assert.equal(await management.readPresence(target), 'absent');
  assert.deepEqual(observedMethods, ['GET', 'DELETE', 'GET']);
});

test('a missing endpoint, foreign result or incomplete exact listing never proves absence', async () => {
  const uid = await deriveKindeOwnerId(issuer, subject);
  const target = { uid, subject, accessToken: 'synthetic.worker.token' };
  for (const response of [
    new Response(null, { status: 404 }),
    new Response(null, { status: 403 }),
    Response.json({ code: 'OK', message: 'Synthetic page', users: [], next_token: 'another-page' }),
    Response.json({ code: 'OK', message: 'Synthetic invalid', users: null }),
    Response.json({ code: 'OK', message: 'Synthetic foreign result', users: [{ id: 'kp_foreign' }] }),
    Response.json({ code: 'ERROR', message: 'Synthetic authorization error', users: [] }),
  ]) {
    const { readPresence } = createKindeErasureManagement({
      issuer, async proveTerminalFence() { return true; },
      async fetchImpl() { return response; },
    });
    assert.equal(await readPresence(target), 'unconfirmed');
  }
});
