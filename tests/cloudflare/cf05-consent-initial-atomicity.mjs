import assert from 'node:assert/strict';
import { test } from 'node:test';
import sessionGate from '../../cloudflare/auth/session-gate.mjs';
import { ORIGIN, acceptance, fixture, call, count } from './cf05-consent-fixture.mjs';

void test('synthetic D1 batch returns SELECT rows and rolls back a failed mixed batch', async () => {
  const f = await fixture();
  try {
    f.sqlite.exec('CREATE TABLE synthetic_batch_probe (value INTEGER NOT NULL CHECK(value >= 0))');
    const successful = await f.db.batch([
      f.db.prepare('INSERT INTO synthetic_batch_probe (value) VALUES (?)').bind(3),
      f.db.prepare('SELECT value FROM synthetic_batch_probe WHERE value = ?').bind(3),
    ]);
    assert.equal(successful[0].success, true);
    assert.equal(successful[0].meta.changes, 1);
    assert.deepEqual(successful[1].results, [{ value: 3 }]);

    await assert.rejects(f.db.batch([
      f.db.prepare('INSERT INTO synthetic_batch_probe (value) VALUES (?)').bind(7),
      f.db.prepare('INSERT INTO synthetic_batch_probe (value) VALUES (?)').bind(-1),
    ]));
    assert.deepEqual(f.sqlite.prepare('SELECT value FROM synthetic_batch_probe ORDER BY value').all().map(row => row.value),
      [3]);
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
    assert.equal(count(f.sqlite, 'sync_state'), 0);
    assert.equal(count(f.sqlite, 'health_consent_acceptances'), 0);
    assert.equal(count(f.registry, 'recovery_owner_fences'), 0);
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
