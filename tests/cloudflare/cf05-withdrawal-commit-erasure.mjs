import assert from 'node:assert/strict';
import { test } from 'node:test';
import erasureWorker, { runOneHealthErasureStep } from '../../cloudflare/jobs/health-erasure-worker.mjs';
import sessionGate from '../../cloudflare/auth/session-gate.mjs';
import { ORIGIN, acceptance, withdrawal, fixture, call, count } from './cf05-consent-fixture.mjs';

void test('lost write acknowledgement is accepted only with a matching primary job and current session', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    const db = f.db;
    f.env.DB = {
      ...db,
      prepare(sql) {
        if (sql.includes('INSERT INTO health_erasure_jobs')) {
          const stmt = db.prepare(sql);
          return { bind(...args) { return { async run() {
            await stmt.bind(...args).run();
            throw Error('synthetic lost ACK after commit');
          } }; } };
        }
        return db.prepare(sql);
      },
      withSession: mode => db.withSession(mode),
    };
    const result = await call(f, '/v1/consent/withdraw', { body: withdrawal });
    assert.equal(result.status, 200);
    assert.equal(result.body.deletionStatus, 'pending');
    assert.equal(count(f.sqlite, 'health_erasure_jobs'), 1);
  } finally { f.close(); }
});

void test('no fabricated withdrawal acknowledgement after commit if session was revoked', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    const db = f.db;
    f.env.DB = {
      ...db,
      prepare(sql) {
        if (sql.includes('INSERT INTO health_erasure_jobs')) {
          const stmt = db.prepare(sql);
          return { bind(...args) { return { async run() {
            await stmt.bind(...args).run();
            f.sqlite.exec("UPDATE auth_sessions SET revoked_at_ms=issued_at_ms WHERE uid='owner-a'");
            throw Error('synthetic lost ACK and session revocation');
          } }; } };
        }
        return db.prepare(sql);
      },
      withSession: mode => db.withSession(mode),
    };
    const result = await call(f, '/v1/consent/withdraw', { body: withdrawal });
    assert.equal(result.status, 503);
    assert.equal(count(f.sqlite, 'health_erasure_jobs'), 1);
    assert.equal(f.sqlite.prepare('SELECT status FROM sync_subjects').get().status, 'withdrawn');
  } finally { f.close(); }
});

void test('a job insert for a mismatched generation aborts and cannot revoke a different subject', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    assert.throws(() => f.sqlite.prepare(`
      INSERT INTO health_erasure_jobs
        (uid,consent_revision,fence_epoch,requested_at_ms,status)
      VALUES (?,2,1,?,'pending')
    `).run(f.uid, Date.now()), /withdrawal-fenced/);
    assert.equal(count(f.sqlite, 'health_erasure_jobs'), 0);
    assert.equal(f.sqlite.prepare('SELECT status FROM sync_subjects').get().status, 'active');
  } finally { f.close(); }
});

void test('withdrawal replay stays acknowledged as processing while erasure is incomplete', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    assert.equal((await call(f, '/v1/consent/withdraw', { body: withdrawal })).status, 200);
    const step = await runOneHealthErasureStep(f.db);
    assert.equal(step.outcome, 'awaiting-keys');
    const repeated = await call(f, '/v1/consent/withdraw', { body: withdrawal });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.deletionStatus, 'processing');
    assert.equal((await call(f, '/v1/consent/status')).body.status, 'withdrawn');
    assert.equal(f.sqlite.prepare('SELECT status,phase FROM health_erasure_jobs').get().phase, 'awaiting-keys');
  } finally { f.close(); }
});

void test('terminal erasure keeps consent status readable without restoring the fitness grant', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    assert.equal((await call(f, '/v1/consent/withdraw', { body: withdrawal })).status, 200);
    assert.equal((await erasureWorker.scheduled({}, { ...f.env, CF06_ERASURE_RUN_ENABLED: 'enabled' })).outcome, 'awaiting-keys');
    // Advance the synthetic lease clock; the genuine bounded finalizer
    // must produce the immutable SQL proof and advance only the subject.
    f.sqlite.prepare(
      "UPDATE health_erasure_jobs SET lease_until_ms=? WHERE uid=? AND status='processing'"
    ).run(Date.now() - 1000, f.uid);
    assert.deepEqual(await erasureWorker.scheduled({}, { ...f.env, CF06_ERASURE_RUN_ENABLED: 'enabled' }),
      { outcome: 'complete', keyDisposition: 'never-issued' });

    const state = f.sqlite.prepare([
      'SELECT s.status, s.consent_revision, s.fence_epoch, s.erased_before_revision,',
      'p.auth_epoch, j.status AS job_status, f.key_disposition',
      'FROM sync_subjects s JOIN auth_principals p ON p.uid=s.uid',
      'JOIN health_erasure_jobs j ON j.uid=s.uid',
      'JOIN health_erasure_finalizations f ON f.uid=s.uid',
      'WHERE s.uid=?',
    ].join(' ')).get(f.uid);
    assert.equal(state.status, 'withdrawn');
    assert.equal(state.consent_revision, 2);
    assert.equal(state.fence_epoch, 2);
    assert.equal(state.erased_before_revision, 2);
    assert.equal(state.auth_epoch, 1);
    assert.equal(state.job_status, 'complete');
    assert.equal(state.key_disposition, 'never-issued');
    assert.deepEqual(await call(f, '/v1/consent/status'), {
      status: 200, body: { uid: f.uid, status: 'withdrawn', revision: 2, fenceEpoch: 2 },
    });

    const denied = await sessionGate.fetch(new Request('https://auth-gate.internal/__internal/authorize', {
      method: 'POST', headers: {
        origin: ORIGIN, cookie: f.cookie,
        'x-original-method': 'POST', 'x-original-route': '/v1/sync/control',
      },
    }), {
      DB: f.db, API_ORIGIN: ORIGIN, CONSENT_PRIVACY_VERSION: '1.3.9',
      CONSENT_TERMS_VERSION: '1.2.5',
      API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    });
    assert.equal(denied.status, 401);
    assert.equal(count(f.sqlite, 'cloud_account_keys'), 0);
    assert.equal(count(f.sqlite, 'sync_documents'), 0);
  } finally { f.close(); }
});

void test('a forged future withdrawn epoch without an immutable erasure proof is never readable', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    assert.equal((await call(f, '/v1/consent/withdraw', { body: withdrawal })).status, 200);
    // Fault injection: a direct SQL writer advances the suspended subject
    // without a completed job. This must not appear to be terminal erasure.
    f.sqlite.prepare('UPDATE sync_subjects SET fence_epoch=2 WHERE uid=?').run(f.uid);
    const result = await call(f, '/v1/consent/status');
    assert.equal(result.status, 503);
    assert.equal('status' in result.body, false);
    assert.equal(count(f.sqlite, 'health_erasure_finalizations'), 0);
    assert.equal(f.sqlite.prepare('SELECT status FROM health_erasure_jobs').get().status, 'pending');
  } finally { f.close(); }
});
