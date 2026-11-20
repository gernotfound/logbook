import { applyCurrentD1Schema, applyCurrentD1RecoverySchema } from './current-d1-schema.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createKindeHttpHandler } from '../../cloudflare/auth/kinde-http-worker.mjs';
import gate from '../../cloudflare/auth/session-gate.mjs';
import apiWorker from '../../cloudflare/api/worker.mjs';

export const ORIGIN = 'https://candidate.invalid';
export const ISSUER = 'https://synthetic-kinde.example';
const CLIENT = 'synthetic-kinde-client';
const API_AUD = 'thelogbook:synthetic-api';
const KEK = Buffer.alloc(32, 41).toString('base64');
export const SESSION = '/api/auth/session';
export const START = '/api/auth/kinde/start';
export const CALLBACK = '/api/auth/kinde/callback';
export const LOGOUT = '/api/auth/logout';

class Stmt {
  constructor(sqlite, sql, args = []) { this.sqlite = sqlite; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.sqlite, this.sql, args); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.args) }; }
  async run() {
    const r = this.sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: r.changes } };
  }
}
class DB {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Stmt(this.sqlite, sql); }
  withSession(mode) { assert.equal(mode, 'first-primary'); return this; }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const output = [];
      for (const statement of statements) {
        output.push(statement.sql.trimStart().toUpperCase().startsWith('SELECT')
          ? await statement.all() : await statement.run());
      }
      this.sqlite.exec('COMMIT');
      return output;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

export async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  // The identity gate joins sync_subjects even before consent. Exercise the
  // complete current D1 schema, not a partial Auth-only test database.
  applyCurrentD1Schema(sqlite);
  const db = new DB(sqlite);
  // A wholly separate SQLite D1 models the CF-08 registry, not a copy of
  // identity or health data. Production consent integration remains pending.
  const registry = new DatabaseSync(':memory:');
  applyCurrentD1RecoverySchema(registry);
  registry.prepare("UPDATE recovery_control SET mode='open',generation=2 WHERE singleton=1").run();
  const recoveryDb = new DB(registry);
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const keySet = createLocalJWKSet({
    keys: [{ ...await exportJWK(publicKey), kid: 'synthetic', alg: 'RS256', use: 'sig' }],
  });
  let nonce;
  let callCount = 0;
  let subject = 'kp_synthetic_user_20261114';
  let loginCount = 0;
  const fetchImpl = async (url, options) => {
    callCount += 1;
    assert.equal(url, ISSUER + '/oauth2/token');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.body.get('client_secret'), 'synthetic-private-secret');
    const now = Math.floor(Date.now() / 1000);
    const sub = subject;
    const accessToken = await new SignJWT({ azp: CLIENT, sub })
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
      .setIssuer(ISSUER).setAudience(API_AUD)
      .setIssuedAt(now - 2).setExpirationTime(now + 300).sign(privateKey);
    const at_hash = createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url');
    const idToken = await new SignJWT({
      azp: CLIENT, sub, nonce,
      email: sub === 'kp_synthetic_user_20261114' ? 'verified@example.invalid' : 'other@example.invalid',
      email_verified: true, auth_time: now - 60, at_hash,
    }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
      .setIssuer(ISSUER).setAudience(CLIENT).setIssuedAt(now - 2)
      .setExpirationTime(now + 300).sign(privateKey);
    return Response.json({ access_token: accessToken, id_token: idToken });
  };
  let allowLogin = true;
  const env = {
    APP_ORIGIN: ORIGIN, KINDE_ISSUER: ISSUER,
    KINDE_CLIENT_ID: CLIENT, KINDE_CLIENT_SECRET: 'synthetic-private-secret',
    KINDE_API_AUDIENCE: API_AUD, KINDE_ID_TOKEN_AUDIENCE: ISSUER,
    DB: db, RECOVERY_DB: recoveryDb, CLOUD_ACCOUNT_KEK_V1: KEK,
    CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
    AUTH_RATE_LIMITER: { limit: async () => ({ success: allowLogin }) },
    AUTH_GATE: {
      fetch(request) {
        return gate.fetch(request, {
          DB: db, API_ORIGIN: ORIGIN,
          CONSENT_PRIVACY_VERSION: '1.3.9',
          CONSENT_TERMS_VERSION: '1.2.5',
          API_RATE_LIMITER: { limit: async () => ({ success: true }) },
        });
      },
    },
  };
  const handler = createKindeHttpHandler({ fetchImpl, keySet });
  function post(path, cookie = '', csrf = '', opts = {}) {
    return new Request(opts.url ?? ORIGIN + path, {
      method: opts.method ?? 'POST',
      headers: {
        origin: opts.origin ?? ORIGIN,
        'sec-fetch-site': opts.fetchSite ?? 'same-origin',
        cookie, 'x-csrf-token': csrf,
      },
      ...(opts.body === undefined ? {} : { body: opts.body }),
    });
  }
  async function login() {
    const start = await handler(post(START), env);
    assert.equal(start.status, 303);
    const url = new URL(start.headers.get('location'));
    assert.equal(url.origin, ISSUER);
    assert.equal(url.pathname, '/oauth2/auth');
    const state = url.searchParams.get('state');
    nonce = url.searchParams.get('nonce');
    const cookie = start.headers.getSetCookie()[0].split(';')[0];
    loginCount += 1;
    const callbackRequest = new Request(ORIGIN + CALLBACK + '?code=synthetic-code-' + loginCount + '&scope=openid%20email%20profile&state=' + state, {
      headers: { cookie },
    });
    const completed = await handler(callbackRequest, env);
    assert.equal(completed.status, 303);
    assert.equal(completed.headers.get('Location'), ORIGIN + '/');
    const setCookies = completed.headers.getSetCookie();
    assert.equal(setCookies.length, 2);
    return { callbackRequest, setCookies,
      cookie: setCookies.map(x => x.split(';')[0]).join('; '),
      csrf: setCookies[1].split(';')[0].split('=')[1],
    };
  }
  return {
    sqlite, db, env, handler, post, login,
    calls: () => callCount,
    setNonce: value => { nonce = value; },
    setRate: value => { allowLogin = value; },
    setSubject: value => { subject = value; },
    close() { registry.close(); sqlite.close(); },
  };
}

export const acceptance = {
  action: 'accept-initial', expectedRevision: 0,
  acceptance: {
    confirmsOver18: true, acceptedHealthData: true, acceptedTerms: true,
    privacyVersion: '1.3.9', termsVersion: '1.2.5',
  },
};

// A signed synthetic Kinde exchange runs through the production HTTP, AuthGate,
// consent and D1 handlers. This does not attest Kinde itself or AEAD recovery.
export async function cloudCall(f, route, login, body, csrf = login.csrf) {
  const headers = {
    origin: ORIGIN, 'sec-fetch-site': 'same-origin',
    cookie: login.cookie, 'x-csrf-token': csrf,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await apiWorker.fetch(new Request(ORIGIN + route, {
    method: 'POST', headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), {
    ...f.env, API_ORIGIN: ORIGIN,
    CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
  });
  return { status: response.status, body: await response.json() };
}
