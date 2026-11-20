import assert from 'node:assert/strict';
import { test } from 'node:test';
import apiWorker from '../../cloudflare/api/worker.mjs';
import sessionGate from '../../cloudflare/auth/session-gate.mjs';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';
import { ORIGIN, acceptance, withdrawal, fixture, request, call, count } from './cf05-consent-fixture.mjs';

void test('consent status accepts a gateway-forwarded empty stream, never forged Content-Length', async () => {
  const f = await fixture();
  const oldGate = f.env.AUTH_GATE;
  let gateCalls = 0;
  f.env.AUTH_GATE = { fetch: async input => { gateCalls += 1; return oldGate.fetch(input); } };
  try {
    const send = async (chunks, claimedLength = '0') => {
      const body = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
          controller.close();
        },
      });
      const req = new Request(ORIGIN + '/v1/consent/status', {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: f.cookie, 'x-csrf-token': f.csrf,
          'content-length': claimedLength },
        body, duplex: 'half',
      });
      const response = await consent.fetch(req, f.env);
      return { status: response.status, body: await response.json() };
    };
    const valid = await send([[], []]);
    assert.equal(valid.status, 200);
    assert.deepEqual(valid.body, { uid: f.uid, status: 'unregistered', revision: 0, fenceEpoch: 1 });
    assert.equal(gateCalls, 1);
    for (const [chunks, declared] of [
      [[[123]], '0'], [[[0]], '0'], [[[], [32]], '0'], [[[]], '1'],
    ]) {
      const bad = await send(chunks, declared);
      assert.equal(bad.status, 400);
      assert.deepEqual(bad.body, { error: 'invalid-body' });
      assert.equal(gateCalls, 1);
    }
    assert.equal(count(f.sqlite, 'sync_subjects'), 0);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 0);
  } finally { f.close(); }
});

void test('a verified session without consent may read status but cannot use sync gate', async () => {
  const f = await fixture();
  try {
    const status = await call(f, '/v1/consent/status');
    assert.equal(status.status, 200);
    assert.deepEqual(status.body, { uid: f.uid, status: 'unregistered', revision: 0, fenceEpoch: 1 });
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
  } finally { f.close(); }
});


void test('consent status returns the exact trusted SQL owner for all five states', async () => {
  const f = await fixture();
  try {
    const expected = (status, revision) => ({
      uid: f.uid, status, revision, fenceEpoch: 1,
    });
    assert.deepEqual((await call(f, '/v1/consent/status')).body,
      expected('unregistered', 0));
    const accepted = await call(f, '/v1/consent/initial', { body: acceptance });
    assert.equal(accepted.status, 200);
    const acceptedAtMs = f.sqlite.prepare(
      'SELECT accepted_at_ms FROM health_consent_acceptances WHERE uid=?',
    ).get(f.uid).accepted_at_ms;
    const active = { ...expected('active', 1),
      acceptedAt: new Date(acceptedAtMs).toISOString(),
      privacyVersion: '1.3.9', termsVersion: '1.2.5' };
    assert.deepEqual(accepted.body, active);
    assert.deepEqual((await call(f, '/v1/consent/status')).body, active);

    const withdrawn = await call(f, '/v1/consent/withdraw', {
      body: { action: 'withdraw', expectedRevision: 1, confirmsErasure: true },
    });
    assert.equal(withdrawn.status, 200);
    assert.deepEqual((await call(f, '/v1/consent/status')).body,
      expected('withdrawn', 1));

    for (const state of ['deleting', 'deleted']) {
      f.sqlite.prepare('UPDATE sync_subjects SET status=? WHERE uid=?').run(state, f.uid);
      assert.deepEqual((await call(f, '/v1/consent/status')).body, expected(state, 1));
    }
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 1);
  } finally { f.close(); }
});

void test('consent status cannot substitute a forged owner or stale trusted gate session', async () => {
  const f = await fixture();
  try {
    const forged = new Request(ORIGIN + '/v1/consent/status', {
      method: 'POST', headers: {
        origin: ORIGIN, cookie: f.cookie, 'x-csrf-token': f.csrf,
        'x-user-id': 'owner-b', 'x-original-route': '/v1/consent/status',
      },
    });
    const response = await consent.fetch(forged, f.env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(),
      { uid: f.uid, status: 'unregistered', revision: 0, fenceEpoch: 1 });

    const trusted = f.env.AUTH_GATE;
    f.env.AUTH_GATE = { async fetch(request) {
      const allowed = await trusted.fetch(request);
      const claims = await allowed.json();
      return Response.json({ ...claims, uid: 'owner-b' });
    } };
    const mismatch = await call(f, '/v1/consent/status');
    assert.equal(mismatch.status, 503);
    assert.equal('uid' in mismatch.body, false);
  } finally { f.close(); }
});

void test('first explicit acceptance commits consent, sync state and immutable proof atomically', async () => {
  const f = await fixture();
  try {
    const result = await call(f, '/v1/consent/initial', { body: acceptance });
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'active');
    assert.equal(result.body.uid, f.uid);
    assert.equal(result.body.revision, 1);
    assert.equal(result.body.fenceEpoch, 1);
    assert.equal(result.body.privacyVersion, '1.3.9');
    assert.equal(result.body.termsVersion, '1.2.5');
    assert.ok(Number.isFinite(Date.parse(result.body.acceptedAt)));
    assert.equal(count(f.sqlite, 'sync_subjects'), 1);
    assert.equal(count(f.sqlite, 'sync_state'), 1);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 1);
    assert.deepEqual({ ...f.registry.prepare(
      'SELECT status,consent_revision,change_seq FROM recovery_owner_fences WHERE uid=?',
    ).get(f.uid) }, { status: 'active', consent_revision: 1, change_seq: 2 });
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
  } finally { f.close(); }
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
  } finally { f.close(); }
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
  } finally { f.close(); }
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
  } finally { f.close(); }
});

void test('an active subject without its immutable acceptance cannot be reported as trusted', async () => {
  const f = await fixture();
  try {
    f.sqlite.prepare('INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,?,?,?)')
      .run(f.uid, 'active', 1, 1);
    f.sqlite.prepare('INSERT INTO sync_state(uid,revision) VALUES (?,0)').run(f.uid);
    const status = await call(f, '/v1/consent/status');
    assert.equal(status.status, 503);
  } finally { f.close(); }
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
    assert.deepEqual((await call(b, '/v1/consent/status')).body,
      { uid: other, status: 'unregistered', revision: 0, fenceEpoch: 1 });
    assert.equal(count(f.sqlite, 'sync_subjects'), 1);
  } finally { f.close(); }
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
  } finally { f.close(); }
});

void test('a consent fence newer than the Auth principal cannot be presented as current', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    f.sqlite.exec("UPDATE sync_subjects SET fence_epoch = 2 WHERE uid = 'owner-a'");
    const response = await call(f, '/v1/consent/status');
    assert.equal(response.status, 503);
    assert.equal('acceptedAt' in response.body, false);
  } finally { f.close(); }
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
  } finally { f.close(); }
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
  } finally { f.close(); }
});

void test('revision greater than one cannot reuse the first acceptance as an active grant', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);
    f.sqlite.exec("UPDATE sync_subjects SET consent_revision = 2 WHERE uid = 'owner-a'");
    const status = await call(f, '/v1/consent/status');
    assert.equal(status.status, 503);
    assert.equal('acceptedAt' in status.body, false);
  } finally { f.close(); }
});

void test('unbound, aliased or sealed independent consent registry cannot start first consent', async () => {
  const f = await fixture();
  try {
    for (const RECOVERY_DB of [undefined, f.db]) {
      f.env.RECOVERY_DB = RECOVERY_DB;
      assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 503);
    }
    f.env.RECOVERY_DB = f.recoveryDb;
    f.registry.exec("UPDATE recovery_control SET mode='sealed',generation=3 WHERE singleton=1");
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 503);
    assert.equal(count(f.registry, 'recovery_owner_fences'), 0);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 0);
  } finally { f.close(); }
});

void test('lost first-consent batch response can be confirmed from both committed stores', async () => {
  const f = await fixture();
  try {
    const batch = f.db.batch.bind(f.db);
    f.db.batch = async statements => {
      await batch(statements);
      throw new Error('synthetic lost response after SQL commit');
    };
    const accepted = await call(f, '/v1/consent/initial', { body: acceptance });
    assert.equal(accepted.status, 200);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 1);
    assert.equal(f.registry.prepare('SELECT status FROM recovery_owner_fences').get().status, 'active');
  } finally { f.close(); }
});

void test('status reconciles a stranded first consent only with verified session CSRF', async () => {
  const f = await fixture();
  try {
    f.registry.exec(`CREATE TRIGGER synthetic_no_promote BEFORE UPDATE ON recovery_owner_fences
      WHEN NEW.status='active' BEGIN SELECT RAISE(ABORT, 'unavailable'); END`);
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 503);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 1);
    assert.equal(f.registry.prepare('SELECT status FROM recovery_owner_fences').get().status, 'pending');
    assert.equal((await apiWorker.fetch(request('/v1/sync/control', f, { body: {} }), f.env)).status, 503);
    f.registry.exec('DROP TRIGGER synthetic_no_promote');
    assert.equal((await call(f, '/v1/consent/status', { csrf: '' })).status, 503);
    assert.equal(f.registry.prepare('SELECT status FROM recovery_owner_fences').get().status, 'pending');
    assert.equal((await call(f, '/v1/consent/status')).body.status, 'active');
    assert.equal((await call(f, '/v1/consent/status')).body.status, 'active');
    assert.equal(f.registry.prepare('SELECT change_seq FROM recovery_owner_fences').get().change_seq, 2);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 1);
  } finally { f.close(); }
});

void test('withdrawal denies a stranded first consent without ever promoting it to active', async () => {
  const f = await fixture();
  try {
    f.registry.exec(`CREATE TRIGGER synthetic_no_promote BEFORE UPDATE ON recovery_owner_fences
      WHEN NEW.status='active' BEGIN SELECT RAISE(ABORT, 'unavailable'); END`);
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 503);
    assert.equal((await call(f, '/v1/consent/withdraw', { body: withdrawal })).status, 200);
    assert.deepEqual({ ...f.registry.prepare(
      'SELECT status,consent_revision,change_seq FROM recovery_owner_fences WHERE uid=?',
    ).get(f.uid) }, { status: 'withdrawn', consent_revision: 1, change_seq: 3 });
    f.registry.exec('DROP TRIGGER synthetic_no_promote');
    assert.equal((await call(f, '/v1/consent/status')).body.status, 'withdrawn');
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 409);
  } finally { f.close(); }
});
