import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { D1_NOW_MS } from '../../cloudflare/sql/d1-time.mjs';
import { activeSessionPredicateSql } from '../../cloudflare/auth/session-write-fence.mjs';
import { hashSessionSecret } from '../../cloudflare/auth/session-gate.mjs';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';
import { acceptance, call, fixture } from './cf05-consent-fixture.mjs';
import { createCloudKeyHttpFixture, SYNC } from './cloud-key-http-fixture.mjs';

void test('D1 clock uses integer milliseconds, including fixed second boundaries', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const [date, expected] of [
      ['1970-01-01 00:00:00.000', 0],
      ['1970-01-01 00:00:01.999', 1999],
      ['2026-11-14 18:50:59.999', 1794682259999],
    ]) {
      const expression = D1_NOW_MS.replaceAll("'now'", "'" + date + "'");
      const result = db.prepare('SELECT ' + expression + ' AS ms').get();
      assert.equal(result.ms, expected);
    }
    assert.equal(activeSessionPredicateSql.includes(D1_NOW_MS), true);
    assert.doesNotMatch(activeSessionPredicateSql, /julianday/);
  } finally { db.close(); }
});

void test('session issuance, initial consent and the sync fence agree even when the Worker clock is ahead', async t => {
  const f = await fixture();
  try {
    const before = f.sqlite.prepare(`SELECT ${D1_NOW_MS} AS ms`).get().ms;
    const workerTime = before + 300_000;
    t.mock.method(Date, 'now', () => workerTime);
    const issued = await issueVerifiedSession(f.db, f.uid);
    const cookie = issued.setCookies.map(item => item.split(';')[0]).join('; ');
    const csrf = issued.setCookies[1].split(';')[0].split('=')[1];
    const hash = await hashSessionSecret(issued.setCookies[0].split(';')[0].split('=')[1]);
    const session = f.sqlite.prepare(`
      SELECT token_hash, issued_at_ms FROM auth_sessions
      WHERE token_hash = ?
    `).get(hash);
    assert.ok(session.issued_at_ms >= before && session.issued_at_ms < workerTime);

    const response = await call(f, '/v1/consent/initial', { body: acceptance, cookie, csrf });
    assert.equal(response.status, 200);
    const consent = f.sqlite.prepare('SELECT accepted_at_ms FROM health_consent_acceptances WHERE uid=?').get(f.uid);
    assert.ok(consent.accepted_at_ms >= session.issued_at_ms && consent.accepted_at_ms < workerTime);

    const allowedAt = time => {
      const sql = activeSessionPredicateSql.replaceAll("'now'", "'" + time + "'");
      return f.sqlite.prepare('SELECT ' + sql + ' AS allowed').get(session.token_hash, f.uid, 1).allowed;
    };
    const sqlDate = ms => new Date(ms).toISOString().slice(0, -1).replace('T', ' ');
    assert.equal(allowedAt(sqlDate(consent.accepted_at_ms - 1)), 0);
    assert.equal(allowedAt(sqlDate(consent.accepted_at_ms)), 1);
    assert.equal(allowedAt(sqlDate(issued.idleExpiresAtMs)), 0);
  } finally { f.close(); }
});

void test('ADK HTTP uses the primary D1 clock to recheck consent and session after AuthGate', async t => {
  const uid = 'owner-a';
  const f = await createCloudKeyHttpFixture([uid]);
  try {
    await f.consent(uid);
    const consent = f.sqlite.prepare('SELECT accepted_at_ms FROM health_consent_acceptances WHERE uid=?').get(uid);
    const session = f.sqlite.prepare('SELECT idle_expires_at_ms FROM auth_sessions WHERE uid=?').get(uid);
    // SQLite is left on its own clock. Simulate a Worker behind fresh consent,
    // then ahead of the idle limit, while D1 considers the session active.
    let workerTime = consent.accepted_at_ms - 1;
    t.mock.method(Date, 'now', () => workerTime);
    assert.equal((await f.call(uid, SYNC)).response.status, 200, 'Worker behind consent');
    workerTime = session.idle_expires_at_ms + 1;
    assert.equal((await f.call(uid, SYNC)).response.status, 200, 'Worker ahead of session expiry');
    assert.equal(f.count('cloud_key_issuance', uid), 1);
  } finally { f.close(); }
});
