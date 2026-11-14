import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import consent from '../../cloudflare/api/consent-worker.mjs';
import apiWorker from '../../cloudflare/api/worker.mjs';
import { runOneHealthErasureStep } from '../../cloudflare/jobs/health-erasure-worker.mjs';
import sessionGate, { hashSessionSecret } from '../../cloudflare/auth/session-gate.mjs';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';

const ORIGIN = 'https://candidate.invalid';
const acceptance = {
  action: 'accept-initial', expectedRevision: 0,
  acceptance: {
    confirmsOver18: true, acceptedHealthData: true,
    acceptedTerms: true, privacyVersion: '1.3.9', termsVersion: '1.2.5',
  },
};
class Statement {
  constructor(sqlite, sql, args = []) { this.sqlite = sqlite; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.sqlite, this.sql, args); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: result.changes } };
  }
}
class D1SqliteAdapter {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  withSession(mode) { assert.equal(mode, 'first-primary'); return this; }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
async function fixture(uid = 'owner-a') {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of ['0001_encrypted_replica.sql', '0002_reject_reused_replica_ids.sql',
    '0003_auth_session_gate.sql',
        // Consent and withdrawal depend on the trusted Auth principal schema.
        '0004_initial_consent.sql', '0005_health_withdrawal_queue.sql',
    '0006_health_erasure_progress.sql']) {
    sqlite.exec(readFileSync(new URL('../../cloudflare/api/migrations/' + name, import.meta.url), 'utf8'));
  }
  const db = new D1SqliteAdapter(sqlite);
  sqlite.prepare('INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch) VALUES (?, ?, ?, ?)')
    .run(uid, 'active', Date.now() - 60000, 1);
  const issued = await issueVerifiedSession(db, uid);
  const cookie = issued.setCookies.map(item => item.split(';')[0]).join('; ');
  const csrf = issued.setCookies[1].split(';')[0].split('=')[1];
  const env = {
    DB: db, API_ORIGIN: ORIGIN, CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
    AUTH_GATE: {
      fetch: request => sessionGate.fetch(request, {
        DB: db, API_ORIGIN: ORIGIN, CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5', API_RATE_LIMITER: { limit: async () => ({ success: true }) },
      }),
    },
  };
  return { db, sqlite, env, cookie, csrf, uid };
}
function request(route, f, { body = null, csrf = f.csrf, origin = ORIGIN,
  contentType = 'application/json', cookie = f.cookie } = {}) {
  const headers = { origin, cookie, 'x-csrf-token': csrf };
  if (body !== null) headers['content-type'] = contentType;
  return new Request(ORIGIN + route, {
    method: 'POST', headers,
    ...(body === null ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
async function call(f, route, opts) {
  const response = await consent.fetch(request(route, f, opts), f.env);
  return { status: response.status, body: await response.json() };
}
function count(sqlite, table) {
  return sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
}

void test('a verified session without consent may read status but cannot use sync gate', async () => {
  const f = await fixture();
  try {
    const status = await call(f, '/v1/consent/status');
    assert.equal(status.status, 200);
    assert.deepEqual(status.body, { status: 'unregistered', revision: 0, fenceEpoch: 1 });
    const denied = await sessionGate.fetch(new Request('https://auth-gate.internal/__internal/authorize', {
      method: 'POST', headers: {
        origin: ORIGIN, cookie: f.cookie, 'x-csrf-token': f.csrf,
        'x-original-method': 'POST', 'x-original-route': '/v1/sync/control',
      },
    }), {
      DB: f.db, API_ORIGIN: ORIGIN, CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5', API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    });
    assert.equal(denied.status, 401);
    assert.equal(count(f.sqlite, 'sync_subjects'), 0);
  } finally { f.sqlite.close(); }
});

void test('first explicit acceptance commits consent, sync state and immutable proof atomically', async () => {
  const f = await fixture();
  try {
    const result = await call(f, '/v1/consent/initial', { body: acceptance });
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'active');
    assert.equal(result.body.revision, 1);
    assert.equal(result.body.fenceEpoch, 1);
    assert.equal(result.body.privacyVersion, '1.3.9');
    assert.equal(result.body.termsVersion, '1.2.5');
    assert.ok(Number.isFinite(Date.parse(result.body.acceptedAt)));
    assert.equal(count(f.sqlite, 'sync_subjects'), 1);
    assert.equal(count(f.sqlite, 'sync_state'), 1);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 1);
    assert.equal((await call(f, '/v1/consent/status')).body.status, 'active');
    const active = await sessionGate.fetch(new Request('https://auth-gate.internal/__internal/authorize', {
      method: 'POST', headers: {
        origin: ORIGIN, cookie: f.cookie, 'x-csrf-token': f.csrf,
        'x-original-method': 'POST', 'x-original-route': '/v1/sync/control',
      },
    }), {
      DB: f.db, API_ORIGIN: ORIGIN, CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5', API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    });
    assert.equal(active.status, 200);
    assert.throws(() => f.sqlite.exec("UPDATE health_consent_acceptances SET privacy_version = 'bad'"));
    const repeated = await call(f, '/v1/consent/initial', { body: acceptance });
    assert.equal(repeated.status, 409);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 1);
  } finally { f.sqlite.close(); }
});

void test('invalid intent, missing age/legal check or mismatched versions never create state', async () => {
  const f = await fixture();
  try {
    const cases = [
      { ...acceptance, expectedRevision: 1 },
      { ...acceptance, acceptance: { ...acceptance.acceptance, confirmsOver18: false } },
      { ...acceptance, acceptance: { ...acceptance.acceptance, acceptedTerms: false } },
      { ...acceptance, acceptance: { ...acceptance.acceptance, acceptedHealthData: false } },
      { ...acceptance, acceptance: { ...acceptance.acceptance, privacyVersion: 'future' } },
      { ...acceptance, acceptance: { ...acceptance.acceptance, termsVersion: 'old' } },
      { ...acceptance, uid: f.uid },
      { action: 'withdraw', expectedRevision: 0 },
    ];
    for (const body of cases) {
      const result = await call(f, '/v1/consent/initial', { body });
      assert.equal(result.status, 400);
    }
    assert.equal((await call(f, '/v1/consent/initial', {
      body: acceptance, csrf: 'invalid',
    })).status, 403);
    assert.equal((await call(f, '/v1/consent/initial', {
      body: acceptance, origin: 'https://other.invalid',
    })).status, 403);
    assert.equal(count(f.sqlite, 'sync_subjects'), 0);
  } finally { f.sqlite.close(); }
});

void test('session revoked after gate result cannot publish a consent row', async () => {
  const f = await fixture();
  try {
    const liveGate = f.env.AUTH_GATE;
    f.env.AUTH_GATE = {
      async fetch(input) {
        const response = await liveGate.fetch(input);
        f.sqlite.exec("UPDATE auth_sessions SET revoked_at_ms=issued_at_ms WHERE uid='owner-a'");
        return response;
      },
    };
    const result = await call(f, '/v1/consent/initial', { body: acceptance });
    assert.equal(result.status, 503);
    assert.equal(count(f.sqlite, 'sync_subjects'), 0);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 0);
  } finally { f.sqlite.close(); }
});

void test('a late SQL failure rolls back both initial grant and sync state', async () => {
  const f = await fixture();
  try {
    f.sqlite.exec('CREATE TRIGGER synthetic_abort BEFORE INSERT ON health_consent_acceptances BEGIN SELECT RAISE(ABORT, \'synthetic-failure\'); END');
    const result = await call(f, '/v1/consent/initial', { body: acceptance });
    assert.equal(result.status, 503);
    assert.equal(count(f.sqlite, 'sync_subjects'), 0);
    assert.equal(count(f.sqlite, 'sync_state'), 0);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 0);
  } finally { f.sqlite.close(); }
});

void test('an active subject without its immutable acceptance cannot be reported as trusted', async () => {
  const f = await fixture();
  try {
    f.sqlite.prepare('INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,?,?,?)')
      .run(f.uid, 'active', 1, 1);
    f.sqlite.prepare('INSERT INTO sync_state(uid,revision) VALUES (?,0)').run(f.uid);
    const status = await call(f, '/v1/consent/status');
    assert.equal(status.status, 503);
  } finally { f.sqlite.close(); }
});

void test('separate identities never adopt another account consent', async () => {
  const f = await fixture();
  try {
    const other = 'owner-b';
    f.sqlite.prepare('INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch) VALUES (?,?,?,?)')
      .run(other, 'active', Date.now() - 60000, 1);
    const otherSession = await issueVerifiedSession(f.db, other);
    const b = {
      ...f,
      cookie: otherSession.setCookies.map(item => item.split(';')[0]).join('; '),
      csrf: otherSession.setCookies[1].split(';')[0].split('=')[1],
    };
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    assert.equal((await call(b, '/v1/consent/status')).body.status, 'unregistered');
    assert.equal(count(f.sqlite, 'sync_subjects'), 1);
  } finally { f.sqlite.close(); }
});


void test('accepted consent from superseded legal versions cannot authorize sync', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    const response = await sessionGate.fetch(new Request('https://auth-gate.internal/__internal/authorize', {
      method: 'POST', headers: {
        origin: ORIGIN, cookie: f.cookie,
        'x-original-method': 'POST', 'x-original-route': '/v1/sync/control',
      },
    }), {
      DB: f.db, API_ORIGIN: ORIGIN, CONSENT_PRIVACY_VERSION: '1.3.10',
      CONSENT_TERMS_VERSION: '1.2.5',
      API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    });
    assert.equal(response.status, 401);
    // Status remains visible so the account can be directed to the
    // explicit legal-update flow; a read does not grant cloud writes.
    assert.equal((await call(f, '/v1/consent/status')).body.status, 'active');
  } finally { f.sqlite.close(); }
});

void test('a consent fence newer than the Auth principal cannot be presented as current', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    f.sqlite.exec("UPDATE sync_subjects SET fence_epoch = 2 WHERE uid = 'owner-a'");
    const response = await call(f, '/v1/consent/status');
    assert.equal(response.status, 503);
    assert.equal('acceptedAt' in response.body, false);
  } finally { f.sqlite.close(); }
});


void test('invalid consent instructions consume neither Auth rate gate nor D1 consent writes', async () => {
  const f = await fixture();
  try {
    let attempts = 0;
    f.env.AUTH_GATE.fetch = async () => {
      attempts += 1;
      throw new Error('malformed request must not reach Auth gate');
    };
    const invalid = await call(f, '/v1/consent/initial', {
      body: { ...acceptance, acceptance: { ...acceptance.acceptance, acceptedHealthData: false } },
    });
    assert.equal(invalid.status, 400);
    const malformed = await call(f, '/v1/consent/initial', { body: '{invalid json' });
    assert.equal(malformed.status, 400);
    const statusBody = await call(f, '/v1/consent/status', { body: acceptance });
    assert.equal(statusBody.status, 400);
    assert.equal(attempts, 0);
    assert.equal(count(f.sqlite, 'sync_subjects'), 0);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 0);
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 503);
    assert.equal(attempts, 1);
  } finally { f.sqlite.close(); }
});


void test('a revocation between the identity gate and status read returns no consent proof', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    const originalGate = f.env.AUTH_GATE;
    f.env.AUTH_GATE = {
      async fetch(input) {
        const response = await originalGate.fetch(input);
        f.sqlite.exec("UPDATE auth_sessions SET revoked_at_ms=issued_at_ms WHERE uid='owner-a'");
        return response;
      },
    };
    const status = await call(f, '/v1/consent/status');
    assert.equal(status.status, 503);
    assert.equal('acceptedAt' in status.body, false);
  } finally { f.sqlite.close(); }
});

void test('revision greater than one cannot reuse the first acceptance as an active grant', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    f.sqlite.exec("UPDATE sync_subjects SET consent_revision = 2 WHERE uid = 'owner-a'");
    const status = await call(f, '/v1/consent/status');
    assert.equal(status.status, 503);
    assert.equal('acceptedAt' in status.body, false);
  } finally { f.sqlite.close(); }
});

const withdrawal = { action: 'withdraw', expectedRevision: 1, confirmsErasure: true };

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
  } finally { f.sqlite.close(); }
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
  } finally { f.sqlite.close(); }
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
  } finally { f.sqlite.close(); }
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
  } finally { f.sqlite.close(); }
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
  } finally { f.sqlite.close(); }
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
  } finally { f.sqlite.close(); }
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
  } finally { f.sqlite.close(); }
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
  } finally { f.sqlite.close(); }
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
  } finally { f.sqlite.close(); }
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
  } finally { f.sqlite.close(); }
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
  } finally { f.sqlite.close(); }
});

void test('missing withdrawal schema fails closed without changing consent state', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    f.sqlite.exec('DROP TABLE health_erasure_jobs');
    const response = await call(f, '/v1/consent/withdraw', { body: withdrawal });
    assert.equal(response.status, 503);
    assert.equal(f.sqlite.prepare('SELECT status FROM sync_subjects').get().status, 'active');
  } finally { f.sqlite.close(); }
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
  } finally { f.sqlite.close(); }
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
  } finally { f.sqlite.close(); }
});
