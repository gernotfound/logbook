import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createKindeAccessTokenVerifier } from '../../cloudflare/auth/kinde-token-verifier.mjs';

const issuer = 'https://synthetic-kinde.example';
const audience = 'thelogbook:isolated-api';
const clientId = 'synthetic-client-only';
const subject = 'kp_synthetic_user_123456';

async function fixture() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const key = { ...await exportJWK(publicKey), kid: 'synthetic-key', alg: 'RS256', use: 'sig' };
  const verify = createKindeAccessTokenVerifier({ issuer, audience, clientId },
    createLocalJWKSet({ keys: [key] }));
  async function token({
    iss = issuer, aud = audience, azp = clientId, sub = subject,
    issuedAt = Math.floor(Date.now() / 1000) - 2,
    grantType,
    expiresAt = Math.floor(Date.now() / 1000) + 300,
    signingKey = privateKey,
  } = {}) {
    return new SignJWT({ azp, sub, ...(grantType ? { gty: grantType } : {}) }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' })
      .setIssuer(iss).setAudience(aud).setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt).sign(signingKey);
  }
  return { verify, token };
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
