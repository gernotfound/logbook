import assert from 'node:assert/strict';
import { test } from 'node:test';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import worker from '../../cloudflare/api/worker.mjs';
import { syntheticSessionHash, origin, owner, replica, withFixture, envelope, attempt, makeEnv, call } from './cf02-documents-fixture.mjs';

void test('primary D1 commit status distinguishes inconclusive, proven non-commit and immutable receipt', () => withFixture(async db => {
  const original = attempt('batchstatusoriginal01');
  const status = {
    batchId: original.batchId, expectedRevision: original.expectedRevision,
    expectedFenceEpoch: original.expectedFenceEpoch,
    consentRevision: original.consentRevision, requestHash: 'a'.repeat(64),
  };
  // A missing receipt at the current expected revision is not proof that an
  // in-flight request cannot commit.
  assert.deepEqual(await call(db, 'commit/status', status), {
    status: 200, body: { outcome: 'inconclusive', currentRevision: 0 },
  });
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM sync_receipts').get().n, 0);

  const winner = attempt('batchstatuswinner002');
  assert.equal((await call(db, 'commit', winner)).status, 200);
  assert.deepEqual(await call(db, 'commit/status', status), {
    status: 200, body: { outcome: 'not-committed', currentRevision: 1 },
  });
  // The original CAS cannot ever commit under revision 1, even if the
  // HTTP reply to that original request was lost.
  assert.equal((await call(db, 'commit', original)).status, 409);
  assert.equal((await call(db, 'receipt', { batchId: original.batchId })).body.receipt, null);

  const originalReceipt = (await call(db, 'receipt', { batchId: winner.batchId })).body.receipt;
  assert.equal(typeof originalReceipt.requestHash, 'string');
  const committedStatus = { ...status, batchId: winner.batchId, requestHash: originalReceipt.requestHash };
  assert.deepEqual(await call(db, 'commit/status', committedStatus), {
    status: 200, body: { outcome: 'committed', currentRevision: 1 },
  });
  assert.deepEqual(await call(db, 'commit/status', { ...committedStatus, requestHash: 'f'.repeat(64) }), {
    status: 409, body: { error: 'batch-id-conflict' },
  });

  const later = attempt('batchstatuslater003', 2, 1);
  assert.equal((await call(db, 'commit', later)).status, 200);
  assert.deepEqual(await call(db, 'commit/status', committedStatus), {
    status: 200, body: { outcome: 'committed', currentRevision: 2 },
  });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 2);
}));

void test('commit status requires original epoch, session-bound CSRF and live trusted SQL session', () => withFixture(async db => {
  const body = {
    batchId: 'batchstatusguard001', expectedRevision: 0, expectedFenceEpoch: 5,
    consentRevision: 1, requestHash: 'a'.repeat(64),
  };
  assert.deepEqual(await call(db, 'commit/status', { ...body, requestHash: 'not-a-hash' }), {
    status: 400, body: { error: 'invalid-input' },
  });
  assert.equal((await call(db, 'commit/status', { ...body, expectedFenceEpoch: 6 })).status, 403);
  assert.equal((await call(db, 'commit/status', body, {
    env: makeEnv(db, { csrfVerified: false }),
  })).status, 403);
  db.sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms = ? WHERE token_hash = ?')
    .run(Date.now(), syntheticSessionHash);
  assert.equal((await call(db, 'commit/status', body)).status, 403);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
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

void test('a multi-sequence batch preserves per-document clocks below its writer sequence', () => withFixture(async db => {
  const item = attempt('batch000000000077', 2, 0, ['', 'nutrition_months/2026-11']);
  item.documents[0].document = envelope(1);
  item.documents[0].document._sync.writer.seq = 2;
  // This root was last touched at seq 1, while the month was touched at seq 2.
  // The batch writer always reports lastSeq=2, exactly like Firestore Protocol 3.
  const result = await call(db, 'commit', item);
  assert.equal(result.status, 200);
  assert.equal(result.body.lastSeq, 2);
  const read = await call(db, 'read', { paths: ['', 'nutrition_months/2026-11'] });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.documents.map(x => x.document._sync.clock.s00), [1, 2]);
  assert.deepEqual(read.body.documents.map(x => x.document._sync.writer.seq), [2, 2]);
  assert.equal((await call(db, 'commit', item)).body.replayed, true);
  assert.equal(db.sqlite.prepare('SELECT last_seq FROM sync_replicas').get().last_seq, 2);
}));

void test('up to eight individually bounded documents do not trip a smaller HTTP body cap', () => withFixture(async db => {
  const paths = Array.from({ length: 8 }, (_, i) =>
    `history_months/2026-${String(i + 1).padStart(2, '0')}`);
  const item = attempt('batch000000000078', 1, 0, paths);
  for (const doc of item.documents) doc.document._sealed.ciphertext = 'B'.repeat(250000);
  assert.ok(Buffer.byteLength(JSON.stringify(item)) > 1800000);
  const saved = await call(db, 'commit', item);
  assert.equal(saved.status, 200);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_documents').get().n, 8);
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
  // A claimed epoch alone cannot reauthorize the original session.
  const forgedEpoch = await call(db, 'receipt', { batchId: batch.batchId },
    { env: makeEnv(db, { fenceEpoch: 6 }) });
  assert.deepEqual(forgedEpoch, { status: 403, body: { error: 'access-revoked' } });

  db.sqlite.prepare('UPDATE auth_principals SET auth_epoch = 6 WHERE uid = ?').run(owner);
  const now = Date.now();
  const freshSessionHash = 'd'.repeat(64);
  db.sqlite.prepare('INSERT INTO auth_sessions (token_hash,uid,auth_epoch,csrf_hash,issued_at_ms,idle_expires_at_ms,absolute_expires_at_ms) VALUES (?,?,?,?,?,?,?)')
    .run(freshSessionHash, owner, 6, 'e'.repeat(64), now - 1000, now + 86400000, now + 2592000000);
  const newSession = await call(db, 'receipt', { batchId: batch.batchId },
    { env: makeEnv(db, { fenceEpoch: 6, sessionHash: freshSessionHash }) });
  // New auth epoch has no independent recovery enrollment. A fresh main-D1
  // session alone cannot authorize even the absence of an old receipt.
  assert.deepEqual(newSession, { status: 503, body: { error: 'cloud-unavailable' } });
}));

void test('revision-2 consent cannot reuse the initial proof or old receipts', () => withFixture(async db => {
  const batch = attempt('batch000000000066');
  assert.equal((await call(db, 'commit', batch)).status, 200);
  // Reacceptance is not implemented: changing only the subject revision
  // cannot turn the immutable revision-1 acceptance into a valid new grant.
  db.sqlite.prepare('UPDATE sync_subjects SET consent_revision = 2 WHERE uid = ?').run(owner);
  assert.deepEqual(await call(db, 'receipt', { batchId: batch.batchId }),
    { status: 403, body: { error: 'access-revoked' } });
  assert.deepEqual(await call(db, 'receipt', { batchId: batch.batchId },
    { env: makeEnv(db, { healthConsentRevision: 2 }) }),
    { status: 403, body: { error: 'access-revoked' } });
}));

void test('D1 account generation cannot regress or reactivate without fresh consent and epoch', () => withFixture(async db => {
  db.sqlite.prepare("UPDATE sync_subjects SET status = 'withdrawn' WHERE uid = ?").run(owner);
  assert.throws(() => db.sqlite.prepare("UPDATE sync_subjects SET status = 'active' WHERE uid = ?").run(owner),
    /subject-fence-regression/);
  assert.throws(() => db.sqlite.prepare('UPDATE sync_subjects SET consent_revision = 0 WHERE uid = ?').run(owner),
    /subject-fence-regression/);
  assert.throws(() => db.sqlite.prepare('UPDATE sync_subjects SET fence_epoch = 4 WHERE uid = ?').run(owner),
    /subject-fence-regression/);
  assert.throws(() => db.sqlite.prepare("UPDATE sync_subjects SET status = 'active', consent_revision = 2 WHERE uid = ?").run(owner),
    /subject-fence-regression/);
  assert.throws(() => db.sqlite.prepare("UPDATE sync_subjects SET status = 'active', fence_epoch = 6 WHERE uid = ?").run(owner),
    /subject-fence-regression/);
  db.sqlite.prepare("UPDATE sync_subjects SET status = 'active', consent_revision = 2, fence_epoch = 6 WHERE uid = ?").run(owner);
  const reactivated = db.sqlite.prepare(
    'SELECT status, consent_revision, fence_epoch FROM sync_subjects WHERE uid = ?',
  ).get(owner);
  assert.equal(reactivated.status, 'active');
  assert.equal(reactivated.consent_revision, 2);
  assert.equal(reactivated.fence_epoch, 6);
  // An old consent/epoch request cannot write even if the control revision
  // is reused after a trusted reset in a future lifecycle implementation.
  const old = await call(db, 'commit', attempt('batch000000000079'));
  assert.equal(old.status, 403);
  db.sqlite.prepare("UPDATE sync_subjects SET status = 'deleted' WHERE uid = ?").run(owner);
  assert.throws(() => db.sqlite.prepare("UPDATE sync_subjects SET status = 'active', consent_revision = 3, fence_epoch = 7 WHERE uid = ?").run(owner),
    /subject-fence-regression/);
}));

void test('a batch from an erased account epoch cannot resurrect data at reset revision', () => withFixture(async db => {
  const stale = attempt('batch000000000035', 1, 0);
  db.sqlite.prepare('UPDATE sync_subjects SET fence_epoch = 6 WHERE uid = ?').run(owner);
  const result = await call(db, 'commit', stale, { env: makeEnv(db, { fenceEpoch: 6 }) });
  assert.deepEqual(result, { status: 403, body: { error: 'access-revoked' } });
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
  assert.equal((await call(db, 'commit', item, { env: makeEnv(db, { fenceEpoch: 4 }) })).status, 403);
  assert.equal((await call(db, 'commit', { ...item, expectedFenceEpoch: 4 })).status, 409);
  assert.equal((await call(db, 'commit', item, { env: makeEnv(db, { healthConsentRevision: 2 }) })).status, 403);
  assert.equal((await call(db, 'commit', { ...item, uid: 'other-user' })).status, 400);
  assert.equal((await call(db, 'commit', { ...item, documents: [{ path: '', document: { ...envelope(), health: 'plaintext' } }] })).status, 400);
  assert.equal((await call(db, 'commit', { ...item, documents: [{ path: '../escape', document: envelope() }] })).status, 400);
  const futureCausalDot = envelope();
  futureCausalDot._sync.clock.s00 = 2;
  assert.equal((await call(db, 'commit', { ...item, documents: [{ path: '', document: futureCausalDot }] })).status, 400);
  const missingCausalDot = envelope();
  delete missingCausalDot._sync.clock.s00;
  assert.equal((await call(db, 'commit', { ...item, documents: [{ path: '', document: missingCausalDot }] })).status, 400);
  assert.equal((await call(db, 'commit', { ...item, documents: [{ path: '', document: envelope() }, { path: '', document: envelope() }] })).status, 400);
  db.sqlite.prepare("UPDATE sync_subjects SET status = 'withdrawn' WHERE uid = ?").run(owner);
  assert.equal((await call(db, 'read', { paths: [''] })).status, 403);
  assert.equal((await call(db, 'commit', item)).status, 403);
  assert.equal(db.sqlite.prepare('SELECT count(*) as n FROM sync_documents').get().n, 0);
}));

