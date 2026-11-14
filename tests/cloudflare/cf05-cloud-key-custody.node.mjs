import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import gate from '../../cloudflare/auth/session-gate.mjs';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';
import {
  CloudKeyUnavailableError, wrapCloudAccountDataKey, unwrapCloudAccountDataKey,
} from '../../cloudflare/api/cloud-key-crypto.mjs';
import { releaseCloudAccountDataKey } from '../../cloudflare/api/cloud-key-store.mjs';

const ORIGIN = 'https://cf05-synthetic.invalid';
const KEK = Buffer.alloc(32, 42).toString('base64');
const VERSION = '1.3.9';
const TERMS = '1.2.5';
const FILES = readdirSync(new URL('../../cloudflare/api/migrations/', import.meta.url))
  .filter(name => /^000[1-7]_[a-z0-9_]+\.sql$/.test(name)).sort();
assert.deepEqual(FILES.map(file => file.slice(0, 4)),
  Array.from({ length: 7 }, (_, index) => String(index + 1).padStart(4, '0')));
class Statement {
  constructor(sqlite, sql, args = []) { this.sqlite = sqlite; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.sqlite, this.sql, args); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: result.changes } };
  }
}
class D1Sqlite {
  constructor(sqlite) { this.sqlite = sqlite; }
  withSession(mode) { assert.equal(mode, 'first-primary'); return this; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
}
function sqlCount(f, table, uid) {
  return f.sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table + ' WHERE uid = ?').get(uid).n;
}
async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of FILES) {
    sqlite.exec(readFileSync(new URL('../../cloudflare/api/migrations/' + file, import.meta.url), 'utf8'));
  }
  const db = new D1Sqlite(sqlite);
  const env = {
    DB: db, CLOUD_ACCOUNT_KEK_V1: KEK, API_ORIGIN: ORIGIN,
    CONSENT_PRIVACY_VERSION: VERSION, CONSENT_TERMS_VERSION: TERMS,
    API_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  const sessions = new Map();
  async function createOwner(uid) {
    const now = Date.now();
    sqlite.prepare('INSERT INTO auth_principals (uid,status,verified_at_ms,auth_epoch) VALUES (?, ?, ?, 1)')
      .run(uid, 'active', now - 10_000);
    sqlite.prepare("INSERT INTO sync_subjects (uid,status,consent_revision,fence_epoch) VALUES (?, 'active', 1, 1)")
      .run(uid);
    sqlite.prepare('INSERT INTO sync_state (uid,revision) VALUES (?,0)').run(uid);
    sqlite.prepare(`INSERT INTO health_consent_acceptances
      (uid,consent_revision,privacy_version,terms_version,accepted_at_ms,over_18_confirmed)
      VALUES (?,1,?,?,?,1)`).run(uid, VERSION, TERMS, now - 5_000);
    const issued = await issueVerifiedSession(db, uid);
    const cookie = issued.setCookies.map(value => value.split(';')[0]).join('; ');
    const csrf = issued.setCookies[1].split(';')[0].split('=')[1];
    sessions.set(uid, { cookie, csrf });
    return uid;
  }
  async function claims(uid, route = '/v1/sync/commit', csrfValue) {
    const tokens = sessions.get(uid);
    const response = await gate.fetch(new Request('https://auth-gate.internal/__internal/authorize', {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: tokens.cookie,
        'x-original-method': 'POST', 'x-original-route': route,
        'x-csrf-token': csrfValue === undefined ? tokens.csrf : csrfValue },
    }), env);
    return { status: response.status, payload: await response.json() };
  }
  await createOwner('owner-a');
  return { sqlite, db, env, createOwner, claims };
}

void test('WebCrypto ADK envelope: strict AES-256-GCM owner/AAD, nonce and version binding', async () => {
  const adk = new Uint8Array(32).fill(89);
  const sealed = await wrapCloudAccountDataKey('owner-a', adk, KEK);
  assert.deepEqual(Object.keys(sealed).sort(), [
    'ciphertext','format','iv','keyVersion','tag','uid','version',
  ]);
  assert.notEqual(sealed.ciphertext, Buffer.from(adk).toString('base64'));
  const repeated = await wrapCloudAccountDataKey('owner-a', adk, KEK);
  assert.notEqual(repeated.iv, sealed.iv);
  assert.deepEqual(await unwrapCloudAccountDataKey('owner-a', sealed, KEK), adk);
  assert.deepEqual(await unwrapCloudAccountDataKey('owner-a', repeated, KEK), adk);
  for (const invalid of [
    { ...sealed, uid: 'owner-b' },
    { ...sealed, version: 2 },
    { ...sealed, keyVersion: 0 },
    { ...sealed, format: 'other' },
    { ...sealed, tag: 'A'.repeat(24) },
    { ...sealed, iv: 'A'.repeat(15) + 'B' },
    { ...sealed, ciphertext: 'not-base64!' },
    { ...sealed, extra: 'forged' },
  ]) {
    await assert.rejects(unwrapCloudAccountDataKey('owner-a', invalid, KEK),
      CloudKeyUnavailableError);
  }
  await assert.rejects(unwrapCloudAccountDataKey('owner-b', sealed, KEK),
    CloudKeyUnavailableError);
  await assert.rejects(unwrapCloudAccountDataKey('owner-a', sealed, Buffer.alloc(32, 99).toString('base64')),
    CloudKeyUnavailableError);
  for (const malformed of ['', 'x', 'AA==', KEK.slice(1), KEK.replace(/=/g, '')]) {
    await assert.rejects(wrapCloudAccountDataKey('owner-a', adk, malformed), CloudKeyUnavailableError);
  }
});

void test('trusted live gate + D1 primary provisions exactly one ADK, without plaintext in SQL', async () => {
  const f = await fixture();
  try {
    const { status, payload } = await f.claims('owner-a');
    assert.equal(status, 200);
    assert.equal(payload.csrfVerified, true);
    const first = await releaseCloudAccountDataKey(f.db, f.env, payload);
    assert.equal(first.length, 32);
    const second = await releaseCloudAccountDataKey(f.db, f.env, payload);
    assert.deepEqual(second, first);
    assert.equal(sqlCount(f, 'cloud_account_keys', 'owner-a'), 1);
    assert.equal(sqlCount(f, 'cloud_key_issuance', 'owner-a'), 1);
    const raw = f.sqlite.prepare('SELECT * FROM cloud_account_keys WHERE uid = ?').get('owner-a');
    assert.equal(raw.consent_revision, 1);
    assert.equal(raw.version, 1);
    assert.notEqual(raw.ciphertext, Buffer.from(first).toString('base64'));
    assert.doesNotMatch(JSON.stringify(raw), /profile|history|nutrition|password/);
    assert.throws(() => f.sqlite.exec("UPDATE cloud_account_keys SET ciphertext='modified'"));
    assert.throws(() => f.sqlite.exec('DELETE FROM cloud_account_keys'));
    assert.throws(() => f.sqlite.exec('DELETE FROM cloud_key_issuance'));
    assert.throws(() => f.sqlite.exec('UPDATE cloud_key_issuance SET issued_at_ms=1'));
  } finally { f.sqlite.close(); }
});

void test('concurrent key requests converge to the one SQL winner, never overwrite', async () => {
  const f = await fixture();
  try {
    const { payload } = await f.claims('owner-a');
    const keys = await Promise.all(Array.from({ length: 5 }, () =>
      releaseCloudAccountDataKey(f.db, f.env, payload)));
    for (const key of keys) assert.deepEqual(key, keys[0]);
    assert.equal(sqlCount(f, 'cloud_account_keys', 'owner-a'), 1);
    assert.equal(sqlCount(f, 'cloud_key_issuance', 'owner-a'), 1);
  } finally { f.sqlite.close(); }
});

void test('lost DB reply reconciles ONLY the persisted wrapped winner', async () => {
  const f = await fixture();
  try {
    const { payload } = await f.claims('owner-a');
    const wrappedDb = {
      withSession(mode) {
        const primary = f.db.withSession(mode);
        return {
          prepare(sql) {
            const original = primary.prepare(sql);
            if (!sql.includes('INSERT INTO cloud_account_keys')) return original;
            return { bind(...values) {
              const bound = original.bind(...values);
              return { async first() {
                await bound.first();
                throw new Error('simulated-response-lost-after-D1-commit');
              } };
            } };
          },
        };
      },
    };
    const first = await releaseCloudAccountDataKey(wrappedDb, f.env, payload);
    assert.deepEqual(await releaseCloudAccountDataKey(f.db, f.env, payload), first);
    assert.equal(sqlCount(f, 'cloud_key_issuance', 'owner-a'), 1);
  } finally { f.sqlite.close(); }
});

void test('rights-only after withdrawal returns an existing ADK but cannot provision missing keys', async () => {
  const f = await fixture();
  try {
    await f.createOwner('owner-b');
    const active = (await f.claims('owner-a')).payload;
    const key = await releaseCloudAccountDataKey(f.db, f.env, active);
    // B has no ADK when health consent is revoked.
    for (const uid of ['owner-a', 'owner-b']) {
      f.sqlite.prepare(`INSERT INTO health_erasure_jobs
        (uid, consent_revision, fence_epoch, requested_at_ms)
        VALUES (?, 1, 1, ?)`).run(uid, Date.now() - 1000);
    }
    const rightsA = await f.claims('owner-a', '/v1/consent/status');
    const rightsB = await f.claims('owner-b', '/v1/consent/status');
    assert.equal(rightsA.status, 200);
    assert.equal(rightsB.status, 200);
    assert.deepEqual(await releaseCloudAccountDataKey(f.db, f.env,
      rightsA.payload, 'rights-export'), key);
    await assert.rejects(releaseCloudAccountDataKey(f.db, f.env, rightsB.payload, 'rights-export'),
      CloudKeyUnavailableError);
    await assert.rejects(releaseCloudAccountDataKey(f.db, f.env, active, 'sync'),
      CloudKeyUnavailableError);
    assert.equal(sqlCount(f, 'cloud_key_issuance', 'owner-b'), 0);
  } finally { f.sqlite.close(); }
});

void test('revoked/expired/changed session or consent blocks release even with cached AuthGate claims', async () => {
  for (const sql of [
    "UPDATE auth_sessions SET revoked_at_ms=issued_at_ms WHERE uid='owner-a'",
    "UPDATE auth_sessions SET idle_expires_at_ms=issued_at_ms+1 WHERE uid='owner-a'",
    "UPDATE auth_principals SET auth_epoch=2 WHERE uid='owner-a'",
    "UPDATE auth_principals SET status='disabled' WHERE uid='owner-a'",
    "UPDATE health_consent_acceptances SET privacy_version='invalid' WHERE uid='owner-a'",
  ]) {
    const f = await fixture();
    try {
      const { payload } = await f.claims('owner-a');
      await releaseCloudAccountDataKey(f.db, f.env, payload);
      if (sql.includes('health_consent_acceptances')) {
        // Immutable consent cannot be modified through a trusted D1 write.
        assert.throws(() => f.sqlite.exec(sql));
        f.sqlite.exec("UPDATE auth_principals SET auth_epoch=2 WHERE uid='owner-a'");
      } else f.sqlite.exec(sql);
      await assert.rejects(releaseCloudAccountDataKey(f.db, f.env, payload),
        CloudKeyUnavailableError);
      assert.equal(sqlCount(f, 'cloud_account_keys', 'owner-a'), 1);
    } finally { f.sqlite.close(); }
  }
});

void test('post-decrypt recheck blocks a revocation racing asynchronous crypto', async () => {
  const f = await fixture();
  try {
    const { payload } = await f.claims('owner-a');
    await releaseCloudAccountDataKey(f.db, f.env, payload);
    let reads = 0;
    const intercept = {
      withSession(mode) {
        const primary = f.db.withSession(mode);
        return {
          prepare(sql) {
            const original = primary.prepare(sql);
            if (!sql.includes('SELECT k.uid AS key_uid')) return original;
            return { bind(...values) {
              const stmt = original.bind(...values);
              return { async first() {
                reads += 1;
                if (reads === 2) {
                  f.sqlite.prepare("UPDATE auth_sessions SET revoked_at_ms=issued_at_ms WHERE uid=?")
                    .run('owner-a');
                }
                return stmt.first();
              } };
            } };
          },
        };
      },
    };
    await assert.rejects(releaseCloudAccountDataKey(intercept, f.env, payload),
      CloudKeyUnavailableError);
    assert.equal(reads, 2);
  } finally { f.sqlite.close(); }
});

void test('missing master KEK, corrupted key and owner swapping fail closed without rekey', async () => {
  const f = await fixture();
  try {
    await f.createOwner('owner-b');
    const a = (await f.claims('owner-a')).payload;
    const b = (await f.claims('owner-b')).payload;
    const first = await releaseCloudAccountDataKey(f.db, f.env, a);
    const other = await releaseCloudAccountDataKey(f.db, f.env, b);
    assert.notDeepEqual(first, other);
    for (const secret of [undefined, Buffer.alloc(32, 11).toString('base64'), 'invalid']) {
      await assert.rejects(releaseCloudAccountDataKey(f.db, {
        ...f.env, CLOUD_ACCOUNT_KEK_V1: secret,
      }, a), CloudKeyUnavailableError);
    }
    // Fault injection below simulates corrupt storage, not an allowed write:
    // the production immutable-key trigger itself rejects all these updates.
    f.sqlite.exec('DROP TRIGGER cloud_key_no_update');
    const rowA = f.sqlite.prepare('SELECT * FROM cloud_account_keys WHERE uid=?').get('owner-a');
    f.sqlite.prepare('UPDATE cloud_account_keys SET ciphertext=? WHERE uid=?')
      .run('A'.repeat(44), 'owner-a');
    await assert.rejects(releaseCloudAccountDataKey(f.db, f.env, a), CloudKeyUnavailableError);
    assert.equal(sqlCount(f, 'cloud_key_issuance', 'owner-a'), 1);
    f.sqlite.prepare('UPDATE cloud_account_keys SET ciphertext=?, iv=?, tag=? WHERE uid=?')
      .run(rowA.ciphertext, rowA.iv, rowA.tag, 'owner-a');
    assert.deepEqual(await releaseCloudAccountDataKey(f.db, f.env, a), first);
    // Copying A's sealed bytes to B is not a valid per-owner ADK.
    f.sqlite.prepare('UPDATE cloud_account_keys SET ciphertext=?, iv=?, tag=? WHERE uid=?')
      .run(rowA.ciphertext, rowA.iv, rowA.tag, 'owner-b');
    await assert.rejects(releaseCloudAccountDataKey(f.db, f.env, b), CloudKeyUnavailableError);
  } finally { f.sqlite.close(); }
});

void test('lost ADK never silently regenerates for the same consent generation', async () => {
  const f = await fixture();
  try {
    const claims = (await f.claims('owner-a')).payload;
    await releaseCloudAccountDataKey(f.db, f.env, claims);
    // Simulate external data loss bypassing the normal erasure-only SQL guard.
    f.sqlite.exec('DROP TRIGGER cloud_key_erasure_only');
    f.sqlite.prepare('DELETE FROM cloud_account_keys WHERE uid=?').run('owner-a');
    assert.equal(sqlCount(f, 'cloud_key_issuance', 'owner-a'), 1);
    await assert.rejects(releaseCloudAccountDataKey(f.db, f.env, claims),
      CloudKeyUnavailableError);
    assert.equal(sqlCount(f, 'cloud_account_keys', 'owner-a'), 0);
    assert.equal(sqlCount(f, 'cloud_key_issuance', 'owner-a'), 1);
  } finally { f.sqlite.close(); }
});

void test('key deletion is forbidden without leased, withdrawn, awaiting-keys erasure', async () => {
  const f = await fixture();
  try {
    const claims = (await f.claims('owner-a')).payload;
    await releaseCloudAccountDataKey(f.db, f.env, claims);
    assert.throws(() => f.sqlite.prepare('DELETE FROM cloud_account_keys WHERE uid=?').run('owner-a'));
    f.sqlite.prepare(`INSERT INTO health_erasure_jobs
      (uid,consent_revision,fence_epoch,requested_at_ms) VALUES (?,1,1,?)`)
      .run('owner-a', Date.now() - 1000);
    assert.throws(() => f.sqlite.prepare('DELETE FROM cloud_account_keys WHERE uid=?').run('owner-a'));
    f.sqlite.prepare(`UPDATE health_erasure_jobs SET status='processing',
      lease_epoch=1, lease_token=?, lease_until_ms=? WHERE uid=?`)
      .run('a'.repeat(64), Date.now() + 60_000, 'owner-a');
    f.sqlite.prepare("UPDATE health_erasure_jobs SET phase='awaiting-keys' WHERE uid=?")
      .run('owner-a');
    f.sqlite.prepare('DELETE FROM cloud_account_keys WHERE uid=?').run('owner-a');
    assert.equal(sqlCount(f, 'cloud_account_keys', 'owner-a'), 0);
    assert.equal(sqlCount(f, 'cloud_key_issuance', 'owner-a'), 1);
    assert.throws(() => f.sqlite.exec('DELETE FROM cloud_key_issuance'));
    const rights = (await f.claims('owner-a', '/v1/consent/status')).payload;
    await assert.rejects(releaseCloudAccountDataKey(f.db, f.env, rights, 'rights-export'),
      CloudKeyUnavailableError);
  } finally { f.sqlite.close(); }
});

void test('unverified gate, missing database and quota/SQL failures cannot release a key', async () => {
  const f = await fixture();
  try {
    const { payload } = await f.claims('owner-a');
    for (const changed of [
      { ...payload, csrfVerified: false },
      { ...payload, emailVerified: false },
      { ...payload, sessionHash: 'a'.repeat(64) },
      { ...payload, fenceEpoch: 999 },
      { ...payload, uid: 'owner-b' },
      { ...payload, healthConsentRevision: 2 },
    ]) {
      await assert.rejects(releaseCloudAccountDataKey(f.db, f.env, changed),
        CloudKeyUnavailableError);
    }
    await assert.rejects(releaseCloudAccountDataKey(null, f.env, payload), CloudKeyUnavailableError);
    const missing = { withSession() { throw new Error('quota exceeded'); } };
    await assert.rejects(releaseCloudAccountDataKey(missing, f.env, payload),
      CloudKeyUnavailableError);
    assert.equal(sqlCount(f, 'cloud_account_keys', 'owner-a'), 0);
    assert.equal(sqlCount(f, 'cloud_key_issuance', 'owner-a'), 0);
  } finally { f.sqlite.close(); }
});
