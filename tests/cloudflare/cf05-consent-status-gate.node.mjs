import assert from 'node:assert/strict';
import { test } from 'node:test';
import consent from '../../cloudflare/api/consent-worker.mjs';
import apiWorker from '../../cloudflare/api/worker.mjs';
import sessionGate from '../../cloudflare/auth/session-gate.mjs';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';
import { ORIGIN, acceptance, withdrawal, fixture, call, count } from './cf05-consent-fixture.mjs';

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

void test('active consent exposes the earlier D1 session expiry only for a current verified request', async () => {
  const f = await fixture();
  try {
    const header = 'X-Logbook-Session-Expires-At-Ms';
    const status = (csrf = f.csrf) => apiWorker.fetch(new Request(ORIGIN + '/v1/consent/status', {
      method: 'POST', headers: { origin: ORIGIN, cookie: f.cookie, 'x-csrf-token': csrf },
    }), f.env);
    assert.equal((await status()).headers.get(header), null);
    assert.equal((await call(f, '/v1/consent/initial', { body: acceptance })).status, 200);

    const shorter = Date.now() + 60_000;
    const longer = shorter + 60_000;
    const setExpiry = f.sqlite.prepare(
      'UPDATE auth_sessions SET idle_expires_at_ms=?, absolute_expires_at_ms=? WHERE uid=?',
    );
    for (const absolute of [longer, shorter]) {
      setExpiry.run(shorter, absolute, f.uid);
      const active = await status();
      assert.equal(active.status, 200);
      assert.equal(active.headers.get('Cache-Control'), 'no-store');
      assert.equal(active.headers.get(header), String(shorter));
      assert.equal('sessionExpiresAtMs' in await active.json(), false);
    }
    assert.equal((await status('')).headers.get(header), null);
    const expired = Date.now() - 1000;
    f.sqlite.prepare('UPDATE auth_sessions SET issued_at_ms=? WHERE uid=?').run(expired - 1000, f.uid);
    setExpiry.run(expired, longer, f.uid);
    const denied = await status();
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get(header), null);
    setExpiry.run(shorter, longer, f.uid);
    f.env.CONSENT_PRIVACY_VERSION = 'new-policy';
    const outdated = await status();
    assert.equal(outdated.status, 200);
    assert.equal(outdated.headers.get(header), null);
    f.env.CONSENT_PRIVACY_VERSION = acceptance.acceptance.privacyVersion;
    assert.equal((await call(f, '/v1/consent/withdraw', { body: withdrawal })).status, 200);
    const withdrawn = await status();
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.headers.get(header), null);
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
    const authorize = (privacyVersion, termsVersion) => sessionGate.fetch(
      new Request('https://auth-gate.internal/__internal/authorize', {
        method: 'POST', headers: {
          origin: ORIGIN, cookie: f.cookie,
          'x-original-method': 'POST', 'x-original-route': '/v1/sync/control',
        },
      }), {
        DB: f.db, API_ORIGIN: ORIGIN,
        CONSENT_PRIVACY_VERSION: privacyVersion, CONSENT_TERMS_VERSION: termsVersion,
        API_RATE_LIMITER: { limit: async () => ({ success: true }) },
      },
    );
    // This read-only sync route uses trusted Auth and consent; the
    // per-session CSRF token is additionally required for mutations.
    assert.equal((await authorize('1.3.9', '1.2.5')).status, 200);
    assert.equal((await authorize('1.3.10', '1.2.5')).status, 401);
    assert.equal((await authorize('1.3.9', '1.2.6')).status, 401);
    assert.equal((await authorize('1.3.9', '1.2.5')).status, 200);
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
