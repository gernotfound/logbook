import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { consumeKindeDeletionAttempt, saveKindeDeletionAttempt } from '../../cloudflare/auth/kinde-deletion-attempts.mjs';
import { deriveKindeOwnerId } from '../../cloudflare/auth/kinde-owner-id.mjs';
import { recordKindeForegroundActivity } from '../../cloudflare/auth/kinde-foreground-activity.mjs';
import { recordKindeInactivityErasureIntent } from '../../cloudflare/jobs/kinde-inactivity-enqueue.mjs';
import { scanKindeInactivityEnqueueStep } from '../../cloudflare/jobs/kinde-inactivity-enqueue-scan.mjs';
import { runKindeInactivityEnqueueTick } from '../../cloudflare/jobs/kinde-inactivity-enqueue-scheduler.mjs';
import { readKindeInactivityCandidates } from '../../cloudflare/jobs/kinde-inactivity-candidates.mjs';
import { earliestKindeInactivityErasureAt } from '../../cloudflare/jobs/kinde-inactivity-time.mjs';
import healthErasureWorker from '../../cloudflare/jobs/health-erasure-worker.mjs';
import { runKindeAccountErasureAppStep } from '../../cloudflare/jobs/kinde-account-erasure-app-step.mjs';
import { runKindeAccountErasureProviderStep } from '../../cloudflare/jobs/kinde-account-erasure-provider-step.mjs';
import { runOneKindeAccountErasureStep } from '../../cloudflare/jobs/kinde-account-erasure-runner.mjs';
import { runKindeAccountErasureSweepTick } from '../../cloudflare/jobs/kinde-account-erasure-scheduler.mjs';
import { acceptKindeAccountErasure, recordKindeAccountErasureIntent, requestKindeAccountErasure } from '../../cloudflare/jobs/kinde-account-erasure-requests.mjs';
import { createKindeErasureManagement } from '../../cloudflare/jobs/kinde-erasure-management.mjs';
import { createKindeErasureTargetCodec } from '../../cloudflare/jobs/kinde-erasure-target.mjs';
import { createKindeErasureTargetWriter } from '../../cloudflare/jobs/kinde-erasure-target-store.mjs';
import { requireIndependentAccountAccess } from '../../cloudflare/recovery/account-erasure-denials.mjs';
import { requireIndependentOwnerFence } from '../../cloudflare/recovery/independent-owner-fence.mjs';
import { applyCurrentD1RecoverySchema, applyCurrentD1Schema } from './current-d1-schema.mjs';
import { D1_NOW_MS } from '../../cloudflare/sql/d1-time.mjs';

const issuer = 'https://synthetic-tenant.kinde.com';
const subject = 'kp_synthetic-deletion-reference';
const keyId = 'synthetic-erasure-v1';
const error = { message: 'kinde-erasure-target-unavailable' };
const keyFor = (extractable = false) => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);

function d1For(sqlite, { beforeWrite = () => {}, afterWrite = () => {}, afterFirst = () => {}, readFirst = (_sql, row) => row } = {}) {
  return {
    withSession(policy) {
      assert.equal(policy, 'first-primary');
      return { prepare(sql) {
        const statement = sqlite.prepare(sql);
        const bind = (...args) => ({
          async first() {
            const row = statement.get(...args) ?? null;
            afterFirst(sql, args);
            return readFirst(sql, row);
          },
          async all() { return { success: true, results: statement.all(...args) }; },
          async run() {
            beforeWrite(sql, args);
            const { changes } = statement.run(...args);
            afterWrite(sql, args);
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
  return { sqlite, codec, write: createKindeErasureTargetWriter(codec), identity: { uid, subject, authEpoch: 1 } };
}

async function deletionAttemptFixture(t) {
  const { sqlite, identity, write, codec } = await erasureStoreFixture(t);
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
  return { sqlite, db: d1For(sqlite), attempt, alternateSession, identity, write, codec };
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

void test('derives the same public owner identifier as the trusted callback contract', async () => {
  const expected = 'k_' + createHash('sha256')
    .update('thelogbook:kinde-owner:v1\0' + issuer + '\0' + subject)
    .digest('base64url');
  assert.equal(await deriveKindeOwnerId(issuer, subject), expected);
  assert.notEqual(await deriveKindeOwnerId('https://other-tenant.kinde.com', subject), expected);
  for (const invalid of ['https://synthetic-tenant.kinde.com/extra', 'https://name@synthetic-tenant.kinde.com', 'http://synthetic-tenant.kinde.com']) {
    await assert.rejects(deriveKindeOwnerId(invalid, subject), /invalid-kinde-owner-input/);
  }
});

void test('seals only the subject bound to its owner and keeps the provider identifier outside stored metadata', async () => {
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

void test('fails closed on owner, tenant, key or ciphertext changes', async () => {
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

void test('rejects a key that can be exported or a missing key identifier', async () => {
  const key = await keyFor(true);
  const privateKey = await keyFor();
  assert.throws(() => createKindeErasureTargetCodec({ issuer, keyId, key }), error);
  assert.throws(() => createKindeErasureTargetCodec({ issuer, keyId: '', key: privateKey }), error);
});

void test('stores one recoverable encrypted target for repeated and concurrent verified callbacks', async (t) => {
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

void test('the candidate schema adds empty erasure tables to populated 0011 without altering identities', async (t) => {
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

  sqlite.exec(readFileSync(new URL('0012_kinde_erasure_decisions.sql', migrations), 'utf8'));

  assert.deepEqual(principals.all(), oldPrincipals);
  assert.deepEqual(sessions.all(), oldSessions);
  assert.deepEqual(sqlite.prepare('SELECT * FROM kinde_erasure_targets').all(), []);
  assert.deepEqual(sqlite.prepare('SELECT * FROM kinde_deletion_oauth_attempts').all(), []);
  assert.deepEqual(sqlite.prepare('SELECT * FROM kinde_account_erasure_intents').all(), []);
  assert.deepEqual(sqlite.prepare('SELECT * FROM kinde_account_erasure_requests').all(), []);
  assert.deepEqual(sqlite.prepare('SELECT * FROM kinde_account_erasure_provider_progress').all(), []);
  assert.deepEqual(sqlite.prepare('SELECT * FROM kinde_account_erasure_completions').all(), []);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

void test('requires a new primary read to recover a lost insertion response and fences an epoch change', async (t) => {
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

void test('uses one deletion proof across concurrent callbacks and binds it to the original browser and session', async (t) => {
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

void test('rejects expired and revoked deletion proof and keeps ordinary login isolated', async (t) => {
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

void test('one reauthenticated request fences the owner and queues active health erasure even after lost acknowledgement', async (t) => {
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

void test('an atomic erasure request rolls back on failure and identity-only owners get no synthetic health job', async (t) => {
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

void test('the independent denial survives application failure while the primary still shows active access', async (t) => {
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

void test('account acceptance cannot use an independent deny from a different recovery generation', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  await write(db, identity);
  const intent = await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt));
  const reopen = () => {
    recovery.sqlite.exec("UPDATE recovery_control SET mode='sealed', generation=generation+1");
    recovery.sqlite.exec("UPDATE recovery_control SET mode='open', generation=generation+1");
  };
  const denials = () => recovery.sqlite.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n;
  const requests = () => sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n;
  const beforeWrite = d1For(recovery.sqlite, { beforeWrite(sql) {
    if (sql.includes('INSERT INTO recovery_account_erasure_denials')) reopen();
  } });
  await assert.rejects(acceptKindeAccountErasure(db, beforeWrite, intent), /kinde-erasure-request-unavailable/);
  assert.equal(denials(), 0);
  assert.equal(requests(), 0);
  const afterWrite = d1For(recovery.sqlite, { afterWrite(sql) {
    if (sql.includes('INSERT INTO recovery_account_erasure_denials')) reopen();
  } });
  await assert.rejects(acceptKindeAccountErasure(db, afterWrite, intent), /kinde-erasure-request-unavailable/);
  assert.equal(denials(), 1);
  assert.equal(requests(), 0);
  await assert.rejects(requireIndependentAccountAccess(recovery.db, identity.uid), /independent-recovery-fence-unavailable/);
  assert.equal(await acceptKindeAccountErasure(db, recovery.db, intent), true);
  assert.equal(requests(), 1);
  assert.equal(denials(), 1);
});

void test('application erasure drains only the requesting owner’s sessions and attempts within one bounded step', async (t) => {
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
  const activity = sqlite.prepare(`INSERT INTO kinde_account_activity
    (uid, first_observed_at_ms, last_recorded_at_ms) VALUES (?, ${D1_NOW_MS}, ${D1_NOW_MS})`);
  activity.run(identity.uid);
  activity.run(foreignUid);
  assert.equal(await acceptKindeAccountErasure(db, recovery.db, intent), true);

  const exactCount = sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE uid=?');
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'progress', removed: 16 });
  assert.equal(exactCount.get(identity.uid).n, 4);
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'progress', removed: 4 });
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'progress', removed: 1 });
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'progress', removed: 1 });
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'application-complete' });
  const ownerActivity = sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_activity WHERE uid=?');
  assert.equal(ownerActivity.get(identity.uid).n, 0);
  assert.equal(ownerActivity.get(foreignUid).n, 1);
  assert.equal(exactCount.get(identity.uid).n, 0);
  assert.equal(exactCount.get(foreignUid).n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_erasure_targets').get().n, 1);
});

void test('alternating lanes advance a health account only with the real SQL erasure proof and independent terminal floor', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const advance = controlSchedulerClock(t, sqlite);
  const recovery = openRecoveryFixture(t);
  const proof = deletionRequestProof(attempt);
  await write(db, identity);
  const intent = await recordKindeAccountErasureIntent(db, proof);
  sqlite.prepare("INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,'active',1,1)").run(identity.uid);
  sqlite.prepare('INSERT INTO sync_state(uid,revision) VALUES (?,0)').run(identity.uid);
  sqlite.prepare("INSERT INTO health_consent_acceptances VALUES (?,1,'privacy-v1','terms-v1',?,1)")
    .run(identity.uid, Date.now());
  recovery.sqlite.prepare("INSERT INTO recovery_owner_fences VALUES (?, 'pending', 0, 1, 0, 1)").run(identity.uid);
  recovery.sqlite.prepare("UPDATE recovery_owner_fences SET status='active', consent_revision=1, change_seq=2 WHERE uid=?").run(identity.uid);
  assert.equal(await acceptKindeAccountErasure(db, recovery.db, intent), true);
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'progress', removed: 2 });
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'health-pending' });

  const env = { DB: db, RECOVERY_DB: recovery.db, CF06_ERASURE_RUN_ENABLED: 'enabled',
    CF06_ERASURE_RUN_MODE: 'alternating-application' };
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), { outcome: 'awaiting-keys' });
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), {
    outcome: 'checkpointed', result: { outcome: 'health-pending' },
  });
  sqlite.exec('UPDATE health_erasure_jobs SET lease_until_ms=1');
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), { outcome: 'complete', keyDisposition: 'never-issued' });
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), {
    outcome: 'checkpointed', result: { outcome: 'idle' },
  });
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), { outcome: 'idle' });
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), {
    outcome: 'checkpointed', result: { outcome: 'deferred' },
  });
  advance(60_000);
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), { outcome: 'idle' });
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), {
    outcome: 'checkpointed', result: { outcome: 'idle' },
  });
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), { outcome: 'idle' });
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), {
    outcome: 'checkpointed', result: { outcome: 'application-complete' },
  });
  assert.equal(recovery.sqlite.prepare('SELECT finalized FROM recovery_erasure_cutoffs').get().finalized, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_completions').get().n, 0);
});

void test('account erasure recovers a committed consent whose independent floor is still pending', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  await write(db, identity);
  const intent = await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt));
  sqlite.prepare("INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,'active',1,1)").run(identity.uid);
  sqlite.prepare('INSERT INTO sync_state(uid,revision) VALUES (?,0)').run(identity.uid);
  sqlite.prepare("INSERT INTO health_consent_acceptances VALUES (?,1,'privacy-v1','terms-v1',?,1)")
    .run(identity.uid, Date.now());
  const otherUid = await deriveKindeOwnerId(issuer, 'kp_pending_other');
  const enroll = recovery.sqlite.prepare("INSERT INTO recovery_owner_fences VALUES (?, 'pending', 0, 1, 0, 1)");
  enroll.run(identity.uid);
  enroll.run(otherUid);
  const floor = recovery.sqlite.prepare('SELECT status, consent_revision, change_seq FROM recovery_owner_fences WHERE uid=?');
  assert.equal(await acceptKindeAccountErasure(db, recovery.db, intent), true);
  assert.deepEqual({ ...floor.get(identity.uid) }, { status: 'pending', consent_revision: 0, change_seq: 1 });
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'progress', removed: 2 });
  recovery.sqlite.exec("UPDATE recovery_control SET mode='sealed', generation=3");
  await assert.rejects(runKindeAccountErasureAppStep(db, recovery.db, intent), /independent-recovery-fence-unavailable/);
  assert.equal(floor.get(identity.uid).status, 'pending');
  recovery.sqlite.exec("UPDATE recovery_control SET mode='open', generation=4");
  const lostReply = d1For(recovery.sqlite, { afterWrite(sql) {
    if (sql.includes('UPDATE recovery_owner_fences')) throw new Error('synthetic floor ACK lost');
  } });
  assert.deepEqual(await runKindeAccountErasureAppStep(db, lostReply, intent), { outcome: 'health-pending' });
  assert.deepEqual({ ...floor.get(identity.uid) }, { status: 'blocked', consent_revision: 1, change_seq: 2 });
  assert.deepEqual({ ...floor.get(otherUid) }, { status: 'pending', consent_revision: 0, change_seq: 1 });
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'health-pending' });
  assert.equal(floor.get(identity.uid).change_seq, 2);
  await assert.rejects(requireIndependentAccountAccess(recovery.db, identity.uid), /independent-recovery-fence-unavailable/);
  const env = { DB: db, RECOVERY_DB: recovery.db, CF06_ERASURE_RUN_ENABLED: 'enabled' };
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), { outcome: 'awaiting-keys' });
  sqlite.exec('UPDATE health_erasure_jobs SET lease_until_ms=1');
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), { outcome: 'complete', keyDisposition: 'never-issued' });
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'application-complete' });
  assert.equal(recovery.sqlite.prepare('SELECT finalized FROM recovery_erasure_cutoffs').get().finalized, 1);
});

void test('dispatcher recovers a durable intent without a live session and never claims terminal erasure', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  await write(db, identity);
  const intent = await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt));
  assert.ok(intent);
  sqlite.prepare('DELETE FROM auth_sessions WHERE uid=?').run(identity.uid);
  const lostReply = d1For(recovery.sqlite, { afterWrite(sql) {
    if (sql.includes('INSERT INTO recovery_account_erasure_denials')) throw new Error('synthetic lost denial reply');
  } });
  assert.deepEqual(await runOneKindeAccountErasureStep(db, lostReply), {
    nextCursor: identity.uid, result: { outcome: 'accepted' },
  });
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(identity.uid).status, 'disabled');
  await assert.rejects(requireIndependentAccountAccess(recovery.db, identity.uid), /independent-recovery-fence-unavailable/);
  assert.deepEqual(await runOneKindeAccountErasureStep(db, recovery.db, identity.uid), {
    nextCursor: null, result: { outcome: 'idle' },
  });
  assert.deepEqual(await runOneKindeAccountErasureStep(db, recovery.db), {
    nextCursor: identity.uid, result: { outcome: 'application-complete' },
  });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_completions').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_erasure_targets').get().n, 1);
  await assert.rejects(runOneKindeAccountErasureStep(db, recovery.db, 'invalid'), /invalid-kinde-erasure-runner-cursor/);
  await assert.rejects(runOneKindeAccountErasureStep(db, db), /kinde-erasure-runner-unavailable/);
});

void test('a blocked intent does not starve the next owner and a new sweep retries it', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  await write(db, identity);
  assert.ok(await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt)));
  const secondSubject = 'kp_synthetic-second-intent';
  const secondUid = await deriveKindeOwnerId(issuer, secondSubject);
  const issued = Date.now() - 1000;
  sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)").run(secondUid, issued);
  const secondSession = '8'.repeat(64);
  sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)')
    .run(secondSession, secondUid, '7'.repeat(64), issued, issued + 30_000, issued + 60_000);
  await write(db, { uid: secondUid, subject: secondSubject, authEpoch: 1 });
  assert.ok(await recordKindeAccountErasureIntent(db, {
    ...deletionRequestProof({ ...attempt, uid: secondUid, sessionHash: secondSession }),
    receiptHash: '6'.repeat(64),
  }));
  const [first, second] = [identity.uid, secondUid].sort();
  const failing = d1For(recovery.sqlite, { beforeWrite(sql, args) {
    if (sql.includes('INSERT INTO recovery_account_erasure_denials') && args[0] === first) {
      throw new Error('synthetic denial failure');
    }
  } });
  assert.deepEqual(await runOneKindeAccountErasureStep(db, failing), {
    nextCursor: first, result: { outcome: 'blocked' },
  });
  assert.deepEqual(await runOneKindeAccountErasureStep(db, failing, first), {
    nextCursor: second, result: { outcome: 'accepted' },
  });
  const status = sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?');
  assert.equal(status.get(first).status, 'active');
  assert.equal(status.get(second).status, 'disabled');
  assert.deepEqual(await runOneKindeAccountErasureStep(db, failing, second), {
    nextCursor: null, result: { outcome: 'idle' },
  });
  assert.deepEqual(await runOneKindeAccountErasureStep(db, recovery.db), {
    nextCursor: first, result: { outcome: 'accepted' },
  });
  assert.equal(status.get(first).status, 'disabled');
});

void test('the scheduled sweep uses D1 time for bounded per-owner retry and resets only after real progress', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const advance = controlSchedulerClock(t, sqlite);
  await write(db, identity);
  assert.ok(await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt)));
  let denyAvailable = false;
  const flaky = d1For(recovery.sqlite, { beforeWrite(sql) {
    if (!denyAvailable && sql.includes('INSERT INTO recovery_account_erasure_denials')) {
      throw new Error('synthetic denial outage');
    }
  } });
  const retry = sqlite.prepare('SELECT failure_count, retry_after_ms FROM kinde_account_erasure_retries WHERE uid=?');
  const tick = () => runKindeAccountErasureSweepTick(db, flaky);

  assert.deepEqual(await tick(), { outcome: 'checkpointed', result: { outcome: 'blocked' } });
  const first = retry.get(identity.uid);
  assert.equal(first.failure_count, 1);
  assert.deepEqual(await tick(), { outcome: 'checkpointed', result: { outcome: 'idle' } });
  assert.deepEqual(await tick(), { outcome: 'checkpointed', result: { outcome: 'deferred' } });
  assert.equal(retry.get(identity.uid).failure_count, 1);
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(identity.uid).status, 'active');

  advance(60_000);
  assert.deepEqual(await tick(), { outcome: 'checkpointed', result: { outcome: 'idle' } });
  assert.deepEqual(await tick(), { outcome: 'checkpointed', result: { outcome: 'blocked' } });
  const second = retry.get(identity.uid);
  assert.equal(second.failure_count, 2);
  assert.equal(second.retry_after_ms - first.retry_after_ms, 120_000);
  assert.deepEqual(await tick(), { outcome: 'checkpointed', result: { outcome: 'idle' } });
  advance(119_999);
  assert.deepEqual(await tick(), { outcome: 'checkpointed', result: { outcome: 'deferred' } });
  denyAvailable = true;
  assert.deepEqual(await tick(), { outcome: 'checkpointed', result: { outcome: 'idle' } });
  advance(1);
  assert.deepEqual(await tick(), { outcome: 'checkpointed', result: { outcome: 'accepted' } });
  assert.equal(retry.get(identity.uid), undefined);
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(identity.uid).status, 'disabled');
});

void test('a lost retry write reply or expired sweep lease never checkpoints a blocked owner', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const advance = controlSchedulerClock(t, sqlite);
  await write(db, identity);
  assert.ok(await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt)));
  const failing = d1For(recovery.sqlite, { beforeWrite(sql) {
    if (sql.includes('INSERT INTO recovery_account_erasure_denials')) throw new Error('synthetic denial outage');
  } });
  const lost = d1For(sqlite, { afterFirst(sql) {
    if (sql.includes('INSERT INTO kinde_account_erasure_retries')) throw new Error('synthetic retry ACK lost');
  } });
  const checkpoint = sqlite.prepare('SELECT cursor_uid, lease_until_ms FROM kinde_account_erasure_scheduler');
  await assert.rejects(runKindeAccountErasureSweepTick(lost, failing), /synthetic retry ACK lost/);
  assert.equal(checkpoint.get().cursor_uid, null);
  assert.equal(sqlite.prepare('SELECT failure_count FROM kinde_account_erasure_retries').get().failure_count, 1);
  assert.deepEqual(await runKindeAccountErasureSweepTick(db, recovery.db), { outcome: 'not-claimed' });
  advance(60_000);
  assert.deepEqual(await runKindeAccountErasureSweepTick(db, recovery.db), {
    outcome: 'checkpointed', result: { outcome: 'accepted' },
  });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_retries').get().n, 0);
  assert.equal(checkpoint.get().lease_until_ms, 0);
});

void test('repeated denial outages cap the retry interval at one hour without changing account access', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const advance = controlSchedulerClock(t, sqlite);
  await write(db, identity);
  assert.ok(await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt)));
  const failing = d1For(recovery.sqlite, { beforeWrite(sql) {
    if (sql.includes('INSERT INTO recovery_account_erasure_denials')) throw new Error('synthetic outage');
  } });
  const retry = sqlite.prepare('SELECT failure_count, retry_after_ms FROM kinde_account_erasure_retries WHERE uid=?');
  let now = Date.now();
  for (let attemptNumber = 1; attemptNumber <= 9; attemptNumber += 1) {
    assert.deepEqual(await runKindeAccountErasureSweepTick(db, failing), {
      outcome: 'checkpointed', result: { outcome: 'blocked' },
    });
    const row = retry.get(identity.uid);
    const interval = attemptNumber >= 7 ? 3_600_000 : 60_000 * 2 ** (attemptNumber - 1);
    assert.equal(row.failure_count, Math.min(7, attemptNumber));
    assert.ok(Math.abs(row.retry_after_ms - now - interval) < 1000);
    assert.deepEqual(await runKindeAccountErasureSweepTick(db, failing), {
      outcome: 'checkpointed', result: { outcome: 'idle' },
    });
    advance(interval);
    now += interval;
  }
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(identity.uid).status, 'active');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
});

void test('an expired scheduler lease cannot create a retry record or skip an owner', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const advance = controlSchedulerClock(t, sqlite);
  await write(db, identity);
  assert.ok(await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt)));
  const slowFailure = d1For(recovery.sqlite, { beforeWrite(sql) {
    if (sql.includes('INSERT INTO recovery_account_erasure_denials')) {
      advance(60_000);
      throw new Error('synthetic slow outage');
    }
  } });
  await assert.rejects(runKindeAccountErasureSweepTick(db, slowFailure), /kinde-erasure-retry-unavailable/);
  assert.equal(sqlite.prepare('SELECT cursor_uid FROM kinde_account_erasure_scheduler').get().cursor_uid, null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_retries').get().n, 0);
  assert.deepEqual(await runKindeAccountErasureSweepTick(db, recovery.db), {
    outcome: 'checkpointed', result: { outcome: 'accepted' },
  });
});

void test('a lost retry-clear reply preserves the cursor and safely replays an accepted request', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const advance = controlSchedulerClock(t, sqlite);
  await write(db, identity);
  assert.ok(await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt)));
  sqlite.prepare('INSERT INTO kinde_account_erasure_retries VALUES (?, 1, 1)').run(identity.uid);
  const lost = d1For(sqlite, { afterWrite(sql) {
    if (sql.includes('DELETE FROM kinde_account_erasure_retries')) throw new Error('synthetic retry clear ACK lost');
  } });
  await assert.rejects(runKindeAccountErasureSweepTick(lost, recovery.db), /synthetic retry clear ACK lost/);
  assert.equal(sqlite.prepare('SELECT cursor_uid FROM kinde_account_erasure_scheduler').get().cursor_uid, null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_retries').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 1);
  advance(60_000);
  assert.deepEqual(await runKindeAccountErasureSweepTick(db, recovery.db), {
    outcome: 'checkpointed', result: { outcome: 'progress', removed: 2 },
  });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 1);
});

void test('sweep commits a durable cursor even after its write reply is lost, then starts a new sweep', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  await write(db, identity);
  assert.ok(await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt)));
  const lostReply = d1For(sqlite, { afterWrite(sql) {
    if (sql.includes('SET cursor_uid = ?')) throw new Error('synthetic checkpoint ACK lost');
  } });
  const checkpoint = sqlite.prepare('SELECT cursor_uid, lease_epoch, lease_until_ms FROM kinde_account_erasure_scheduler');
  assert.deepEqual(await runKindeAccountErasureSweepTick(lostReply, recovery.db), {
    outcome: 'checkpointed', result: { outcome: 'accepted' },
  });
  assert.deepEqual({ ...checkpoint.get() }, { cursor_uid: identity.uid, lease_epoch: 1, lease_until_ms: 0 });
  assert.deepEqual(await runKindeAccountErasureSweepTick(d1For(sqlite), recovery.db), {
    outcome: 'checkpointed', result: { outcome: 'idle' },
  });
  assert.deepEqual({ ...checkpoint.get() }, { cursor_uid: null, lease_epoch: 2, lease_until_ms: 0 });
  assert.deepEqual(await runKindeAccountErasureSweepTick(db, recovery.db), {
    outcome: 'checkpointed', result: { outcome: 'progress', removed: 2 },
  });
  assert.throws(() => sqlite.exec('DELETE FROM kinde_account_erasure_scheduler'), /scheduler-immutable/);
  assert.throws(() => sqlite.exec("UPDATE kinde_account_erasure_scheduler SET cursor_uid=NULL"), /scheduler-fenced/);
});

void test('scheduled account application mode resumes durable intents without Management', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  await write(db, identity);
  assert.ok(await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt)));
  const env = {
    CF06_ERASURE_RUN_ENABLED: 'enabled',
    CF06_ERASURE_RUN_MODE: 'account-application',
    DB: db,
    RECOVERY_DB: recovery.db,
  };
  const checkpoint = sqlite.prepare('SELECT cursor_uid, lease_epoch, lease_until_ms FROM kinde_account_erasure_scheduler');
  assert.deepEqual(await healthErasureWorker.scheduled({}, { ...env, CF06_ERASURE_RUN_ENABLED: 'disabled' }),
    { outcome: 'paused' });
  assert.deepEqual({ ...checkpoint.get() }, { cursor_uid: null, lease_epoch: 0, lease_until_ms: 0 });
  assert.deepEqual(await healthErasureWorker.scheduled({}, env), {
    outcome: 'checkpointed', result: { outcome: 'accepted' },
  });
  assert.deepEqual({ ...checkpoint.get() }, { cursor_uid: identity.uid, lease_epoch: 1, lease_until_ms: 0 });
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(identity.uid).status, 'disabled');
  await assert.rejects(requireIndependentAccountAccess(recovery.db, identity.uid), /independent-recovery-fence-unavailable/);
  assert.deepEqual(await healthErasureWorker.scheduled({}, env), {
    outcome: 'checkpointed', result: { outcome: 'idle' },
  });
  assert.deepEqual(await healthErasureWorker.scheduled({}, env), {
    outcome: 'checkpointed', result: { outcome: 'progress', removed: 2 },
  });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_completions').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_erasure_targets').get().n, 1);
  await assert.rejects(healthErasureWorker.scheduled({}, { ...env, RECOVERY_DB: db }),
    /kinde-erasure-scheduler-unavailable/);
});

void test('alternating scheduled mode persists one lane per tick and survives lost assignment or a blocked health lane', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  await write(db, identity);
  assert.ok(await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt)));
  const env = {
    CF06_ERASURE_RUN_ENABLED: 'enabled',
    CF06_ERASURE_RUN_MODE: 'alternating-application',
    DB: db, RECOVERY_DB: recovery.db,
  };
  const turn = sqlite.prepare('SELECT turn FROM erasure_dispatch_control WHERE singleton=1');
  const requests = sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests');
  assert.equal(turn.get().turn, 0);
  assert.deepEqual(await healthErasureWorker.scheduled({}, { ...env, CF06_ERASURE_RUN_ENABLED: 'disabled' }), { outcome: 'paused' });
  assert.equal(turn.get().turn, 0);
  await assert.rejects(healthErasureWorker.scheduled({}, { ...env, RECOVERY_DB: db }), /erasure-dispatch-unavailable/);
  assert.equal(turn.get().turn, 0);
  const lost = d1For(sqlite, { afterFirst(sql) {
    if (sql.includes('UPDATE erasure_dispatch_control')) throw new Error('lost-dispatch-reply');
  } });
  await assert.rejects(healthErasureWorker.scheduled({}, { ...env, DB: lost }), /lost-dispatch-reply/);
  assert.equal(turn.get().turn, 1);
  assert.equal(requests.get().n, 0);
  assert.deepEqual(await healthErasureWorker.scheduled({}, env), {
    outcome: 'checkpointed', result: { outcome: 'accepted' },
  });
  assert.equal(requests.get().n, 1);
  assert.equal(turn.get().turn, 2);

  // A failed health turn must not prevent the subsequent account turn.
  const failingRecovery = { withSession() { throw new Error('synthetic-recovery-failure'); } };
  await assert.rejects(healthErasureWorker.scheduled({}, { ...env, RECOVERY_DB: failingRecovery }), /independent-recovery-fence-unavailable/);
  assert.equal(turn.get().turn, 3);
  assert.deepEqual(await healthErasureWorker.scheduled({}, env), {
    outcome: 'checkpointed', result: { outcome: 'idle' },
  });
  const simultaneous = await Promise.all([
    healthErasureWorker.scheduled({}, env), healthErasureWorker.scheduled({}, env),
  ]);
  assert.deepEqual(simultaneous, [
    { outcome: 'idle' }, { outcome: 'checkpointed', result: { outcome: 'progress', removed: 2 } },
  ]);
  assert.equal(turn.get().turn, 6);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_completions').get().n, 0);
  assert.throws(() => sqlite.exec('UPDATE erasure_dispatch_control SET turn=0'), /dispatch-fenced/);
  assert.throws(() => sqlite.exec('DELETE FROM erasure_dispatch_control'), /dispatch-immutable/);
  assert.throws(() => sqlite.exec('INSERT OR REPLACE INTO erasure_dispatch_control VALUES (1, 0)'), /dispatch-immutable/);
});

function controlSchedulerClock(t, sqlite) {
  const clock = new DatabaseSync(':memory:');
  t.after(() => clock.close());
  let now = Date.now();
  const format = clock.prepare('SELECT strftime(?, ?) AS value');
  sqlite.function('strftime', (pattern, date) =>
    format.get(pattern, date === 'now' ? new Date(now).toISOString() : date).value);
  return ms => { now += ms; };
}

void test('a lost claim cannot run an owner step and its expired lease restarts from the same cursor', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const advance = controlSchedulerClock(t, sqlite);
  await write(db, identity);
  assert.ok(await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt)));
  const lostClaim = d1For(sqlite, { afterFirst(sql) {
    if (sql.includes('UPDATE kinde_account_erasure_scheduler')) throw new Error('synthetic claim ACK lost');
  } });
  await assert.rejects(runKindeAccountErasureSweepTick(lostClaim, recovery.db), /synthetic claim ACK lost/);
  assert.deepEqual(await runKindeAccountErasureSweepTick(db, recovery.db), { outcome: 'not-claimed' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
  assert.equal(recovery.sqlite.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n, 0);
  advance(60_000);
  assert.deepEqual(await runKindeAccountErasureSweepTick(db, recovery.db), {
    outcome: 'checkpointed', result: { outcome: 'accepted' },
  });
  assert.deepEqual({ ...sqlite.prepare('SELECT cursor_uid, lease_epoch FROM kinde_account_erasure_scheduler').get() },
    { cursor_uid: identity.uid, lease_epoch: 2 });
});

void test('a sweep whose lease expires after an owner write cannot advance the cursor or undo the durable request', async (t) => {
  const { db, sqlite, attempt, identity, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const advance = controlSchedulerClock(t, sqlite);
  await write(db, identity);
  assert.ok(await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt)));
  const slow = d1For(recovery.sqlite, { afterWrite(sql) {
    if (sql.includes('INSERT INTO recovery_account_erasure_denials')) advance(60_000);
  } });
  assert.deepEqual(await runKindeAccountErasureSweepTick(db, slow), { outcome: 'contended' });
  assert.equal(sqlite.prepare('SELECT cursor_uid FROM kinde_account_erasure_scheduler').get().cursor_uid, null);
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(identity.uid).status, 'disabled');
  await assert.rejects(requireIndependentAccountAccess(recovery.db, identity.uid), /independent-recovery-fence-unavailable/);
  const results = await Promise.all([
    runKindeAccountErasureSweepTick(db, recovery.db),
    runKindeAccountErasureSweepTick(db, recovery.db),
  ]);
  assert.deepEqual(results.map(x => x.outcome).sort(), ['checkpointed', 'not-claimed']);
  assert.equal(sqlite.prepare('SELECT cursor_uid FROM kinde_account_erasure_scheduler').get().cursor_uid, identity.uid);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_completions').get().n, 0);
});

void test('the provider runs last and the final receipt survives a lost D1 reply after commit', async (t) => {
  const { db, sqlite, attempt, identity, write, codec } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  await write(db, identity);
  const intent = await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt));
  assert.equal(await acceptKindeAccountErasure(db, recovery.db, intent), true);
  const calls = [];
  let present = true;
  let expireOnRead = false;
  const dependencies = {
    issuer, codec, accessToken: 'synthetic.worker.token',
    async fetchImpl(request) {
      calls.push(request.method);
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE uid=?').get(identity.uid).n, 0);
      assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(identity.uid).status, 'disabled');
      if (request.method === 'DELETE') {
        const url = new URL(request.url);
        assert.equal(url.searchParams.get('id'), subject);
        assert.equal(url.searchParams.get('is_delete_profile'), 'true');
        present = false;
        return Response.json({ code: 'OK', message: 'Synthetic deletion acknowledgement' });
      }
      if (expireOnRead) sqlite.exec('UPDATE kinde_account_erasure_provider_progress SET lease_until_ms=1');
      return Response.json({ code: 'OK', message: 'Synthetic lookup', users: present ? [{ id: subject }] : [] });
    },
  };
  assert.deepEqual(await runOneKindeAccountErasureStep(db, recovery.db, null, dependencies), {
    nextCursor: identity.uid, result: { outcome: 'progress', removed: 2 },
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(await runKindeAccountErasureProviderStep(db, recovery.db, intent, dependencies), { outcome: 'provider-acknowledged' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_completions').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_erasure_targets').get().n, 1);
  expireOnRead = true;
  assert.deepEqual(await runKindeAccountErasureProviderStep(db, recovery.db, intent, dependencies), { outcome: 'contended' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_completions').get().n, 0);
  const seedRetry = sqlite.prepare(`INSERT INTO kinde_account_erasure_retries
    (uid, failure_count, retry_after_ms) VALUES (?, 2, ?)`);
  seedRetry.run(identity.uid, Date.now() + 120_000);
  expireOnRead = false;
  const lostReply = d1For(sqlite, { afterWrite(sql) {
    if (sql.includes('INSERT INTO kinde_account_erasure_completions')) throw new Error('synthetic terminal reply lost');
  } });
  const completed = await runKindeAccountErasureProviderStep(lostReply, recovery.db, intent, dependencies);
  assert.equal(completed.outcome, 'complete');
  assert.ok(Number.isSafeInteger(completed.completedAtMs));
  assert.deepEqual(await runKindeAccountErasureProviderStep(db, recovery.db, intent, dependencies), completed);
  assert.deepEqual(await runOneKindeAccountErasureStep(db, recovery.db, null, dependencies), {
    nextCursor: identity.uid, result: { outcome: 'already-recorded' },
  });
  assert.deepEqual(calls, ['GET', 'DELETE', 'GET', 'GET']);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_completions').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_erasure_targets').get().n, 0);
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(identity.uid).status, 'deleted');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_retries').get().n, 0);
  assert.throws(() => seedRetry.run(identity.uid, Date.now() + 120_000), /kinde-erasure-retry-terminal/);
  await assert.rejects(requireIndependentAccountAccess(recovery.db, identity.uid), /independent-recovery-fence-unavailable/);
});

void test('full account sweep with a terminal health proof leaves headroom within the Free D1 query budget', async (t) => {
  const { db, sqlite, attempt, identity, write, codec } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  await write(db, identity);
  const intent = await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt));
  sqlite.prepare("INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,'active',1,1)").run(identity.uid);
  sqlite.prepare('INSERT INTO sync_state(uid,revision) VALUES (?,0)').run(identity.uid);
  sqlite.prepare("INSERT INTO health_consent_acceptances VALUES (?,1,'privacy-v1','terms-v1',?,1)").run(identity.uid, Date.now());
  recovery.sqlite.prepare("INSERT INTO recovery_owner_fences VALUES (?, 'pending', 0, 1, 0, 1)").run(identity.uid);
  recovery.sqlite.prepare("UPDATE recovery_owner_fences SET status='active', consent_revision=1, change_seq=2 WHERE uid=?").run(identity.uid);
  assert.equal(await acceptKindeAccountErasure(db, recovery.db, intent), true);
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'progress', removed: 2 });
  const env = { DB: db, RECOVERY_DB: recovery.db, CF06_ERASURE_RUN_ENABLED: 'enabled' };
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), { outcome: 'awaiting-keys' });
  sqlite.exec('UPDATE health_erasure_jobs SET lease_until_ms=1');
  assert.deepEqual(await healthErasureWorker.scheduled(null, env), { outcome: 'complete', keyDisposition: 'never-issued' });

  let queries = 0;
  const count = () => { queries += 1; };
  const countedDb = d1For(sqlite, { beforeWrite: count, afterFirst: count });
  const countedRecovery = d1For(recovery.sqlite, { beforeWrite: count, afterFirst: count });
  const calls = [];
  let present = true;
  const dependencies = {
    issuer, codec, accessToken: 'synthetic.worker.token',
    async fetchImpl(request) {
      calls.push(request.method);
      if (request.method === 'DELETE') {
        present = false;
        return Response.json({ code: 'OK', message: 'Synthetic deletion acknowledgement' });
      }
      return Response.json({ code: 'OK', message: 'Synthetic lookup', users: present ? [{ id: subject }] : [] });
    },
  };
  assert.deepEqual(await runKindeAccountErasureSweepTick(countedDb, countedRecovery, dependencies), {
    outcome: 'checkpointed', result: { outcome: 'provider-acknowledged' },
  });
  assert.deepEqual(calls, ['GET', 'DELETE']);
  assert.ok(queries <= 45, `D1 statements in full provider sweep: ${queries}`);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_completions').get().n, 0);
  assert.deepEqual(await runKindeAccountErasureSweepTick(db, recovery.db, dependencies), {
    outcome: 'checkpointed', result: { outcome: 'idle' },
  });
  queries = 0;
  const complete = await runKindeAccountErasureSweepTick(countedDb, countedRecovery, dependencies);
  assert.equal(complete.outcome, 'checkpointed');
  assert.equal(complete.result.outcome, 'complete');
  assert.ok(queries <= 45, `D1 statements in final provider sweep: ${queries}`);
  assert.deepEqual(calls, ['GET', 'DELETE', 'GET']);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_completions').get().n, 1);
});

void test('a recovery generation change during Management lookup withholds DELETE and permits a fresh retry', async (t) => {
  const { db, sqlite, attempt, identity, write, codec } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  await write(db, identity);
  const intent = await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt));
  assert.equal(await acceptKindeAccountErasure(db, recovery.db, intent), true);
  assert.deepEqual(await runKindeAccountErasureAppStep(db, recovery.db, intent), { outcome: 'progress', removed: 2 });
  let interrupt = true;
  let present = true;
  const calls = [];
  const dependencies = {
    issuer, codec, accessToken: 'synthetic.worker.token',
    async fetchImpl(request) {
      calls.push(request.method);
      if (request.method === 'DELETE') {
        present = false;
        return Response.json({ code: 'OK', message: 'Synthetic delete' });
      }
      if (interrupt) {
        recovery.sqlite.exec("UPDATE recovery_control SET mode='sealed', generation=3");
        recovery.sqlite.exec("UPDATE recovery_control SET mode='open', generation=4");
      }
      return Response.json({ code: 'OK', message: 'Synthetic lookup', users: present ? [{ id: subject }] : [] });
    },
  };
  await assert.rejects(runKindeAccountErasureProviderStep(db, recovery.db, intent, dependencies),
    /independent-recovery-fence-unavailable/);
  assert.deepEqual(calls, ['GET']);
  assert.equal(sqlite.prepare('SELECT delete_started_at_ms FROM kinde_account_erasure_provider_progress').get().delete_started_at_ms, null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_completions').get().n, 0);
  sqlite.exec('UPDATE kinde_account_erasure_provider_progress SET lease_until_ms=1');
  interrupt = false;
  assert.deepEqual(await runKindeAccountErasureProviderStep(db, recovery.db, intent, dependencies),
    { outcome: 'provider-acknowledged' });
  assert.equal((await runKindeAccountErasureProviderStep(db, recovery.db, intent, dependencies)).outcome, 'complete');
  assert.deepEqual(calls, ['GET', 'GET', 'DELETE', 'GET']);
});

void test('a lost Management acknowledgement and lookup absence alone cannot finalize account erasure', async (t) => {
  const { db, sqlite, attempt, identity, write, codec } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  await write(db, identity);
  const intent = await recordKindeAccountErasureIntent(db, deletionRequestProof(attempt));
  assert.equal(await acceptKindeAccountErasure(db, recovery.db, intent), true);
  const calls = [];
  let present = true;
  const dependencies = {
    issuer, codec, accessToken: 'synthetic.worker.token',
    async fetchImpl(request) {
      calls.push(request.method);
      if (request.method === 'DELETE') {
        present = false;
        throw new Error('synthetic unknown outcome');
      }
      return Response.json({ code: 'OK', message: 'Synthetic lookup', users: present ? [{ id: subject }] : [] });
    },
  };
  await runKindeAccountErasureProviderStep(db, recovery.db, intent, dependencies);
  assert.deepEqual(await runKindeAccountErasureProviderStep(db, recovery.db, intent, dependencies), { outcome: 'provider-unconfirmed' });
  sqlite.exec('UPDATE kinde_account_erasure_provider_progress SET lease_until_ms=1');
  assert.deepEqual(await runKindeAccountErasureProviderStep(db, recovery.db, intent, dependencies), { outcome: 'provider-unconfirmed' });
  assert.deepEqual(calls, ['GET', 'DELETE', 'GET']);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_completions').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_erasure_targets').get().n, 1);
});

void test('requests full profile erasure only after proof for the exact linked owner', async () => {
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

void test('withholds the operation on mismatched identity, invalid token or missing durable fence', async () => {
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

void test('never interprets ambiguous provider results as account erasure', async () => {
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

void test('readback after a lost delete reply uses an exact uncached Kinde profile listing', async () => {
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

void test('a missing endpoint, foreign result or incomplete exact listing never proves absence', async () => {
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

void test('inactivity enqueue fences fresh activity and live sessions, survives a lost reply and uses the common dispatcher', async (t) => {
  const { db, sqlite, identity, write, attempt } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const clock = new DatabaseSync(':memory:');
  t.after(() => clock.close());
  let now = Date.now();
  const fmt = clock.prepare('SELECT strftime(?, ?) AS value');
  sqlite.function('strftime', (format, date) => fmt.get(format, date === 'now' ? new Date(now).toISOString() : date).value);
  await write(db, identity);
  const claims = { uid: identity.uid, fenceEpoch: 1, sessionHash: attempt.sessionHash,
    authenticated: true, csrfVerified: true, rateGatePassed: true };
  assert.deepEqual(await recordKindeForegroundActivity(db, claims), { outcome: 'recorded' });
  const due = earliestKindeInactivityErasureAt(now);
  now = due - 1;
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
  assert.deepEqual((await readKindeInactivityCandidates(db)).candidates, []);
  now = due;
  const { candidates: [first] } = await readKindeInactivityCandidates(db);
  assert.ok(first);
  await assert.rejects(recordKindeInactivityErasureIntent(db, recovery.db, { ...first, eligibleAtMs: due - 1 }, 2), /invalid-kinde-inactivity-decision/);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='paused', generation=3");
  assert.equal(await recordKindeInactivityErasureIntent(db, recovery.db, first, 2), null);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=4");
  const { candidates: [second] } = await readKindeInactivityCandidates(db);
  assert.ok(second);
  const liveHash = 'f'.repeat(64);
  sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)')
    .run(liveHash, identity.uid, 'c'.repeat(64), now, now + 60_000, now + 120_000);
  assert.equal(await recordKindeInactivityErasureIntent(db, recovery.db, second, 2), null);
  assert.deepEqual(await recordKindeForegroundActivity(db, { ...claims, sessionHash: liveHash }), { outcome: 'recorded' });
  now += 120_001;
  assert.equal(await recordKindeInactivityErasureIntent(db, recovery.db, second, 2), null);
  now = earliestKindeInactivityErasureAt(due);
  const { candidates: [current] } = await readKindeInactivityCandidates(db);
  assert.ok(current);
  const lostAck = d1For(sqlite, { afterWrite(sql) {
    if (sql.includes('INSERT INTO kinde_account_erasure_intents')) throw Error('synthetic lost write reply');
  } });
  const intent = await recordKindeInactivityErasureIntent(lostAck, recovery.db, current, 2);
  assert.equal(intent.authenticatedAtMs, null);
  assert.deepEqual(intent.inactivity, { generation: 4, lastRecordedAtMs: due, eligibleAtMs: now });
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(identity.uid).status, 'disabled');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
  assert.throws(() => sqlite.prepare("UPDATE auth_principals SET status='active', auth_epoch=2 WHERE uid=?").run(identity.uid),
    /kinde-account-erasure-request-retained/);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='paused', generation=5");
  assert.deepEqual(await recordKindeInactivityErasureIntent(db, recovery.db, current, 2), intent);
  assert.equal(await acceptKindeAccountErasure(db, recovery.db, { ...intent, inactivity: { ...intent.inactivity, generation: 5 } }), false);
  const beforeRequest = d1For(sqlite, { beforeWrite(sql) {
    if (sql.includes('INSERT INTO kinde_account_erasure_requests')) throw Error('synthetic unavailable application write');
  } });
  await assert.rejects(acceptKindeAccountErasure(beforeRequest, recovery.db, intent), /kinde-erasure-request-unavailable/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
  assert.equal(recovery.sqlite.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n, 1);
  recovery.sqlite.exec("UPDATE recovery_control SET mode='sealed', generation=3");
  recovery.sqlite.exec("UPDATE recovery_control SET mode='open', generation=4");
  // The old intent may resume only because its exact irreversible deny exists.
  assert.deepEqual(await runOneKindeAccountErasureStep(db, recovery.db), {
    nextCursor: identity.uid, result: { outcome: 'accepted' },
  });
  await assert.rejects(requireIndependentAccountAccess(recovery.db, identity.uid), /independent-recovery-fence-unavailable/);
  assert.equal(sqlite.prepare('SELECT reauthenticated_at_ms FROM kinde_account_erasure_requests').get().reauthenticated_at_ms, null);
  assert.equal((await runKindeAccountErasureAppStep(db, recovery.db, intent)).outcome, 'progress');
  assert.equal((await runKindeAccountErasureAppStep(db, recovery.db, intent)).outcome, 'progress');
  assert.equal((await runKindeAccountErasureAppStep(db, recovery.db, intent)).outcome, 'application-complete');
});

void test('a reported intent insertion with a missing primary row is ambiguous and can recover', async t => {
  for (const origin of ['manual', 'inactivity']) {
    await t.test(origin, async t => {
      const { db, sqlite, identity, attempt, write } = await deletionAttemptFixture(t);
      const recovery = openRecoveryFixture(t);
      await write(db, identity);
      const proof = deletionRequestProof(attempt);
      let record = database => recordKindeAccountErasureIntent(database, proof);
      if (origin === 'inactivity') {
        // Seed an observation using the SQL clock, then let the session expire.
        const clock = new DatabaseSync(':memory:');
        t.after(() => clock.close());
        const fmt = clock.prepare('SELECT strftime(?, ?) AS value');
        let now = Date.now();
        sqlite.function('strftime', (format, date) => fmt.get(format, date === 'now' ? new Date(now).toISOString() : date).value);
        await recordKindeForegroundActivity(db, { uid: identity.uid, fenceEpoch: 1, sessionHash: attempt.sessionHash,
          authenticated: true, csrfVerified: true, rateGatePassed: true });
        now = earliestKindeInactivityErasureAt(now);
        sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
        const { candidates: [candidate] } = await readKindeInactivityCandidates(db);
        assert.ok(candidate);
        record = database => recordKindeInactivityErasureIntent(database, recovery.db, candidate, 2);
      }
      const hidden = d1For(sqlite, { readFirst(sql, row) {
        return sql.includes('FROM kinde_account_erasure_intents') ? null : row;
      } });
      await assert.rejects(record(hidden), /unavailable/);
      const stored = sqlite.prepare('SELECT uid, receipt_hash FROM kinde_account_erasure_intents').all();
      assert.equal(stored.length, 1);
      const mismatch = d1For(sqlite, { readFirst(sql, row) {
        return row && sql.includes('FROM kinde_account_erasure_intents')
          ? { ...row, receipt_hash: '7'.repeat(64) } : row;
      } });
      await assert.rejects(record(mismatch), /unavailable/);
      const retried = await record(db);
      assert.equal(retried.uid, identity.uid);
      assert.equal(retried.receiptHash, stored[0].receipt_hash);
      assert.equal(sqlite.prepare('SELECT count(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
      const hiddenRequest = d1For(sqlite, { readFirst(sql, row) {
        return sql.includes('FROM kinde_account_erasure_requests j') ? null : row;
      } });
      await assert.rejects(acceptKindeAccountErasure(hiddenRequest, recovery.db, retried), /unavailable/);
      assert.equal(sqlite.prepare('SELECT count(*) AS n FROM kinde_account_erasure_requests').get().n, 1);
      assert.equal(await acceptKindeAccountErasure(db, recovery.db, retried), true);
    });
  }
});

void test('inactivity cannot create a new independent denial from a stale recovery generation', async (t) => {
  const { db, sqlite, identity, write, attempt } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const clock = new DatabaseSync(':memory:');
  t.after(() => clock.close());
  let now = Date.now();
  const fmt = clock.prepare('SELECT strftime(?, ?) AS value');
  sqlite.function('strftime', (format, date) => fmt.get(format, date === 'now' ? new Date(now).toISOString() : date).value);
  await write(db, identity);
  assert.deepEqual(await recordKindeForegroundActivity(db, {
    uid: identity.uid, fenceEpoch: 1, sessionHash: attempt.sessionHash,
    authenticated: true, csrfVerified: true, rateGatePassed: true,
  }), { outcome: 'recorded' });
  now = earliestKindeInactivityErasureAt(now);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
  const { candidates: [candidate] } = await readKindeInactivityCandidates(db);
  assert.ok(candidate);
  const reopen = () => {
    recovery.sqlite.exec("UPDATE recovery_control SET mode='sealed', generation=generation+1");
    recovery.sqlite.exec("UPDATE recovery_control SET mode='open', generation=generation+1");
  };
  await assert.rejects(recordKindeInactivityErasureIntent(db, recovery.db, candidate, null), /invalid-kinde-inactivity-decision/);
  await assert.rejects(recordKindeInactivityErasureIntent(db, db, candidate, 2), /invalid-kinde-inactivity-decision/);
  reopen();
  await assert.rejects(recordKindeInactivityErasureIntent(db, recovery.db, candidate, 2), /kinde-inactivity-decision-unavailable/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_intents').get().n, 0);
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(identity.uid).status, 'active');

  // Synthetic fault: authorization changes after the application commit.
  // Even a committed freeze may not authorize a new deny in generation 6.
  const interrupted = d1For(sqlite, { afterWrite(sql) {
    if (sql.includes('INSERT INTO kinde_account_erasure_intents')) reopen();
  } });
  await assert.rejects(recordKindeInactivityErasureIntent(interrupted, recovery.db, candidate, 4), /kinde-inactivity-decision-unavailable/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_intents').get().n, 1);
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(identity.uid).status, 'disabled');
  assert.deepEqual(await runOneKindeAccountErasureStep(db, recovery.db), {
    nextCursor: identity.uid, result: { outcome: 'blocked' },
  });
  assert.equal(recovery.sqlite.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_erasure_targets').get().n, 1);
});

void test('the enqueue scanner processes one owner per step and keeps the unprocessed page suffix', async (t) => {
  const { db, sqlite, identity, write, attempt } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const clock = new DatabaseSync(':memory:');
  t.after(() => clock.close());
  const fmt = clock.prepare('SELECT strftime(?, ?) AS value');
  let now = Date.now();
  sqlite.function('strftime', (format, date) => fmt.get(format, date === 'now' ? new Date(now).toISOString() : date).value);
  const secondSubject = 'kp_second-synthetic-scanner-user';
  const secondUid = await deriveKindeOwnerId(issuer, secondSubject);
  const secondHash = 'f'.repeat(64);
  sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)").run(secondUid, now - 1000);
  sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)')
    .run(secondHash, secondUid, 'c'.repeat(64), now - 1000, now + 30_000, now + 60_000);
  await write(db, identity);
  await write(db, { uid: secondUid, subject: secondSubject, authEpoch: 1 });
  for (const [uid, sessionHash] of [[identity.uid, attempt.sessionHash], [secondUid, secondHash]]) {
    assert.deepEqual(await recordKindeForegroundActivity(db, {
      uid, sessionHash, fenceEpoch: 1, authenticated: true, csrfVerified: true, rateGatePassed: true,
    }), { outcome: 'recorded' });
  }
  const marker = now;
  now = earliestKindeInactivityErasureAt(marker);
  const scan = (cursor = null) => scanKindeInactivityEnqueueStep(db, recovery.db, 2, 2, cursor);
  const intents = () => sqlite.prepare('SELECT uid FROM kinde_account_erasure_intents ORDER BY uid').all().map(row => row.uid);
  await assert.rejects(scan(), /enqueue-scanner-unavailable/);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
  const [firstUid, lastUid] = [identity.uid, secondUid].sort();
  const first = await scan();
  assert.deepEqual(first, { decision: 'recorded', nextCursor: {
    policyGeneration: 2, recoveryGeneration: 2, after: { uid: firstUid, lastRecordedAtMs: marker },
  } });
  assert.deepEqual(intents(), [firstUid]);
  await assert.rejects(scan({ ...first.nextCursor, policyGeneration: 1 }), /enqueue-scanner-unavailable/);
  await assert.rejects(scanKindeInactivityEnqueueStep(db, recovery.db, 2, 4), /independent-recovery-fence-unavailable/);
  assert.deepEqual(intents(), [firstUid]);
  assert.deepEqual(await scan(first.nextCursor), { decision: 'recorded', nextCursor: null });
  assert.deepEqual(intents(), [firstUid, lastUid]);
  assert.deepEqual(await scan(), { decision: 'none', nextCursor: null });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
  assert.equal(recovery.sqlite.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n, 0);
});

void test('durable inactivity enqueue crosses full pages of ineligible owners without skipping or duplicating decisions', async (t) => {
  const { db, sqlite, write } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const clock = new DatabaseSync(':memory:');
  t.after(() => clock.close());
  const fmt = clock.prepare('SELECT strftime(?, ?) AS value');
  let now = Date.now();
  sqlite.function('strftime', (format, date) => fmt.get(format,
    date === 'now' ? new Date(now).toISOString() : date).value);

  const insertPrincipal = sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)");
  const insertSession = sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)');
  const owners = [];
  for (let index = 0; index < 35; index += 1) {
    const subject = `kp_synthetic-scanner-page-${index}`;
    const uid = await deriveKindeOwnerId(issuer, subject);
    const sessionHash = createHash('sha256').update(subject).digest('hex');
    insertPrincipal.run(uid, now - 1000);
    insertSession.run(sessionHash, uid, 'c'.repeat(64), now - 1000, now + 30_000, now + 60_000);
    await write(db, { uid, subject, authEpoch: 1 });
    assert.deepEqual(await recordKindeForegroundActivity(db, {
      uid, sessionHash, fenceEpoch: 1, authenticated: true, csrfVerified: true, rateGatePassed: true,
    }), { outcome: 'recorded' });
    owners.push(uid);
  }
  owners.sort();
  const eligible = [owners[16], owners[17], owners[34]];
  const disable = sqlite.prepare("UPDATE auth_principals SET status='disabled' WHERE uid=?");
  for (const uid of owners) if (!eligible.includes(uid)) disable.run(uid);

  const marker = now;
  now = earliestKindeInactivityErasureAt(marker);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
  const tick = (database = db) => runKindeInactivityEnqueueTick(database, recovery.db, 2);
  const checkpoint = () => ({ ...sqlite.prepare(
    'SELECT cursor_uid, cursor_last_recorded_at_ms FROM kinde_inactivity_enqueue_checkpoint',
  ).get() });
  const intents = () => sqlite.prepare('SELECT uid FROM kinde_account_erasure_intents ORDER BY uid')
    .all().map(row => row.uid);

  assert.deepEqual(await tick(), { outcome: 'checkpointed', decision: 'none', endOfSweep: false });
  assert.deepEqual(checkpoint(), { cursor_uid: owners[15], cursor_last_recorded_at_ms: marker });
  assert.deepEqual(intents(), []);

  assert.deepEqual(await tick(), { outcome: 'checkpointed', decision: 'recorded', endOfSweep: false });
  assert.deepEqual(checkpoint(), { cursor_uid: owners[16], cursor_last_recorded_at_ms: marker });
  assert.deepEqual(intents(), [owners[16]]);

  const lostCheckpointAck = d1For(sqlite, { afterWrite(sql) {
    if (sql.includes('UPDATE kinde_inactivity_enqueue_checkpoint') && sql.includes('SET cursor_uid')) {
      throw Error('synthetic lost checkpoint acknowledgement');
    }
  } });
  assert.deepEqual(await tick(lostCheckpointAck),
    { outcome: 'checkpointed', decision: 'recorded', endOfSweep: false });
  assert.deepEqual(checkpoint(), { cursor_uid: owners[32], cursor_last_recorded_at_ms: marker });
  assert.deepEqual(intents(), [owners[16], owners[17]]);

  assert.deepEqual(await tick(), { outcome: 'checkpointed', decision: 'recorded', endOfSweep: true });
  assert.deepEqual(checkpoint(), { cursor_uid: null, cursor_last_recorded_at_ms: null });
  assert.deepEqual(intents(), [...eligible].sort());
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM health_erasure_jobs').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
  assert.equal(recovery.sqlite.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n, 0);
});

void test('enqueue scanning does not report progress on a policy change or an ambiguous decision', async (t) => {
  const { db, sqlite, identity, write, attempt } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const clock = new DatabaseSync(':memory:');
  t.after(() => clock.close());
  const fmt = clock.prepare('SELECT strftime(?, ?) AS value');
  let now = Date.now();
  sqlite.function('strftime', (format, date) => fmt.get(format, date === 'now' ? new Date(now).toISOString() : date).value);
  await write(db, identity);
  assert.deepEqual(await recordKindeForegroundActivity(db, {
    uid: identity.uid, sessionHash: attempt.sessionHash, fenceEpoch: 1,
    authenticated: true, csrfVerified: true, rateGatePassed: true,
  }), { outcome: 'recorded' });
  now = earliestKindeInactivityErasureAt(now);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
  const liveHash = 'f'.repeat(64);
  const concurrentVisit = d1For(sqlite, { beforeWrite(sql) {
    if (sql.includes('INSERT INTO kinde_account_erasure_intents')) {
      sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)')
        .run(liveHash, identity.uid, 'c'.repeat(64), now, now + 60_000, now + 120_000);
    }
  } });
  assert.deepEqual(await scanKindeInactivityEnqueueStep(concurrentVisit, recovery.db, 2, 2),
    { decision: 'not-recorded', nextCursor: null });
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals').get().status, 'active');
  now += 120_001;
  const paused = d1For(sqlite, { beforeWrite(sql) {
    if (sql.includes('INSERT INTO kinde_account_erasure_intents')) {
      sqlite.exec("UPDATE kinde_inactivity_control SET mode='paused', generation=3");
    }
  } });
  await assert.rejects(scanKindeInactivityEnqueueStep(paused, recovery.db, 2, 2), /enqueue-scanner-unavailable/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_intents').get().n, 0);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=4");
  const hidden = d1For(sqlite, { readFirst(sql, row) {
    return sql.includes('FROM kinde_account_erasure_intents') ? null : row;
  } });
  await assert.rejects(scanKindeInactivityEnqueueStep(hidden, recovery.db, 4, 2), /decision-unavailable/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_intents').get().n, 1);
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals').get().status, 'disabled');
  assert.deepEqual(await scanKindeInactivityEnqueueStep(db, recovery.db, 4, 2),
    { decision: 'none', nextCursor: null });
  assert.deepEqual(await runOneKindeAccountErasureStep(db, recovery.db),
    { nextCursor: identity.uid, result: { outcome: 'accepted' } });
});

void test('the enqueue scheduler fences expired leases and recovers an exact lost checkpoint acknowledgement', async (t) => {
  const { db, sqlite, identity, write, attempt } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const clock = new DatabaseSync(':memory:');
  t.after(() => clock.close());
  const fmt = clock.prepare('SELECT strftime(?, ?) AS value');
  let now = Date.now();
  sqlite.function('strftime', (format, date) => fmt.get(format, date === 'now' ? new Date(now).toISOString() : date).value);
  await write(db, identity);
  assert.deepEqual(await recordKindeForegroundActivity(db, {
    uid: identity.uid, sessionHash: attempt.sessionHash, fenceEpoch: 1,
    authenticated: true, csrfVerified: true, rateGatePassed: true,
  }), { outcome: 'recorded' });
  now = earliestKindeInactivityErasureAt(now);
  const checkpoint = () => ({ ...sqlite.prepare('SELECT * FROM kinde_inactivity_enqueue_checkpoint').get() });
  const diagnostic = () => ({ ...sqlite.prepare('SELECT * FROM kinde_inactivity_scan_checkpoint').get() });
  const initial = checkpoint(), diagnosticInitial = diagnostic();
  const tick = (database = db, pin = 2) => runKindeInactivityEnqueueTick(database, recovery.db, pin);
  assert.deepEqual(await tick(), { outcome: 'not-claimed' });
  assert.deepEqual(checkpoint(), initial);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
  const lostClaim = d1For(sqlite, { afterFirst(sql) {
    if (sql.includes('RETURNING policy_generation')) throw Error('synthetic lost claim');
  } });
  await assert.rejects(tick(lostClaim), /synthetic lost claim/);
  assert.deepEqual(await tick(), { outcome: 'not-claimed' });
  now += 60_001;
  const expired = d1For(sqlite, { beforeWrite(sql) {
    if (sql.includes('INSERT INTO kinde_account_erasure_intents')) now += 60_001;
  } });
  assert.deepEqual(await tick(expired), { outcome: 'contended' });
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals').get().status, 'active');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_intents').get().n, 0);
  assert.equal(checkpoint().cursor_uid, null);
  const lostCheckpoint = d1For(sqlite, { afterWrite(sql) {
    if (sql.includes('UPDATE kinde_inactivity_enqueue_checkpoint') && sql.includes('SET cursor_uid')) {
      throw Error('synthetic lost checkpoint');
    }
  } });
  assert.deepEqual(await tick(lostCheckpoint), { outcome: 'checkpointed', decision: 'recorded', endOfSweep: true });
  assert.equal(checkpoint().lease_until_ms, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_intents').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
  assert.equal(recovery.sqlite.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n, 0);
  assert.deepEqual(diagnostic(), diagnosticInitial);
  recovery.sqlite.exec("UPDATE recovery_control SET mode='sealed', generation=3");
  recovery.sqlite.exec("UPDATE recovery_control SET mode='open', generation=4");
  const before = checkpoint();
  await assert.rejects(tick(), /independent-recovery-fence-unavailable/);
  assert.deepEqual(checkpoint(), before);
  assert.deepEqual(await tick(db, 4), { outcome: 'checkpointed', decision: 'none', endOfSweep: true });
  assert.equal(checkpoint().recovery_generation, 4);
  assert.throws(() => sqlite.exec('DELETE FROM kinde_inactivity_enqueue_checkpoint'), /enqueue-checkpoint-immutable/);
});

void test('scheduled enqueue needs two exact opt-ins and a recovery pin, then freezes at most one owner without cleanup', async (t) => {
  const { db, sqlite, identity, write, attempt } = await deletionAttemptFixture(t);
  const recovery = openRecoveryFixture(t);
  const clock = new DatabaseSync(':memory:');
  t.after(() => clock.close());
  const fmt = clock.prepare('SELECT strftime(?, ?) AS value');
  let now = Date.now();
  sqlite.function('strftime', (format, date) => fmt.get(format, date === 'now' ? new Date(now).toISOString() : date).value);
  await write(db, identity);
  assert.deepEqual(await recordKindeForegroundActivity(db, {
    uid: identity.uid, sessionHash: attempt.sessionHash, fenceEpoch: 1,
    authenticated: true, csrfVerified: true, rateGatePassed: true,
  }), { outcome: 'recorded' });
  now = earliestKindeInactivityErasureAt(now);
  const checkpoint = () => ({ ...sqlite.prepare('SELECT * FROM kinde_inactivity_enqueue_checkpoint').get() });
  const initial = checkpoint();
  const diagnostic = { ...sqlite.prepare('SELECT * FROM kinde_inactivity_scan_checkpoint').get() };
  const env = { CF06_ERASURE_RUN_ENABLED: 'enabled', CF06_ERASURE_RUN_MODE: 'inactivity-enqueue',
    CF06_INACTIVITY_ENQUEUE_ENABLED: 'enabled', CF06_INACTIVITY_RECOVERY_GENERATION: '2',
    DB: db, RECOVERY_DB: recovery.db };
  assert.deepEqual(await healthErasureWorker.scheduled({}, env), { outcome: 'not-claimed' });
  assert.deepEqual(checkpoint(), initial);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
  await assert.rejects(healthErasureWorker.scheduled({}, {
    ...env, CF06_INACTIVITY_RECOVERY_GENERATION: '1',
  }), /independent-recovery-fence-unavailable/);
  assert.deepEqual(checkpoint(), initial);
  assert.deepEqual(await healthErasureWorker.scheduled({}, env),
    { outcome: 'checkpointed', decision: 'recorded', endOfSweep: true });
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(identity.uid).status, 'disabled');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_intents').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM health_erasure_jobs').get().n, 0);
  assert.equal(recovery.sqlite.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n, 0);
  assert.deepEqual({ ...sqlite.prepare('SELECT * FROM kinde_inactivity_scan_checkpoint').get() }, diagnostic);
  assert.equal(sqlite.prepare('SELECT turn FROM erasure_dispatch_control').get().turn, 0);
  assert.deepEqual(await healthErasureWorker.scheduled({}, env),
    { outcome: 'checkpointed', decision: 'none', endOfSweep: true });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_intents').get().n, 1);
});

void test('scheduled inactivity enqueue fails closed at every D1 quota boundary and resumes without duplicate intents', async (t) => {
  async function fixture(scope) {
    const { sqlite, db, identity, write, attempt } = await deletionAttemptFixture(scope);
    const recovery = openRecoveryFixture(scope);
    const clock = new DatabaseSync(':memory:');
    scope.after(() => clock.close());
    const fmt = clock.prepare('SELECT strftime(?, ?) AS value');
    let now = Date.now();
    sqlite.function('strftime', (format, date) => fmt.get(format,
      date === 'now' ? new Date(now).toISOString() : date).value);
    await write(db, identity);
    assert.deepEqual(await recordKindeForegroundActivity(db, {
      uid: identity.uid, sessionHash: attempt.sessionHash, fenceEpoch: 1,
      authenticated: true, csrfVerified: true, rateGatePassed: true,
    }), { outcome: 'recorded' });
    now = earliestKindeInactivityErasureAt(now);
    sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");

    const calls = [];
    let failFrom = Infinity;
    function guarded(source, database) {
      return {
        withSession(policy) {
          const session = source.withSession(policy);
          return { prepare(sql) {
            function wrap(statement) {
              return { bind(...args) { return wrap(statement.bind(...args)); },
                ...Object.fromEntries(['first', 'all', 'run'].map(method => [method, async () => {
                calls.push({ database, method, sql });
                if (calls.length >= failFrom) throw Error('synthetic D1 Free quota exceeded');
                return await statement[method]();
              }])) };
            }
            return wrap(session.prepare(sql));
          } };
        },
      };
    }
    const env = {
      CF06_ERASURE_RUN_ENABLED: 'enabled', CF06_ERASURE_RUN_MODE: 'inactivity-enqueue',
      CF06_INACTIVITY_ENQUEUE_ENABLED: 'enabled', CF06_INACTIVITY_RECOVERY_GENERATION: '2',
      DB: guarded(db, 'primary'), RECOVERY_DB: guarded(recovery.db, 'recovery'),
    };
    const checkpoint = () => ({ ...sqlite.prepare('SELECT * FROM kinde_inactivity_enqueue_checkpoint').get() });
    return {
      sqlite, recovery, identity, calls, env, checkpoint,
      failAt(index) { calls.length = 0; failFrom = index; },
      afterQuotaReset() {
        calls.length = 0;
        failFrom = Infinity;
        // D1 Free daily allowances reset at midnight UTC; also expire the
        // existing 60-second lease before allowing the next scheduled tick.
        now += 24 * 60 * 60 * 1000 + 60_001;
      },
    };
  }

  let successfulStatements = 0;
  await t.test('successful bounded tick establishes the SQL operation budget', async (scope) => {
    const f = await fixture(scope);
    assert.deepEqual(await healthErasureWorker.scheduled({}, f.env),
      { outcome: 'checkpointed', decision: 'recorded', endOfSweep: true });
    assert.equal(f.calls.filter(c => c.method === 'all').length, 1);
    assert.ok(f.calls.some(c => c.database === 'primary'));
    assert.ok(f.calls.some(c => c.database === 'recovery'));
    assert.equal(f.calls.filter(c => c.method === 'run' && c.sql.includes('INSERT INTO kinde_account_erasure_intents')).length, 1);
    assert.ok(f.calls.length > 0 && f.calls.length <= 24);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_intents').get().n, 1);
    successfulStatements = f.calls.length;
  });

  // Each failure starts from a fresh valid schema. The injected D1 outage is
  // persistent after the boundary, like a Free daily quota exhaustion.
  for (let at = 1; at <= successfulStatements; at++) {
    await t.test(`quota exhausted at D1 operation ${at}`, async (scope) => {
      const f = await fixture(scope);
      const diagnostic = { ...f.sqlite.prepare('SELECT * FROM kinde_inactivity_scan_checkpoint').get() };
      f.failAt(at);
      await assert.rejects(healthErasureWorker.scheduled({}, f.env));
      assert.ok(f.calls.length >= at);
      const intentCount = f.sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_intents').get().n;
      assert.ok(intentCount === 0 || intentCount === 1);
      assert.equal(f.sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(f.identity.uid).status,
        intentCount === 1 ? 'disabled' : 'active');
      if (intentCount === 0) assert.equal(f.checkpoint().cursor_uid, null);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_requests').get().n, 0);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM health_erasure_jobs').get().n, 0);
      assert.equal(f.recovery.sqlite.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n, 0);
      assert.deepEqual({ ...f.sqlite.prepare('SELECT * FROM kinde_inactivity_scan_checkpoint').get() }, diagnostic);
      // A non-acknowledged tick may have committed its intent or checkpoint.
      // A later healthy invocation must reconcile that durable state exactly.
      f.afterQuotaReset();
      const retry = await healthErasureWorker.scheduled({}, f.env);
      assert.equal(retry.outcome, 'checkpointed');
      assert.equal(f.checkpoint().lease_until_ms, 0);
      assert.equal(f.sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(f.identity.uid).status,
        'disabled');
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_intents').get().n, 1);
      assert.equal(f.recovery.sqlite.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n, 0);
    });
  }
});
