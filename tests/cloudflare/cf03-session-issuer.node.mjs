import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { issueVerifiedSession, SessionIssuanceError } from '../../cloudflare/auth/session-issuer.mjs';
import gate, { hashSessionSecret } from '../../cloudflare/auth/session-gate.mjs';

const ORIGIN = 'https://candidate.example.invalid';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of [
    '0001_encrypted_replica.sql', '0002_reject_reused_replica_ids.sql', '0003_auth_session_gate.sql',
  ]) {
    sqlite.exec(readFileSync(new URL('../../cloudflare/api/migrations/' + name, import.meta.url), 'utf8'));
  }
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              const outcome = sqlite.prepare(sql).run(...params);
              return { success: true, meta: { changes: outcome.changes } };
            },
            async first() {
              return sqlite.prepare(sql).get(...params) ?? null;
            },
          };
        },
      };
    },
    withSession(mode) {
      assert.equal(mode, 'first-primary');
      return this;
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
    const before = Date.now();
    const first = await issueVerifiedSession(db, 'verified-a');
    const second = await issueVerifiedSession(db, 'verified-a');
    const after = Date.now();
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
    assert.ok(rows.every(row => row.token_hash !== a.session && row.csrf_hash !== a.csrf));
    const expectedSessionHash = await hashSessionSecret(a.session);
    assert.ok(rows.some(row => row.token_hash === expectedSessionHash));
    assert.equal(rows[0].auth_epoch, 1);
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

void test('a provider error or missing affected-row proof never produces a cookie', async () => {
  const { sqlite } = fixture();
  try {
    const broken = {
      prepare: () => ({ bind: () => ({ run: async () => ({ success: true, meta: { changes: 0 } }) }) }),
    };
    await assert.rejects(issueVerifiedSession(broken, 'verified-a'), SessionIssuanceError);
    const failed = {
      prepare: () => ({ bind: () => ({ run: async () => { throw Error('synthetic D1 outage'); } }) }),
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
      DB: db, API_ORIGIN: ORIGIN,
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
    const active = await call();
    assert.equal(active.status, 200);
    assert.deepEqual((await active.json()).uid, 'verified-a');
    sqlite.exec("UPDATE auth_principals SET auth_epoch=2 WHERE uid='verified-a'");
    assert.equal((await call()).status, 401);
  } finally { sqlite.close(); }
});
