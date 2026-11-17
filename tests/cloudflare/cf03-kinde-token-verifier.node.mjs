import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createKindeAccessTokenVerifier, createKindeCodeExchangeAccessTokenVerifier, KindeAccessTokenError } from '../../cloudflare/auth/kinde-token-verifier.mjs';

const issuer = 'https://synthetic-kinde.example';
const audience = 'thelogbook:isolated-api';
const clientId = 'synthetic-client-only';
const subject = 'kp_synthetic_user_123456';

async function fixture() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const key = { ...await exportJWK(publicKey), kid: 'synthetic-key', alg: 'RS256', use: 'sig' };
  const keys = createLocalJWKSet({ keys: [key] });
  const verify = createKindeAccessTokenVerifier({ issuer, audience, clientId }, keys);
  const verifyCodeExchanged = createKindeCodeExchangeAccessTokenVerifier(
    { issuer, audience, clientId }, keys,
  );
  async function token({
    iss = issuer, aud = audience, azp = clientId, sub = subject,
    issuedAt = Math.floor(Date.now() / 1000) - 2,
    grantType,
    expiresAt = Math.floor(Date.now() / 1000) + 300,
    signingKey = privateKey, kid = 'synthetic-key',
  } = {}) {
    return new SignJWT({ azp, sub, ...(grantType ? { gty: grantType } : {}) }).setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(iss).setAudience(aud).setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt).sign(signingKey);
  }
  return { verify, verifyCodeExchanged, token };
}

void test('Kinde access token: verified RS256, issuer, API audience and authorized client only', async () => {
  const { verify, token } = await fixture();
  const principal = await verify(await token());
  assert.deepEqual(principal, {
    issuer, subject, issuedAtSeconds: principal.issuedAtSeconds,
    expiresAtSeconds: principal.expiresAtSeconds,
  });
  assert.equal(Object.hasOwn(principal, 'emailVerified'), false);
  assert.ok(Object.isFrozen(principal));
});

void test('Kinde token rejects wrong issuer, audience and client', async () => {
  const { verify, token } = await fixture();
  for (const altered of [
    { iss: 'https://other-kinde.example' },
    { aud: 'unrelated-api' },
    { azp: 'different-client' },
    { sub: '../other-owner' },
    { sub: 'machine-client' },
    { grantType: 'client_credentials' },
    { grantType: ['client_credentials'] },
    { grantType: ['authorization_code', 'client_credentials'] },
  ]) {
    await assert.rejects(verify(await token(altered)), /invalid-kinde-token/);
  }
});

void test('Kinde token rejects expiry, future iat and access-token lifetime over 15 minutes', async () => {
  const { verify, token } = await fixture();
  const now = Math.floor(Date.now() / 1000);
  for (const altered of [
    { issuedAt: now - 600, expiresAt: now - 1 },
    { issuedAt: now + 120, expiresAt: now + 300 },
    { issuedAt: now - 2, expiresAt: now + 3600 },
  ]) {
    await assert.rejects(verify(await token(altered)), /invalid-kinde-token/);
  }
});

void test('trusted one-use code exchange accepts configurable Kinde TTL but API keeps 15-minute cap', async () => {
  const { verify, verifyCodeExchanged, token } = await fixture();
  const now = Math.floor(Date.now() / 1000);
  for (const seconds of [24 * 60 * 60, 24 * 60 * 60 + 1, 3 * 24 * 60 * 60]) {
    const signed = await token({
      issuedAt: now - 2, expiresAt: now - 2 + seconds,
    });
    await assert.rejects(verify(signed), error =>
      error?.phase === 'access-token-lifetime' && error.message === 'invalid-kinde-token');
    assert.equal((await verifyCodeExchanged(signed)).subject, subject);
  }

  for (const altered of [
    { issuedAt: now + 120 },
    { issuedAt: now - 3600, expiresAt: now - 10 },
    { iss: 'https://impostor.invalid' },
    { aud: 'other-api' },
    { azp: 'other-client' },
    { grantType: 'client_credentials' },
    { grantType: ['client_credentials'] },
  ]) {
    await assert.rejects(verifyCodeExchanged(await token(altered)), /invalid-kinde-token/);
  }
  const { privateKey } = await generateKeyPair('RS256');
  await assert.rejects(
    verifyCodeExchanged(await token({ signingKey: privateKey })), /invalid-kinde-token/,
  );
});

void test('signed Kinde authorization-code access tokens retain audience and human identity gates', async () => {
  const { verify, verifyCodeExchanged, token } = await fixture();
  for (const grantType of [undefined, 'authorization_code', ['authorization_code']]) {
    const signed = await token({ grantType, aud: [audience, 'some-other-api'] });
    assert.equal((await verify(signed)).subject, subject);
    assert.equal((await verifyCodeExchanged(signed)).subject, subject);
  }
});

void test('access JWT rejection returns only a fixed phase, never token or claim values', async () => {
  const { verifyCodeExchanged, token } = await fixture();
  const now = Math.floor(Date.now() / 1000);
  const { privateKey: wrongKey } = await generateKeyPair('RS256');
  const cases = [
    ['access-token-audience', { aud: 'wrong-api' }],
    ['access-token-issuer', { iss: 'https://other-kinde.example' }],
    ['access-token-expired', { expiresAt: now - 100 }],
    ['access-token-key', { kid: 'missing-key' }],
    ['access-token-signature', { signingKey: wrongKey }],
    ['access-token-client', { azp: 'unrelated-client' }],
    ['access-token-subject', { sub: '../other-user' }],
    ['access-token-grant', { grantType: ['client_credentials'] }],
    ['access-token-timestamps', { issuedAt: now + 120 }],
  ];
  for (const [phase, options] of cases) {
    const signed = await token(options);
    await assert.rejects(verifyCodeExchanged(signed), error =>
      error instanceof KindeAccessTokenError
        && error.message === 'invalid-kinde-token'
        && error.phase === phase
        && !JSON.stringify(error).includes(signed)
        && !JSON.stringify(error).includes('unrelated-client'));
  }
  for (const invalid of ['bad.jwt', '', null]) {
    await assert.rejects(verifyCodeExchanged(invalid), error =>
      error instanceof KindeAccessTokenError
        && error.phase === 'access-token-format'
        && error.message === 'invalid-kinde-token');
  }
});

void test('Kinde token rejects signature spoofing and malformed JWT', async () => {
  const { verify, token } = await fixture();
  const { privateKey } = await generateKeyPair('RS256');
  await assert.rejects(verify(await token({ signingKey: privateKey })), /invalid-kinde-token/);
  for (const bad of ['', 'none.e30.', 'not-a-jwt', 'a'.repeat(8193)]) {
    await assert.rejects(verify(bad), /invalid-kinde-token/);
  }
});

void test('Kinde verifier fails closed for invalid environment configuration', () => {
  for (const bad of [
    { issuer: 'http://localhost', audience, clientId },
    { issuer: 'https://synthetic-kinde.example/x', audience, clientId },
    { issuer: 'https://synthetic-kinde.example', audience: '', clientId },
    { issuer, audience, clientId: '' },
  ]) {
    assert.throws(() => createKindeAccessTokenVerifier(bad), /invalid-kinde-configuration/);
  }
});
