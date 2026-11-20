import assert from 'node:assert/strict';
import { applyCurrentD1RecoverySchema, applyCurrentD1Schema } from './current-d1-schema.mjs';
import { DatabaseSync } from 'node:sqlite';
import consent from '../../cloudflare/api/consent-worker.mjs';
import sessionGate from '../../cloudflare/auth/session-gate.mjs';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';

export const ORIGIN = 'https://candidate.invalid';
export const acceptance = {
  action: 'accept-initial', expectedRevision: 0,
  acceptance: {
    confirmsOver18: true, acceptedHealthData: true,
    acceptedTerms: true, privacyVersion: '1.3.9', termsVersion: '1.2.5',
  },
};
class Statement {
  constructor(sqlite, sql, args = []) { this.sqlite = sqlite; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.sqlite, this.sql, args); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: result.changes } };
  }
  async all() {
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.args).map(row => ({ ...row })) };
  }
}
class D1SqliteAdapter {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  withSession(mode) { assert.equal(mode, 'first-primary'); return this; }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) {
        results.push(/^\s*SELECT\b/i.test(statement.sql)
          ? await statement.all() : await statement.run());
      }
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
export async function fixture(uid = 'owner-a') {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  applyCurrentD1Schema(sqlite);
  const db = new D1SqliteAdapter(sqlite);
  const registry = new DatabaseSync(':memory:');
  applyCurrentD1RecoverySchema(registry);
  registry.exec("UPDATE recovery_control SET mode='open',generation=2 WHERE singleton=1");
  const recoveryDb = new D1SqliteAdapter(registry);
  sqlite.prepare('INSERT INTO auth_principals(uid,status,verified_at_ms,auth_epoch) VALUES (?, ?, ?, ?)')
    .run(uid, 'active', Date.now() - 60000, 1);
  const issued = await issueVerifiedSession(db, uid);
  const cookie = issued.setCookies.map(item => item.split(';')[0]).join('; ');
  const csrf = issued.setCookies[1].split(';')[0].split('=')[1];
  const env = {
    DB: db, RECOVERY_DB: recoveryDb, API_ORIGIN: ORIGIN,
    CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
    AUTH_GATE: {
      fetch: request => sessionGate.fetch(request, {
        DB: db, API_ORIGIN: ORIGIN, CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5', API_RATE_LIMITER: { limit: async () => ({ success: true }) },
      }),
    },
  };
  return { db, sqlite, recoveryDb, registry, env, cookie, csrf, uid,
    close() { registry.close(); sqlite.close(); } };
}
export function request(route, f, { body = null, csrf = f.csrf, origin = ORIGIN,
  contentType = 'application/json', cookie = f.cookie } = {}) {
  const headers = { origin, cookie, 'x-csrf-token': csrf };
  if (body !== null) headers['content-type'] = contentType;
  return new Request(ORIGIN + route, {
    method: 'POST', headers,
    ...(body === null ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
export async function call(f, route, opts) {
  const response = await consent.fetch(request(route, f, opts), f.env);
  return { status: response.status, body: await response.json() };
}
export function count(sqlite, table) {
  return sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
}

export const withdrawal = { action: 'withdraw', expectedRevision: 1, confirmsErasure: true };
