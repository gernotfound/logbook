import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { applyCurrentD1Schema } from './current-d1-schema.mjs';
import { createKindeDeletionOAuthFlow, createKindeOAuthFlow } from '../../cloudflare/auth/kinde-oauth-flow.mjs';

const issuer = 'https://synthetic-kinde.example';
export const appOrigin = 'https://candidate.example.invalid';
const clientId = 'synthetic-client-id-123';
export const apiAudience = 'thelogbook:synthetic-api';

export async function createKindeOAuthFixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  applyCurrentD1Schema(sqlite);
  const db = {
    prepare(sql) {
      const bind = (...params) => ({
        async run() {
          const out = sqlite.prepare(sql).run(...params);
          return { success: true, meta: { changes: out.changes } };
        },
        async first() { return sqlite.prepare(sql).get(...params) ?? null; },
        bind,
      });
      return bind();
    },
    withSession(mode) {
      assert.equal(mode, 'first-primary');
      return this;
    },
  };
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const keySet = createLocalJWKSet({
    keys: [{ ...await exportJWK(publicKey), kid: 'synthetic', use: 'sig', alg: 'RS256' }],
  });
  let rateAllowed = true;
  let tokenStatus = 200;
  let transportFails = false;
  let tokenPayload = null;
  let issuedTokens = 0;
  let accessLifetimeSeconds = 301;
  let accessAudience = apiAudience;
  let accessGrantType = ['authorization_code'];
  let idAudience = clientId;
  let discovery = { issuer, acr_values_supported: ['mfa'], claims_supported: ['auth_time'] };
  const nonceByCode = new Map();
  const fetchImpl = async (url, init) => {
    if (url === issuer + '/.well-known/openid-configuration') {
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'manual');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.headers.Authorization, undefined);
      return Response.json(discovery);
    }
    assert.equal(url, issuer + '/oauth2/token');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const body = init.body;
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('client_id'), clientId);
    assert.equal(body.get('client_secret'), 'synthetic-server-secret-not-real');
    assert.match(body.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
    const code = body.get('code');
    const { nonce, redirectUri, recent } = nonceByCode.get(code);
    assert.equal(body.get('redirect_uri'), redirectUri);
    const now = Math.floor(Date.now() / 1000);
    issuedTokens += 1;
    if (transportFails) throw new Error('synthetic token fetch failure');
    if (tokenStatus !== 200) return new Response('{}', {
      status: tokenStatus,
      headers: {
        'Content-Type': 'application/json',
        ...(tokenStatus >= 300 && tokenStatus < 400 ? { Location: 'https://redirected.invalid/token' } : {}),
      },
    });
    let tokens;
    if (tokenPayload) tokens = tokenPayload;
    else {
      const accessToken = await new SignJWT({
        azp: clientId, sub: 'kp_verified_test_12345', gty: accessGrantType,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
        .setIssuer(issuer).setAudience(accessAudience).setIssuedAt(now - 1).setExpirationTime(now - 1 + accessLifetimeSeconds)
        .sign(privateKey);
      const at_hash = createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url');
      const idToken = await new SignJWT({
        azp: clientId, sub: 'kp_verified_test_12345',
        nonce, auth_time: now - (recent ? 1 : 60),
        email: 'test@example.invalid', email_verified: true, at_hash,
      }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
        .setIssuer(issuer).setAudience(idAudience).setIssuedAt(now - 1).setExpirationTime(now + 300)
        .sign(privateKey);
      tokens = { access_token: accessToken, id_token: idToken };
    }
    return new Response(JSON.stringify(tokens), { headers: { 'Content-Type': 'application/json' } });
  };
  const config = {
    issuer, clientId, clientSecret: 'synthetic-server-secret-not-real',
    apiAudience, appOrigin,
  };
  const dependencies = {
    rateLimit: async request => {
      assert.ok(request instanceof Request);
      return rateAllowed;
    },
    fetchImpl, keySet,
  };
  const oauth = createKindeOAuthFlow(config, dependencies);
  const deletion = createKindeDeletionOAuthFlow(config, dependencies);
  function startRequest(cookie = '') {
    return new Request(appOrigin + '/api/auth/kinde/start', {
      method: 'POST', headers: { origin: appOrigin, 'sec-fetch-site': 'same-origin', cookie },
    });
  }
  async function start(cookie = '') {
    const response = await oauth.start(db, startRequest(cookie));
    assert.equal(response.status, 303);
    const auth = new URL(response.headers.get('Location'));
    const boundCookie = response.headers.getSetCookie()[0].split(';')[0];
    assert.equal(auth.origin, issuer);
    assert.equal(auth.pathname, '/oauth2/auth');
    assert.equal(auth.searchParams.get('response_type'), 'code');
    assert.equal(auth.searchParams.get('scope'), 'openid email profile');
    assert.equal(auth.searchParams.get('audience'), apiAudience);
    assert.equal(auth.searchParams.get('client_id'), clientId);
    assert.equal(auth.searchParams.get('redirect_uri'), appOrigin + '/api/auth/kinde/callback');
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(auth.searchParams.get('code_challenge').length, 43);
    assert.equal(auth.searchParams.has('client_secret'), false);
    assert.equal(auth.searchParams.has('code_verifier'), false);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return { auth, cookie: boundCookie, state: auth.searchParams.get('state'), nonce: auth.searchParams.get('nonce') };
  }
  function callback(attempt, code = 'good-code', cookie = attempt.cookie, scope = 'openid email profile') {
    const redirectUri = appOrigin + '/api/auth/kinde/callback';
    nonceByCode.set(code, { nonce: attempt.nonce, redirectUri });
    const query = new URLSearchParams({ code, state: attempt.state });
    if (scope !== null) query.set('scope', scope);
    return new Request(redirectUri + '?' + query, { headers: { cookie } });
  }
  function deletionCallback(auth, code, cookie, recent) {
    const redirectUri = appOrigin + '/api/auth/kinde/deletion/callback';
    nonceByCode.set(code, { nonce: auth.searchParams.get('nonce'), redirectUri, recent });
    const query = new URLSearchParams({ code, state: auth.searchParams.get('state') });
    return new Request(redirectUri + '?' + query, { headers: { cookie } });
  }
  return {
    sqlite, db, oauth, deletion, startRequest, start, callback, deletionCallback, config,
    setRate: value => { rateAllowed = value; },
    setStatus: value => { tokenStatus = value; },
    setTransportFailure: value => { transportFails = value; },
    setPayload: value => { tokenPayload = value; },
    setAccessLifetime: value => { accessLifetimeSeconds = value; },
    setAccessAudience: value => { accessAudience = value; },
    setAccessGrantType: value => { accessGrantType = value; },
    setIdAudience: value => { idAudience = value; },
    setDiscovery: value => { discovery = value; },
    calls: () => issuedTokens,
    close: () => sqlite.close(),
  };
}
