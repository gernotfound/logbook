import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createKindeLoginProofVerifier } from '../../cloudflare/auth/kinde-login-proof.mjs';

const issuer = 'https://synthetic-kinde.example';
const clientId = 'synthetic-client-id-123';
const apiAudience = 'thelogbook:isolated-api';
const idTokenAudience = issuer;
const sub = 'kp_synthetic_user_12345';
const nonce = Buffer.alloc(32, 13).toString('base64url');

async function fixture() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const localKeys = createLocalJWKSet({
    keys: [{ ...await exportJWK(publicKey), kid: 'synthetic', use: 'sig', alg: 'RS256' }],
  });
  const verify = createKindeLoginProofVerifier(
    { issuer, clientId, apiAudience, idTokenAudience }, localKeys,
  );
  async function tokens({ accessClaims = {}, idClaims = {}, signingKey = privateKey } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const access = await new SignJWT({
      azp: clientId, sub, ...accessClaims,
    }).setIssuer(issuer).setAudience(apiAudience)
      .setIssuedAt(now - 2).setExpirationTime(now + 300)
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' }).sign(privateKey);
    const at_hash = createHash('sha256').update(access).digest().subarray(0, 16).toString('base64url');
    const id = await new SignJWT({
      azp: clientId, sub, nonce, email_verified: true, email: 'sample@example.invalid',
      auth_time: now - 60, at_hash, ...idClaims,
    }).setIssuer(issuer).setAudience(idTokenAudience)
      .setIssuedAt(now - 2).setExpirationTime(now + 300)
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' }).sign(signingKey);
    return { accessToken: access, idToken: id, expectedNonce: nonce };
  }
  return { verify, tokens };
}

void test('Kinde login proof: strict signed identity, nonce, distinct audiences and access binding', async () => {
  const { verify, tokens } = await fixture();
  const proof = await verify(await tokens());
  assert.deepEqual(proof, { issuer, subject: sub, emailVerified: true });
  assert.ok(Object.isFrozen(proof));
  assert.equal(Object.hasOwn(proof, 'email'), false);
});

void test('Kinde identity proof denies missing email verification and mismatched subject, nonce, audience', async () => {
  const { verify, tokens } = await fixture();
  const inputs = [
    { idClaims: { email_verified: false } },
    { idClaims: { email_verified: undefined } },
    { idClaims: { sub: 'kp_other_subject' } },
    { idClaims: { nonce: Buffer.alloc(32, 2).toString('base64url') } },
    { idClaims: { email: '' } },
    { idClaims: { azp: 'another-client' } },
    { idClaims: { at_hash: 'forged' } },
  ];
  for (const sample of inputs) {
    await assert.rejects(verify(await tokens(sample)), /invalid-kinde-login-proof/);
  }
  const valid = await tokens();
  await assert.rejects(verify({ ...valid, expectedNonce: 'client-provided' }), /invalid-kinde-login-proof/);
});

void test('Kinde ID token rejects wrong issuer and audience and signature forgery', async () => {
  const { verify, tokens } = await fixture();
  const { privateKey } = await generateKeyPair('RS256');
  for (const input of [
    { idClaims: { nonce: null } },
    { signingKey: privateKey },
    { idClaims: { auth_time: Math.floor(Date.now() / 1000) + 1000 } },
  ]) {
    await assert.rejects(verify(await tokens(input)), /invalid-kinde-login-proof/);
  }
  const good = await tokens();
  await assert.rejects(verify({ ...good, idToken: good.accessToken }), /invalid-kinde-login-proof/);
  await assert.rejects(verify({ ...good, idToken: good.idToken + 'trailing' }), /invalid-kinde-login-proof/);
});

void test('Code-flow ID token may omit at_hash; valid nonce and both signatures still mandatory', async () => {
  const { verify, tokens } = await fixture();
  const pair = await tokens({ idClaims: { at_hash: undefined } });
  assert.equal((await verify(pair)).subject, sub);
});

void test('Kinde ID proof rejects misconfigured audience and invalid nonce origin', async () => {
  const { verify, tokens } = await fixture();
  for (const input of [
    { issuer, clientId, apiAudience, idTokenAudience: '' },
    { issuer, clientId, apiAudience, idTokenAudience: ' https://invalid.example ' },
  ]) {
    assert.throws(() => createKindeLoginProofVerifier(input), TypeError);
  }
  const valid = await tokens();
  await assert.rejects(verify({ ...valid, expectedNonce: undefined }), /invalid-kinde-login-proof/);
});
