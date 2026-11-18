import { applyCurrentD1RecoverySchema } from './current-d1-schema.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import api from '../../cloudflare/api/worker.mjs';
import gate, { hashSessionSecret } from '../../cloudflare/auth/session-gate.mjs';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';

export const ORIGIN = 'https://cf05-key-http.example.invalid';
const KEK = Buffer.alloc(32, 91).toString('base64');
export const SYNC = '/v1/cloud-key/sync';
export const RIGHTS = '/v1/cloud-key/rights-export';
export const ACCEPT = {
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

export async function createCloudKeyHttpFixture(owners = ['owner-a', 'owner-b']) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrations = readdirSync(new URL('../../cloudflare/api/migrations/', import.meta.url))
    .filter(file => file.endsWith('.sql')).sort();
  assert.ok(migrations.length >= 10, 'key HTTP fixtures require the complete erasure schema');
  assert.ok(migrations.every(file => /^[0-9]{4}_[a-z0-9_]+\.sql$/.test(file)));
  assert.deepEqual(migrations.map(file => file.slice(0, 4)),
    Array.from({ length: migrations.length }, (_, i) => String(i + 1).padStart(4, '0')));
  for (const file of migrations) {
    sqlite.exec(readFileSync(new URL('../../cloudflare/api/migrations/' + file, import.meta.url), 'utf8'));
  }
  const db = new D1(sqlite);
  const registry = new DatabaseSync(':memory:');
  applyCurrentD1RecoverySchema(registry);
  registry.exec("UPDATE recovery_control SET mode='open', generation=2 WHERE singleton=1");
  const recoveryDb = new D1(registry);
  const gateEnv = {
    DB: db, API_ORIGIN: ORIGIN,
    CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
    API_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  const env = {
    ...gateEnv, RECOVERY_DB: recoveryDb, CLOUD_ACCOUNT_KEK_V1: KEK,
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
  for (const uid of owners) await createOwner(uid);
  return {
    sqlite, db, registry, recoveryDb, env, gateEnv, call, sessions,
    close() { registry.close(); sqlite.close(); },
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


export async function renewSessionWithoutEmail(f, uid) {
  const current = f.sessions.get(uid);
  const token = Buffer.alloc(32, 96).toString('base64url');
  const csrf = Buffer.alloc(32, 97).toString('base64url');
  const now = Date.now();
  f.sqlite.prepare(`UPDATE auth_principals
    SET verified_at_ms=NULL, auth_epoch=auth_epoch+1 WHERE uid=?`).run(uid);
  const epoch = f.sqlite.prepare('SELECT auth_epoch FROM auth_principals WHERE uid=?')
    .get(uid).auth_epoch;
  f.sqlite.prepare(`INSERT INTO auth_sessions
    (token_hash,uid,auth_epoch,csrf_hash,issued_at_ms,idle_expires_at_ms,absolute_expires_at_ms)
    VALUES (?,?,?,?,?,?,?)`).run(
    await hashSessionSecret(token), uid, epoch, await hashSessionSecret(csrf),
    now - 1000, now + 60000, now + 3600000,
  );
  f.sessions.set(uid, { cookies: '__Host-logbook_session=' + token
    + '; __Host-logbook_csrf=' + csrf, csrf });
  return current;
}
