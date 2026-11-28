import assert from 'node:assert/strict';
import { applyCurrentD1Schema } from './current-d1-schema.mjs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { issueVerifiedSession, SessionIssuanceError } from '../../cloudflare/auth/session-issuer.mjs';
import gate, { hashSessionSecret } from '../../cloudflare/auth/session-gate.mjs';
import { D1_NOW_MS } from '../../cloudflare/sql/d1-time.mjs';

const ORIGIN = 'https://candidate.example.invalid';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  applyCurrentD1Schema(sqlite);
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            sql,
            async run() {
              const outcome = sqlite.prepare(sql).run(...params);
              return { success: true, meta: { changes: outcome.changes } };
            },
            async first() {
              return sqlite.prepare(sql).get(...params) ?? null;
            },
            async all() {
              return { success: true, results: sqlite.prepare(sql).all(...params) };
            },
          };
        },
      };
    },
    withSession(mode) {
      assert.equal(mode, 'first-primary');
      return this;
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) {
          results.push(/^\s*SELECT\b/i.test(statement.sql)
            ? await statement.all() : await statement.run());
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const now = Date.now();
  sqlite.prepare('INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch) VALUES (?,?,?,?)')
    .run('verified-a', 'active', now - 10000, 1);
  return { db, sqlite };
}

function tokens(issued) {
  assert.equal(issued.setCookies.length, 2);
  const session = issued.setCookies[0].match(/^__Host-logbook_session=([A-Za-z0-9_-]{43});/);
  const csrf = issued.setCookies[1].match(/^__Host-logbook_csrf=([A-Za-z0-9_-]{43});/);
  assert.ok(session);
  assert.ok(csrf);
  return { session: session[1], csrf: csrf[1] };
}

void test('issuer creates 32-byte random session and host-only CSRF cookies after verified principal', async () => {
  const { db, sqlite } = fixture();
  try {
    const readClock = sqlite.prepare(`SELECT ${D1_NOW_MS} AS ms`);
    const before = readClock.get().ms;
    const first = await issueVerifiedSession(db, 'verified-a');
    const second = await issueVerifiedSession(db, 'verified-a');
    const after = readClock.get().ms;
    const a = tokens(first);
    const b = tokens(second);
    assert.notEqual(a.session, b.session);
    assert.notEqual(a.csrf, b.csrf);
    assert.match(first.setCookies[0], /; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800$/);
    assert.match(first.setCookies[1], /; Path=\/; Secure; SameSite=Lax; Max-Age=604800$/);
    assert.doesNotMatch(first.setCookies[1], /HttpOnly/);
    assert.ok(first.idleExpiresAtMs >= before + 604800000);
    assert.ok(first.idleExpiresAtMs <= after + 604800000);
    assert.ok(first.absoluteExpiresAtMs >= before + 2592000000);
    assert.ok(first.absoluteExpiresAtMs <= after + 2592000000);
    const rows = sqlite.prepare('SELECT * FROM auth_sessions WHERE uid = ?').all('verified-a');
    assert.equal(rows.length, 2);
    assert.equal(rows.filter(row => row.revoked_at_ms === null).length, 1);
    const firstHash = await hashSessionSecret(a.session);
    const secondHash = await hashSessionSecret(b.session);
    assert.ok(rows.find(row => row.token_hash === firstHash)?.revoked_at_ms >= before);
    assert.equal(rows.find(row => row.token_hash === secondHash)?.revoked_at_ms, null);
    assert.ok(rows.every(row => row.token_hash !== a.session && row.csrf_hash !== a.csrf));
    const expectedSessionHash = await hashSessionSecret(a.session);
    assert.ok(rows.some(row => row.token_hash === expectedSessionHash));
    assert.equal(rows[0].auth_epoch, 1);
    // Both browser sessions remain auditable; only the latest is accepted.
    const env = { DB: db, API_ORIGIN: ORIGIN,
      API_RATE_LIMITER: { limit: async () => ({ success: true }) } };
    const status = (session, csrf) => gate.fetch(new Request('https://auth-gate.internal/__internal/authorize', {
      method: 'POST', headers: {
        origin: ORIGIN, 'x-original-route': '/v1/consent/status', 'x-original-method': 'POST',
        cookie: '__Host-logbook_session=' + session + '; __Host-logbook_csrf=' + csrf,
      },
    }), env);
    assert.equal((await status(a.session, a.csrf)).status, 401);
    assert.equal((await status(b.session, b.csrf)).status, 200);
  } finally { sqlite.close(); }
});

void test('a failed new issuance preserves the existing session and never revokes another owner', async () => {
  const { db, sqlite } = fixture();
  try {
    sqlite.prepare('INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch) VALUES (?,?,?,?)')
      .run('verified-b', 'active', Date.now() - 10000, 1);
    const a = tokens(await issueVerifiedSession(db, 'verified-a'));
    const b = tokens(await issueVerifiedSession(db, 'verified-b'));
    const aHash = await hashSessionSecret(a.session);
    const bHash = await hashSessionSecret(b.session);
    // Reject revocation after the issuer's INSERT. A D1 batch must roll back
    // the new row and keep the previous login usable, including across owners.
    sqlite.exec(`CREATE TRIGGER synthetic_reject_revoke BEFORE UPDATE OF revoked_at_ms ON auth_sessions
      BEGIN SELECT RAISE(ABORT, 'synthetic failed revocation'); END`);
    await assert.rejects(issueVerifiedSession(db, 'verified-a'), SessionIssuanceError);
    assert.equal(sqlite.prepare('SELECT revoked_at_ms FROM auth_sessions WHERE token_hash=?').get(aHash).revoked_at_ms, null);
    assert.equal(sqlite.prepare('SELECT revoked_at_ms FROM auth_sessions WHERE token_hash=?').get(bHash).revoked_at_ms, null);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 2);
  } finally { sqlite.close(); }
});

void test('a verified account can create a session before initial health consent, not sync', async () => {
  const { db, sqlite } = fixture();
  try {
    const issued = await issueVerifiedSession(db, 'verified-a');
    assert.equal(tokens(issued).session.length, 43);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sync_subjects').get().count, 0);
  } finally { sqlite.close(); }
});

void test('unverified, disabled, deleted, future-verified and invalid principal cannot issue', async () => {
  const mutations = [
    "UPDATE auth_principals SET verified_at_ms=NULL, auth_epoch=auth_epoch+1 WHERE uid='verified-a'",
    "UPDATE auth_principals SET status='disabled' WHERE uid='verified-a'",
    "UPDATE auth_principals SET status='deleted' WHERE uid='verified-a'",
    "UPDATE auth_principals SET verified_at_ms=9999999999999 WHERE uid='verified-a'",
  ];
  for (const mutation of mutations) {
    const { db, sqlite } = fixture();
    try {
      sqlite.exec(mutation);
      await assert.rejects(issueVerifiedSession(db, 'verified-a'), SessionIssuanceError);
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get().count, 0);
    } finally { sqlite.close(); }
  }
  const { db, sqlite } = fixture();
  try {
    for (const uid of ['', '/not-owner', ' verified-a', 'other-owner']) {
      await assert.rejects(issueVerifiedSession(db, uid), SessionIssuanceError);
    }
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get().count, 0);
  } finally { sqlite.close(); }
});

void test('a provider error or missing issuance row never produces a cookie', async () => {
  const { sqlite } = fixture();
  try {
    const broken = {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    };
    await assert.rejects(issueVerifiedSession(broken, 'verified-a'), SessionIssuanceError);
    const failed = {
      prepare: () => ({ bind: () => ({ first: async () => { throw Error('synthetic D1 outage'); } }) }),
    };
    await assert.rejects(issueVerifiedSession(failed, 'verified-a'), SessionIssuanceError);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get().count, 0);
  } finally { sqlite.close(); }
});

void test('newly issued cookie is valid only under current consent and epoch; CSRF is session-bound', async () => {
  const { db, sqlite } = fixture();
  try {
    const issued = await issueVerifiedSession(db, 'verified-a');
    const { session, csrf } = tokens(issued);
    const header = () => ({
      origin: ORIGIN,
      'x-original-route': '/v1/sync/commit',
      'x-original-method': 'POST',
      cookie: '__Host-logbook_session=' + session + '; __Host-logbook_csrf=' + csrf,
      'x-csrf-token': csrf,
    });
    const env = {
      DB: db, API_ORIGIN: ORIGIN, CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
      API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    };
    const call = () => gate.fetch(new Request('https://auth-gate.internal/__internal/authorize', {
      method: 'POST', headers: header(),
    }), env);
    // The session itself does not authorize a first consent.
    assert.equal((await call()).status, 401);
    sqlite.prepare('INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,?,?,?)')
      .run('verified-a', 'active', 1, 1);
    sqlite.prepare('INSERT INTO sync_state(uid,revision) VALUES (?,?)').run('verified-a', 0);
    sqlite.prepare('INSERT INTO health_consent_acceptances(uid,consent_revision,privacy_version,terms_version,accepted_at_ms,over_18_confirmed) VALUES (?,1,?,?,?,1)')
      .run('verified-a', '1.3.9', '1.2.5', Date.now() - 1000);
    const active = await call();
    assert.equal(active.status, 200);
    assert.deepEqual((await active.json()).uid, 'verified-a');
    sqlite.exec("UPDATE auth_principals SET auth_epoch=2 WHERE uid='verified-a'");
    assert.equal((await call()).status, 401);
  } finally { sqlite.close(); }
});
