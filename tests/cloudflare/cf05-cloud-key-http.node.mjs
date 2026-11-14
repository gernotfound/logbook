import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import api from '../../cloudflare/api/worker.mjs';
import gate from '../../cloudflare/auth/session-gate.mjs';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';

const ORIGIN = 'https://cf05-key-http.example.invalid';
const KEK = Buffer.alloc(32, 91).toString('base64');
const SYNC = '/v1/cloud-key/sync';
const RIGHTS = '/v1/cloud-key/rights-export';
const ACCEPT = {
  action: 'accept-initial', expectedRevision: 0,
  acceptance: { acceptedHealthData: true, acceptedTerms: true,
    confirmsOver18: true, privacyVersion: '1.3.9', termsVersion: '1.2.5' },
};
const WITHDRAW = {
  action: 'withdraw', expectedRevision: 1, confirmsErasure: true,
};
class Statement {
  constructor(sqlite, sql, params = []) { this.sqlite = sqlite; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.sqlite, this.sql, params); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.params) }; }
  async run() {
    const r = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: r.changes } };
  }
}
class D1 {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  withSession(mode) { assert.equal(mode, 'first-primary'); return this; }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const outcomes = [];
      for (const statement of statements) {
        outcomes.push(/^\s*SELECT\b/i.test(statement.sql)
          ? await statement.all() : await statement.run());
      }
      this.sqlite.exec('COMMIT');
      return outcomes;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrations = readdirSync(new URL('../../cloudflare/api/migrations/', import.meta.url))
    .filter(file => /^000[1-8]_[a-z0-9_]+\.sql$/.test(file)).sort();
  assert.deepEqual(migrations.map(file => file.slice(0, 4)),
    Array.from({ length: 8 }, (_, i) => String(i + 1).padStart(4, '0')));
  for (const file of migrations) {
    sqlite.exec(readFileSync(new URL('../../cloudflare/api/migrations/' + file, import.meta.url), 'utf8'));
  }
  const db = new D1(sqlite);
  const gateEnv = {
    DB: db, API_ORIGIN: ORIGIN,
    CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
    API_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  const env = {
    ...gateEnv, CLOUD_ACCOUNT_KEK_V1: KEK,
    AUTH_GATE: { fetch: request => gate.fetch(request, gateEnv) },
  };
  const sessions = new Map();
  async function createOwner(uid) {
    sqlite.prepare("INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch) VALUES (?,'active',?,1)")
      .run(uid, Date.now() - 30_000);
    const issued = await issueVerifiedSession(db, uid);
    const cookies = issued.setCookies.map(x => x.split(';')[0]).join('; ');
    const csrf = issued.setCookies[1].split(';')[0].split('=')[1];
    sessions.set(uid, { cookies, csrf });
  }
  async function call(uid, path, opts = {}) {
    const session = sessions.get(uid);
    const headers = {
      origin: opts.origin ?? ORIGIN,
      cookie: opts.cookie ?? session?.cookies ?? '',
      'x-csrf-token': opts.csrf ?? session?.csrf ?? '',
      ...(opts.fetchSite ? { 'sec-fetch-site': opts.fetchSite } : {}),
      ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    };
    const request = new Request(opts.url ?? ORIGIN + path, {
      method: opts.method ?? 'POST', headers,
      ...(opts.body === undefined ? {} : {
        body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
      }),
    });
    const response = await api.fetch(request, opts.env ?? env);
    return { response, body: await response.json() };
  }
  await createOwner('owner-a');
  await createOwner('owner-b');
  return {
    sqlite, db, env, gateEnv, call, sessions,
    close() { sqlite.close(); },
    count(table, uid) {
      return sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table + ' WHERE uid=?').get(uid).n;
    },
    async consent(uid) {
      const x = await call(uid, '/v1/consent/initial', { body: ACCEPT });
      assert.equal(x.response.status, 200);
      assert.equal(x.body.status, 'active');
    },
    async withdraw(uid) {
      const x = await call(uid, '/v1/consent/withdraw', { body: WITHDRAW });
      assert.equal(x.response.status, 200);
      assert.equal(x.body.status, 'withdrawn');
      assert.equal(x.body.deletionStatus, 'pending');
    },
  };
}

void test('top-level API: initial consent, authenticated key provision, repeat and isolated owner', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('owner-a', SYNC)).response.status, 401);
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 0);
    await f.consent('owner-a');
    await f.consent('owner-b');
    const first = await f.call('owner-a', SYNC);
    assert.equal(first.response.status, 200);
    assert.equal(first.response.headers.get('Cache-Control'), 'no-store');
    assert.equal(first.response.headers.get('Pragma'), 'no-cache');
    assert.equal(first.response.headers.get('Access-Control-Allow-Origin'), null);
    assert.deepEqual(Object.keys(first.body).sort(), ['format', 'key', 'version']);
    assert.equal(first.body.format, 'thelogbook-account-data-key');
    assert.equal(first.body.version, 1);
    assert.match(first.body.key, /^[A-Za-z0-9+/]{43}=$/);
    assert.equal(Buffer.from(first.body.key, 'base64').length, 32);
    const repeated = await f.call('owner-a', SYNC);
    assert.equal(repeated.response.status, 200);
    assert.equal(repeated.body.key, first.body.key);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 1);
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 1);
    const sealed = f.sqlite.prepare('SELECT ciphertext, iv, tag FROM cloud_account_keys WHERE uid=?')
      .get('owner-a');
    assert.notEqual(sealed.ciphertext, first.body.key);
    assert.equal(typeof sealed.iv, 'string');
    assert.equal(typeof sealed.tag, 'string');
    const other = await f.call('owner-b', SYNC);
    assert.equal(other.response.status, 200);
    assert.notEqual(other.body.key, first.body.key);
    assert.equal(f.count('cloud_key_issuance', 'owner-b'), 1);
    // Forged identity headers cannot redirect the trusted session owner.
    const forged = new Request(ORIGIN + SYNC, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: f.sessions.get('owner-a').cookies,
        'x-csrf-token': f.sessions.get('owner-a').csrf,
        'x-user-id': 'owner-b', 'authorization': 'Bearer synthetic' },
    });
    const forgedResponse = await api.fetch(forged, f.env);
    assert.equal(forgedResponse.status, 200);
    assert.equal((await forgedResponse.json()).key, first.body.key);
  } finally { f.close(); }
});

void test('withdrawal stops sync; rights-only returns existing key without reprovisioning', async () => {
  const f = await fixture();
  try {
    await f.consent('owner-a');
    await f.consent('owner-b');
    const aKey = (await f.call('owner-a', SYNC)).body.key;
    await f.withdraw('owner-a');
    await f.withdraw('owner-b');
    assert.equal((await f.call('owner-a', SYNC)).response.status, 401);
    const rights = await f.call('owner-a', RIGHTS);
    assert.equal(rights.response.status, 200);
    assert.equal(rights.body.key, aKey);
    // B was withdrawn before ever being issued an ADK; rights can't create one.
    assert.equal((await f.call('owner-b', RIGHTS)).response.status, 503);
    assert.equal(f.count('cloud_account_keys', 'owner-b'), 0);
    assert.equal(f.count('cloud_key_issuance', 'owner-b'), 0);
    assert.equal(f.count('health_erasure_jobs', 'owner-a'), 1);
    assert.equal(f.count('health_erasure_jobs', 'owner-b'), 1);
  } finally { f.close(); }
});

void test('origin, CSRF, method, query and request body are denied before any key write', async () => {
  const f = await fixture();
  try {
    await f.consent('owner-a');
    for (const options of [
      { csrf: 'forged-csrf' },
      { csrf: '' , cookie: 'bad' },
      { origin: 'https://attacker.invalid' },
      { fetchSite: 'cross-site' },
      { url: ORIGIN + SYNC + '?uid=owner-b' },
      { body: { uid: 'owner-a' } },
      { method: 'GET' },
    ]) {
      const result = await f.call('owner-a', SYNC, options);
      assert.notEqual(result.response.status, 200);
    }
    assert.equal((await f.call('owner-a', '/v1/cloud-key/unknown')).response.status, 404);
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 0);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 0);
  } finally { f.close(); }
});

void test('revoked/expired session and disabled principal deny cached claims', async () => {
  for (const sql of [
    "UPDATE auth_sessions SET revoked_at_ms=issued_at_ms WHERE uid='owner-a'",
    "UPDATE auth_sessions SET idle_expires_at_ms=issued_at_ms+1 WHERE uid='owner-a'",
    "UPDATE auth_principals SET status='disabled' WHERE uid='owner-a'",
    "UPDATE auth_principals SET auth_epoch=2 WHERE uid='owner-a'",
  ]) {
    const f = await fixture();
    try {
      await f.consent('owner-a');
      await f.call('owner-a', SYNC);
      f.sqlite.exec(sql);
      assert.equal((await f.call('owner-a', SYNC)).response.status, 401);
      assert.equal((await f.call('owner-a', RIGHTS)).response.status, 401);
      assert.equal(f.count('cloud_key_issuance', 'owner-a'), 1);
    } finally { f.close(); }
  }
});

void test('missing dependencies, invalid KEK, private gate failure and quotas fail closed', async () => {
  const f = await fixture();
  try {
    await f.consent('owner-a');
    for (const env of [
      { ...f.env, DB: undefined },
      { ...f.env, AUTH_GATE: undefined },
      { ...f.env, CLOUD_ACCOUNT_KEK_V1: undefined },
      { ...f.env, AUTH_GATE: { fetch: async () => Response.json({ error: 'rate-limited' }, { status: 429 }) } },
      { ...f.env, DB: { withSession() { throw new Error('synthetic-DB-quota'); } } },
    ]) {
      const { response } = await f.call('owner-a', SYNC, { env });
      assert.notEqual(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 0);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 0);
    const valid = await f.call('owner-a', SYNC);
    assert.equal(valid.response.status, 200);
    // A valid-looking but different KEK cannot open an already issued ADK.
    const changedKek = { ...f.env,
      CLOUD_ACCOUNT_KEK_V1: Buffer.alloc(32, 93).toString('base64') };
    assert.equal((await f.call('owner-a', SYNC, { env: changedKek })).response.status, 503);
    assert.equal(f.count('cloud_account_keys', 'owner-a'), 1);
    assert.equal(f.count('cloud_key_issuance', 'owner-a'), 1);
    assert.equal((await f.call('owner-a', SYNC)).body.key, valid.body.key);
  } finally { f.close(); }
});

void test('candidate route is private in the published frontend configuration', () => {
  const config = JSON.parse(readFileSync(new URL('../../cloudflare/wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.main, './auth-proxy.mjs');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.assets.run_worker_first, ['/__/auth', '/__/auth/*']);
  assert.equal(config.d1_databases, undefined);
  assert.equal(config.services, undefined);
});
