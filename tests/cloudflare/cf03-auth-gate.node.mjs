import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import gate, { hashSessionSecret } from '../../cloudflare/auth/session-gate.mjs';

const ORIGIN = 'https://app.example.invalid';
const token = Buffer.alloc(32, 7).toString('base64url');
const csrf = Buffer.alloc(32, 11).toString('base64url');

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of [
    '0001_encrypted_replica.sql', '0002_reject_reused_replica_ids.sql',
    '0003_auth_session_gate.sql',
        // Initial consent depends on the Auth principal schema.
        '0004_initial_consent.sql',
  ]) {
    sqlite.exec(readFileSync(new URL('../../cloudflare/api/migrations/' + file, import.meta.url), 'utf8'));
  }
  const epoch = 1;
  const now = Date.now();
  sqlite.prepare('INSERT INTO sync_subjects(uid,status,consent_revision,fence_epoch) VALUES (?,?,?,?)')
    .run('account-a', 'active', 1, epoch);
  sqlite.prepare('INSERT INTO sync_state(uid,revision) VALUES (?,?)').run('account-a', 0);
  sqlite.prepare('INSERT INTO health_consent_acceptances(uid,consent_revision,privacy_version,terms_version,accepted_at_ms,over_18_confirmed) VALUES (?,1,?,?,?,1)')
    .run('account-a', '1.3.9', '1.2.5', Date.now() - 1000);
  sqlite.prepare('INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch) VALUES (?,?,?,?)')
    .run('account-a', 'active', now - 10000, epoch);
  sqlite.prepare('INSERT INTO auth_sessions(token_hash,uid,auth_epoch,csrf_hash,issued_at_ms,idle_expires_at_ms,absolute_expires_at_ms) VALUES (?,?,?,?,?,?,?)')
    .run(await hashSessionSecret(token), 'account-a', epoch,
      await hashSessionSecret(csrf), now - 5000, now + 60000, now + 3600000);
  let reads = 0;
  let rateChecks = 0;
  const db = {
    withSession(mode) {
      assert.equal(mode, 'first-primary');
      return {
        prepare(sql) {
          return {
            bind(...values) {
              return {
                async first() {
                  reads += 1;
                  return sqlite.prepare(sql).get(...values) ?? null;
                },
              };
            },
          };
        },
      };
    },
  };
  const env = {
    DB: db,
    API_ORIGIN: ORIGIN, CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
    API_RATE_LIMITER: {
      async limit({ key }) {
        rateChecks += 1;
        assert.equal(key, 'sync:' + await hashSessionSecret(token));
        return { success: true };
      },
    },
  };
  return { sqlite, env, metrics: () => ({ reads, rateChecks }) };
}

function makeRequest({ route = '/v1/sync/control', cookie = token, csrfValue, origin = ORIGIN,
  method = 'POST', url = 'https://auth-gate.internal/__internal/authorize',
  originalMethod = 'POST', body } = {}) {
  const headers = new Headers({
    origin,
    'x-original-method': originalMethod,
    'x-original-route': route,
  });
  if (cookie !== null) headers.set('cookie', '__Host-logbook_session=' + cookie);
  if (csrfValue !== undefined) headers.set('x-csrf-token', csrfValue);
  return new Request(url, { method, headers, ...(body === undefined ? {} : { body }) });
}

async function status(env, props = {}) {
  return gate.fetch(makeRequest(props), env);
}

void test('valid verified account with current consent receives scoped claims; read needs no CSRF', async () => {
  const { sqlite, env, metrics } = await fixture();
  try {
    const response = await status(env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      uid: 'account-a',
      authenticated: true,
      emailVerified: true,
      healthConsentRevision: 1,
      fenceEpoch: 1,
      csrfVerified: false,
      rateGatePassed: true,
      sessionHash: await hashSessionSecret(token),
    });
    assert.deepEqual(metrics(), { reads: 1, rateChecks: 1 });
  } finally { sqlite.close(); }
});

void test('mutation requires session-bound CSRF; wrong, malformed, absent and replayed tokens fail', async () => {
  const { sqlite, env } = await fixture();
  try {
    const valid = await status(env, { route: '/v1/sync/commit', csrfValue: csrf });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).csrfVerified, true);
    for (const supplied of [undefined, token, 'wrong', csrf + '=', '']) {
      const response = await status(env, { route: '/v1/sync/commit', csrfValue: supplied });
      assert.equal(response.status, 403);
    }
    const outcome = await status(env, { route: '/v1/sync/replica/status', csrfValue: csrf });
    assert.equal(outcome.status, 200);
    const unverified = await status(env, { route: '/v1/sync/receipt', csrfValue: token });
    assert.equal(unverified.status, 403);
  } finally { sqlite.close(); }
});

void test('document commit status uses the real private AuthGate mutation allowlist and CSRF', async () => {
  const { sqlite, env } = await fixture();
  try {
    const authorized = await status(env, {
      route: '/v1/sync/commit/status', csrfValue: csrf,
    });
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).csrfVerified, true);

    for (const csrfValue of [undefined, '', token, 'wrong']) {
      const response = await status(env, {
        route: '/v1/sync/commit/status', csrfValue,
      });
      assert.equal(response.status, 403);
    }
    const fake = await status(env, { route: '/v1/sync/commit/status/hidden', csrfValue: csrf });
    assert.equal(fake.status, 403);

    sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms = ? WHERE uid = ?')
      .run(Date.now(), 'account-a');
    const revoked = await status(env, {
      route: '/v1/sync/commit/status', csrfValue: csrf,
    });
    assert.equal(revoked.status, 401);
  } finally { sqlite.close(); }
});

void test('invalid cookies, duplicate session cookies and unknown routes never produce claims', async () => {
  const { sqlite, env, metrics } = await fixture();
  try {
    for (const input of [
      { cookie: null },
      { cookie: 'not-a-token' },
      { cookie: token + '=' },
      { cookie: token + '; __Host-logbook_session=' + token },
      { route: '/v1/sync/admin' },
      { origin: 'https://evil.example.invalid' },
      { method: 'GET' },
      { originalMethod: 'GET' },
      { url: 'https://other.example.invalid/__internal/authorize' },
      { url: 'https://auth-gate.internal/public' },
      { body: '{}' },
    ]) {
      const response = await status(env, input);
      assert.notEqual(response.status, 200);
      assert.equal('uid' in await response.json(), false);
    }
    assert.equal(metrics().reads, 0);
  } finally { sqlite.close(); }
});

void test('revoked, expired, unverified, disabled, withdrawn, deleted or stale-generation sessions fail closed', async () => {
  const mutations = [
    "UPDATE auth_sessions SET revoked_at_ms = issued_at_ms WHERE uid = 'account-a'",
    "UPDATE auth_sessions SET idle_expires_at_ms = issued_at_ms + 1 WHERE uid = 'account-a'",
    "UPDATE auth_sessions SET absolute_expires_at_ms = issued_at_ms + 1, idle_expires_at_ms = issued_at_ms + 1 WHERE uid = 'account-a'",
    "UPDATE auth_principals SET verified_at_ms = NULL, auth_epoch = auth_epoch + 1 WHERE uid = 'account-a'",
    "UPDATE auth_principals SET status = 'disabled' WHERE uid = 'account-a'",
    "UPDATE auth_principals SET status = 'deleted' WHERE uid = 'account-a'",
    "UPDATE auth_principals SET auth_epoch = auth_epoch + 1 WHERE uid = 'account-a'",
    "UPDATE sync_subjects SET status = 'withdrawn' WHERE uid = 'account-a'",
    "UPDATE sync_subjects SET fence_epoch = fence_epoch + 1 WHERE uid = 'account-a'",
  ];
  for (const sql of mutations) {
    const { sqlite, env } = await fixture();
    try {
      sqlite.exec(sql);
      const response = await status(env, { route: '/v1/sync/read' });
      assert.equal(response.status, 401, sql);
    } finally { sqlite.close(); }
  }
});

void test('gate refuses missing storage/limiter, rate exhaustion and provider errors without returning identity', async () => {
  const { sqlite, env, metrics } = await fixture();
  try {
    const missingDb = await status({ ...env, DB: undefined });
    const missingLimiter = await status({ ...env, API_RATE_LIMITER: undefined });
    assert.equal(missingDb.status, 503);
    assert.equal(missingLimiter.status, 503);
    assert.equal(metrics().reads, 0);
    const denied = await status({
      ...env, API_RATE_LIMITER: { limit: async () => ({ success: false }) },
    });
    assert.equal(denied.status, 429);
    assert.equal(metrics().reads, 0);
    const failure = await status({
      ...env, DB: { withSession: () => { throw Error('synthetic SQL failure'); } },
    });
    assert.equal(failure.status, 503);
    assert.equal('uid' in await failure.json(), false);
  } finally { sqlite.close(); }
});

void test('principal fences prohibit rollback and account resurrection at SQL boundary', async () => {
  const { sqlite } = await fixture();
  try {
    assert.throws(() => sqlite.exec("UPDATE auth_principals SET auth_epoch = 0 WHERE uid = 'account-a'"));
    sqlite.exec("UPDATE auth_principals SET status = 'deleted' WHERE uid = 'account-a'");
    assert.throws(() => sqlite.exec("UPDATE auth_principals SET status = 'active' WHERE uid = 'account-a'"));
  } finally { sqlite.close(); }
});
