import assert from 'node:assert/strict';
import { test } from 'node:test';
import apiWorker from '../../cloudflare/api/worker.mjs';
import erasureWorker, { runOneHealthErasureStep } from '../../cloudflare/jobs/health-erasure-worker.mjs';
import sessionGate, { hashSessionSecret } from '../../cloudflare/auth/session-gate.mjs';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';
import { ORIGIN, acceptance, withdrawal, fixture, request, call, count } from './cf05-consent-fixture.mjs';

void test('trusted withdrawal atomically fences sync and queues erasure without claiming completion', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    const outcome = await call(f, '/v1/consent/withdraw', { body: withdrawal });
    assert.deepEqual(outcome, { status: 200, body: {
      status: 'withdrawn', revision: 1, fenceEpoch: 1, deletionStatus: 'pending',
    } });
    assert.equal(f.sqlite.prepare('SELECT status FROM sync_subjects').get().status, 'withdrawn');
    const job = f.sqlite.prepare('SELECT * FROM health_erasure_jobs').get();
    assert.equal(job.uid, f.uid);
    assert.equal(job.consent_revision, 1);
    assert.equal(job.fence_epoch, 1);
    assert.equal(job.status, 'pending');
    assert.ok(job.requested_at_ms > 0);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 1);
    const blocked = await sessionGate.fetch(new Request('https://auth-gate.internal/__internal/authorize', {
      method: 'POST', headers: { origin: ORIGIN, cookie: f.cookie,
        'x-original-method': 'POST', 'x-original-route': '/v1/sync/control' },
    }), { DB: f.db, API_ORIGIN: ORIGIN, CONSENT_PRIVACY_VERSION: '1.3.9',
      CONSENT_TERMS_VERSION: '1.2.5', API_RATE_LIMITER: { limit: async () => ({ success: true }) } });
    assert.equal(blocked.status, 401);
    assert.equal((await call(f, '/v1/consent/status')).body.status, 'withdrawn');
    assert.equal((await call(f, '/v1/consent/withdraw', { body: withdrawal })).status, 200);
    assert.equal(count(f.sqlite, 'health_erasure_jobs'), 1);
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 409);
  } finally { f.close(); }
});

void test('withdrawal requires explicit intent, valid CSRF and a pre-existing consent', async () => {
  const f = await fixture();
  try {
    const pre = await call(f, '/v1/consent/withdraw', { body: withdrawal });
    assert.equal(pre.status, 409);
    assert.equal(count(f.sqlite, 'health_erasure_jobs'), 0);
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    for (const body of [
      { ...withdrawal, confirmsErasure: false },
      { ...withdrawal, expectedRevision: 0 },
      { ...withdrawal, uid: f.uid },
      { action: 'withdraw', expectedRevision: 1 },
      { ...withdrawal, action: 'accept-initial' },
    ]) {
      assert.equal((await call(f, '/v1/consent/withdraw', { body })).status, 400);
    }
    assert.equal((await call(f, '/v1/consent/withdraw', { body: withdrawal, csrf: 'bad' })).status, 403);
    assert.equal((await call(f, '/v1/consent/withdraw', { body: withdrawal, origin: 'https://evil.invalid' })).status, 403);
    assert.equal(count(f.sqlite, 'health_erasure_jobs'), 0);
    assert.equal(f.sqlite.prepare('SELECT status FROM sync_subjects').get().status, 'active');
  } finally { f.close(); }
});

void test('revocation between private AuthGate and D1 cannot enqueue or withdraw consent', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    const gate = f.env.AUTH_GATE;
    f.env.AUTH_GATE = { async fetch(request) {
      const result = await gate.fetch(request);
      f.sqlite.exec("UPDATE auth_sessions SET revoked_at_ms=issued_at_ms WHERE uid='owner-a'");
      return result;
    } };
    const result = await call(f, '/v1/consent/withdraw', { body: withdrawal });
    assert.equal(result.status, 503);
    assert.equal(count(f.sqlite, 'health_erasure_jobs'), 0);
    assert.equal(f.sqlite.prepare('SELECT status FROM sync_subjects').get().status, 'active');
  } finally { f.close(); }
});

void test('a failed trigger cannot leave a pending job without a withdrawn subject', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    f.sqlite.exec(`CREATE TRIGGER synthetic_no_withdraw BEFORE UPDATE ON sync_subjects
      BEGIN SELECT RAISE(ABORT, 'synthetic-failure'); END`);
    const result = await call(f, '/v1/consent/withdraw', { body: withdrawal });
    assert.equal(result.status, 503);
    assert.equal(count(f.sqlite, 'health_erasure_jobs'), 0);
    assert.equal(f.sqlite.prepare('SELECT status FROM sync_subjects').get().status, 'active');
    assert.equal(f.registry.prepare('SELECT status FROM recovery_owner_fences').get().status, 'blocked');
    assert.equal((await call(f, '/v1/consent/status')).status, 503);
    assert.equal((await apiWorker.fetch(request('/v1/sync/control', f, { body: {} }), f.env)).status, 503);
    f.sqlite.exec('DROP TRIGGER synthetic_no_withdraw');
    assert.equal((await call(f, '/v1/consent/withdraw', { body: withdrawal })).status, 200);
    assert.equal(f.registry.prepare('SELECT status FROM recovery_owner_fences').get().status, 'withdrawn');
  } finally { f.close(); }
});

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

void test('withdrawal is owner-scoped and never affects another principal', async () => {
  const f = await fixture();
  try {
    f.sqlite.prepare('INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch) VALUES (?,?,?,?)')
      .run('owner-b', 'active', Date.now() - 60000, 1);
    const bSession = await issueVerifiedSession(f.db, 'owner-b');
    const b = { ...f, uid: 'owner-b',
      cookie: bSession.setCookies.map(x => x.split(';')[0]).join('; '),
      csrf: bSession.setCookies[1].split(';')[0].split('=')[1],
    };
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    assert.equal((await call(b, '/v1/consent/withdraw', { body: withdrawal })).status, 409);
    assert.equal((await call(f, '/v1/consent/withdraw', { body: withdrawal })).status, 200);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM health_erasure_jobs WHERE uid='owner-b'").get().n, 0);
    assert.equal(f.sqlite.prepare("SELECT status FROM sync_subjects WHERE uid='owner-a'").get().status, 'withdrawn');
  } finally { f.close(); }
});

void test('withdrawal remains possible after email verification is lost and Auth epoch advances', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    f.sqlite.exec("UPDATE auth_principals SET verified_at_ms=NULL, auth_epoch=2 WHERE uid='owner-a'");
    const token = Buffer.alloc(32, 57).toString('base64url');
    const csrf = Buffer.alloc(32, 58).toString('base64url');
    const now = Date.now();
    f.sqlite.prepare(`
      INSERT INTO auth_sessions (token_hash,uid,auth_epoch,csrf_hash,
        issued_at_ms,idle_expires_at_ms,absolute_expires_at_ms)
      VALUES (?,?,?,?,?,?,?)
    `).run(await hashSessionSecret(token), f.uid, 2, await hashSessionSecret(csrf),
      now - 1000, now + 60000, now + 3600000);
    f.cookie = '__Host-logbook_session=' + token + '; __Host-logbook_csrf=' + csrf;
    f.csrf = csrf;
    const outcome = await call(f, '/v1/consent/withdraw', { body: withdrawal });
    assert.equal(outcome.status, 200);
    assert.equal(outcome.body.status, 'withdrawn');
    assert.equal(outcome.body.deletionStatus, 'pending');
    assert.equal(outcome.body.fenceEpoch, 2);
    assert.equal(f.sqlite.prepare('SELECT fence_epoch,status FROM sync_subjects').get().status, 'withdrawn');
    assert.equal(f.sqlite.prepare('SELECT fence_epoch FROM health_erasure_jobs').get().fence_epoch, 1);
    assert.equal((await call(f, '/v1/consent/status')).body.status, 'withdrawn');
  } finally { f.close(); }
});

void test('removing the original consent proof after AuthGate prevents withdrawal job creation', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    const originalGate = f.env.AUTH_GATE;
    f.env.AUTH_GATE = { async fetch(request) {
      const result = await originalGate.fetch(request);
      f.sqlite.exec('DELETE FROM health_consent_acceptances');
      return result;
    } };
    const response = await call(f, '/v1/consent/withdraw', { body: withdrawal });
    assert.equal(response.status, 503);
    assert.equal(count(f.sqlite, 'health_erasure_jobs'), 0);
    assert.equal(f.sqlite.prepare('SELECT status FROM sync_subjects').get().status, 'active');
  } finally { f.close(); }
});

void test('the unified API dispatches withdrawal without granting sync or deleting data', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    const response = await apiWorker.fetch(request('/v1/consent/withdraw', f, { body: withdrawal }), f.env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).deletionStatus, 'pending');
    assert.equal(count(f.sqlite, 'health_erasure_jobs'), 1);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 1);
  } finally { f.close(); }
});

void test('revocation can be requested even if current legal-version configuration is unavailable', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    delete f.env.CONSENT_PRIVACY_VERSION;
    delete f.env.CONSENT_TERMS_VERSION;
    const response = await call(f, '/v1/consent/withdraw', { body: withdrawal });
    assert.equal(response.status, 200);
    assert.equal(response.body.deletionStatus, 'pending');
    assert.equal(f.sqlite.prepare('SELECT status FROM sync_subjects').get().status, 'withdrawn');
  } finally { f.close(); }
});

void test('missing withdrawal schema fails closed without changing consent state', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    f.sqlite.exec('DROP TABLE health_erasure_jobs');
    const response = await call(f, '/v1/consent/withdraw', { body: withdrawal });
    assert.equal(response.status, 503);
    assert.equal(f.sqlite.prepare('SELECT status FROM sync_subjects').get().status, 'active');
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
    assert.equal((await erasureWorker.scheduled({}, f.env)).outcome, 'awaiting-keys');
    // Advance the synthetic lease clock; the genuine bounded finalizer
    // must produce the immutable SQL proof and advance only the subject.
    f.sqlite.prepare(
      "UPDATE health_erasure_jobs SET lease_until_ms=? WHERE uid=? AND status='processing'"
    ).run(Date.now() - 1000, f.uid);
    assert.deepEqual(await erasureWorker.scheduled({}, f.env),
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
