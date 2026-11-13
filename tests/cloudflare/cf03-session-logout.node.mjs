import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import api from '../../cloudflare/api/worker.mjs';
import gate, { hashSessionSecret } from '../../cloudflare/auth/session-gate.mjs';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';

const ORIGIN = 'https://candidate.invalid';
const ACCEPT = { action: 'accept-initial', expectedRevision: 0,
  acceptance: { acceptedHealthData: true, acceptedTerms: true, confirmsOver18: true,
    privacyVersion: '1.3.9', termsVersion: '1.2.5' } };

class Statement {
  constructor(sqlite, sql, args = []) { this.sqlite = sqlite; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.sqlite, this.sql, args); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.args) }; }
  async run() {
    const outcome = this.sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: outcome.changes } };
  }
}
class D1Adapter {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  withSession(mode) { assert.equal(mode, 'first-primary'); return this; }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const out = [];
      for (const statement of statements) {
        out.push(/^\s*SELECT\b/i.test(statement.sql) ? await statement.all() : await statement.run());
      }
      this.sqlite.exec('COMMIT');
      return out;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of [
    '0001_encrypted_replica.sql', '0002_reject_reused_replica_ids.sql',
    '0003_auth_session_gate.sql',
    // First consent requires the principal and session schema.
    '0004_initial_consent.sql',
  ]) sqlite.exec(readFileSync(new URL('../../cloudflare/api/migrations/' + file, import.meta.url), 'utf8'));
  const db = new D1Adapter(sqlite);
  for (const uid of ['owner-a', 'owner-b']) {
    sqlite.prepare('INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch) VALUES (?, ?, ?, 1)')
      .run(uid, 'active', Date.now() - 60000);
  }
  const a = await issueVerifiedSession(db, 'owner-a');
  const another = await issueVerifiedSession(db, 'owner-a');
  const b = await issueVerifiedSession(db, 'owner-b');
  const cookie = a.setCookies.map(item => item.split(';')[0]).join('; ');
  const csrf = a.setCookies[1].split(';')[0].split('=')[1];
  const env = { DB: db, API_ORIGIN: ORIGIN,
    CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
    AUTH_GATE: { fetch: request => gate.fetch(request, {
      DB: db, API_ORIGIN: ORIGIN,
      CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
      API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    }) } };
  return { sqlite, db, env, cookie, csrf, a, another, b };
}
function request(f, route = '/v1/auth/logout', options = {}) {
  const headers = new Headers({
    origin: options.origin ?? ORIGIN,
    cookie: options.cookie ?? f.cookie,
    'x-csrf-token': options.csrf ?? f.csrf,
  });
  if (options.fetchSite) headers.set('sec-fetch-site', options.fetchSite);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  return new Request(options.url ?? ORIGIN + route, {
    method: options.method ?? 'POST', headers,
    ...(options.body === undefined ? {} : {
      body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    }),
  });
}
async function call(f, route = '/v1/auth/logout', options = {}) {
  const response = await api.fetch(request(f, route, options), options.env ?? f.env);
  return { response, body: await response.json() };
}
function active(sqlite, uid) {
  return sqlite.prepare('SELECT count(*) AS n FROM auth_sessions WHERE uid=? AND revoked_at_ms IS NULL').get(uid).n;
}
function clearCookies(response) {
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies.some(x => x.startsWith('__Host-logbook_session=;') && x.includes('HttpOnly') && x.includes('Max-Age=0')));
  assert.ok(cookies.some(x => x.startsWith('__Host-logbook_csrf=;') && !x.includes('HttpOnly') && x.includes('Max-Age=0')));
  assert.ok(cookies.every(x => x.includes('Secure') && x.includes('SameSite=Lax') && x.includes('Path=/')));
}
void test('the same API entry serves consent, encrypted sync and session-only logout', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/consent/status')).body.status, 'unregistered');
    assert.equal((await call(f, '/v1/consent/initial', { body: ACCEPT })).response.status, 200);
    assert.equal((await call(f, '/v1/sync/control', { body: {} })).response.status, 200);
    const result = await call(f);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, { status: 'signed-out' });
    clearCookies(result.response);
    assert.equal(active(f.sqlite, 'owner-a'), 1);
    assert.equal(active(f.sqlite, 'owner-b'), 1);
    assert.equal((await call(f, '/v1/consent/status')).response.status, 401);
    assert.equal((await call(f, '/v1/sync/control', { body: {} })).response.status, 401);
    assert.equal((await call(f)).response.status, 401);
  } finally { f.sqlite.close(); }
});
void test('logout without first consent does not implicitly grant fitness', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, '/v1/sync/control', { body: {} })).response.status, 401);
    assert.equal((await call(f)).response.status, 200);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM sync_subjects').get().n, 0);
  } finally { f.sqlite.close(); }
});
void test('unverified session can leave without gaining consent or sync', async () => {
  const f = await fixture();
  try {
    f.sqlite.prepare('INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch) VALUES (?,?,NULL,1)')
      .run('pending-owner', 'active');
    const token = Buffer.alloc(32, 19).toString('base64url');
    const csrf = Buffer.alloc(32, 23).toString('base64url');
    const now = Date.now();
    f.sqlite.prepare('INSERT INTO auth_sessions(token_hash,uid,auth_epoch,csrf_hash,issued_at_ms,idle_expires_at_ms,absolute_expires_at_ms) VALUES (?,?,?,?,?,?,?)')
      .run(await hashSessionSecret(token), 'pending-owner', 1, await hashSessionSecret(csrf), now - 1000, now + 60000, now + 120000);
    const result = await call(f, '/v1/auth/logout', {
      cookie: '__Host-logbook_session=' + token, csrf,
    });
    assert.equal(result.response.status, 200);
    assert.equal(active(f.sqlite, 'pending-owner'), 0);
    clearCookies(result.response);
  } finally { f.sqlite.close(); }
});
void test('origin, CSRF, method, body, query and owner identity are required', async () => {
  const f = await fixture();
  try {
    const invalid = [
      { origin: 'https://evil.invalid' }, { fetchSite: 'cross-site' },
      { csrf: 'bad' }, { method: 'GET' }, { body: {} },
      { url: ORIGIN + '/v1/auth/logout?x=1' }, { cookie: 'invalid=token' },
      { cookie: f.b.setCookies[0].split(';')[0], csrf: f.csrf },
    ];
    for (const opts of invalid) {
      const result = await call(f, '/v1/auth/logout', opts);
      assert.notEqual(result.response.status, 200);
      assert.equal(result.response.headers.getSetCookie().length, 0);
    }
    assert.equal(active(f.sqlite, 'owner-a'), 2);
    assert.equal(active(f.sqlite, 'owner-b'), 1);
    assert.equal((await call(f, '/v1/auth/unknown')).response.status, 404);
  } finally { f.sqlite.close(); }
});
void test('a lost D1 write response is reconciled only from primary proof', async () => {
  const f = await fixture();
  try {
    const db = {
      prepare(sql) {
        const prepared = f.db.prepare(sql);
        if (!sql.includes('UPDATE auth_sessions SET revoked_at_ms')) return prepared;
        return { bind(...params) { const statement = prepared.bind(...params);
          return { async run() { await statement.run(); throw new Error('lost response'); } };
        } };
      },
      withSession: mode => f.db.withSession(mode),
    };
    const result = await call(f, '/v1/auth/logout', { env: { ...f.env, DB: db } });
    assert.equal(result.response.status, 200);
    clearCookies(result.response);
    assert.equal(active(f.sqlite, 'owner-a'), 1);
  } finally { f.sqlite.close(); }
});
void test('failed D1 write, stale epoch or unreadable proof never clear a cookie', async () => {
  for (const fault of ['write', 'epoch', 'read']) {
    const f = await fixture();
    try {
      const db = {
        prepare(sql) {
          if (!sql.includes('UPDATE auth_sessions SET revoked_at_ms')) return f.db.prepare(sql);
          return { bind() { return { async run() {
            if (fault === 'epoch') {
              f.sqlite.exec("UPDATE auth_principals SET auth_epoch=auth_epoch+1 WHERE uid='owner-a'");
              return { success: true, meta: { changes: 0 } };
            }
            throw new Error('D1 failure');
          } }; } };
        },
        withSession(mode) {
          if (fault === 'read') throw new Error('unavailable primary');
          return f.db.withSession(mode);
        },
      };
      const result = await call(f, '/v1/auth/logout', { env: { ...f.env, DB: db } });
      assert.equal(result.response.status, 503, fault);
      assert.equal(result.response.headers.getSetCookie().length, 0);
      assert.equal(active(f.sqlite, 'owner-a'), 2);
    } finally { f.sqlite.close(); }
  }
});
void test('rate-limited or malformed internal claims cannot revoke any session', async () => {
  const f = await fixture();
  try {
    const limited = await call(f, '/v1/auth/logout', { env: {
      ...f.env, AUTH_GATE: { fetch: () => Response.json({ error: 'rate-limited' }, { status: 429 }) },
    } });
    assert.equal(limited.response.status, 429);
    const malformed = await call(f, '/v1/auth/logout', { env: {
      ...f.env, AUTH_GATE: { fetch: () => Response.json({
        uid: 'owner-a', authenticated: true, csrfVerified: true, rateGatePassed: true,
        emailVerified: true, fenceEpoch: 1, sessionHash: 'broken',
      }) },
    } });
    assert.equal(malformed.response.status, 503);
    assert.equal(active(f.sqlite, 'owner-a'), 2);
  } finally { f.sqlite.close(); }
});
