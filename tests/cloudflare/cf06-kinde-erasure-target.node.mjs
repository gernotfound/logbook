import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { deriveKindeOwnerId } from '../../cloudflare/auth/kinde-owner-id.mjs';
import { createKindeErasureTargetCodec } from '../../cloudflare/jobs/kinde-erasure-target.mjs';

const issuer = 'https://synthetic-tenant.kinde.com';
const subject = 'kp_synthetic-deletion-reference';
const keyId = 'synthetic-erasure-v1';
const error = { message: 'kinde-erasure-target-unavailable' };
const keyFor = (extractable = false) => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);

test('derives the same public owner identifier as the trusted callback contract', async () => {
  const expected = 'k_' + createHash('sha256')
    .update('thelogbook:kinde-owner:v1\0' + issuer + '\0' + subject)
    .digest('base64url');
  assert.equal(await deriveKindeOwnerId(issuer, subject), expected);
  assert.notEqual(await deriveKindeOwnerId('https://other-tenant.kinde.com', subject), expected);
  for (const invalid of ['https://synthetic-tenant.kinde.com/extra', 'https://name@synthetic-tenant.kinde.com', 'http://synthetic-tenant.kinde.com']) {
    await assert.rejects(deriveKindeOwnerId(invalid, subject), /invalid-kinde-owner-input/);
  }
});

test('seals only the subject bound to its owner and keeps the provider identifier outside stored metadata', async () => {
  const key = await keyFor();
  const uid = await deriveKindeOwnerId(issuer, subject);
  const codec = createKindeErasureTargetCodec({ issuer, keyId, key });
  const first = await codec.seal({ uid, subject });
  const second = await codec.seal({ uid, subject });
  assert.equal(await codec.open(uid, structuredClone(first)), subject);
  assert.notEqual(first.iv, second.iv);
  assert.equal(JSON.stringify(first).includes(subject), false);
  await assert.rejects(codec.seal({ uid, subject: 'kp_different-synthetic-user' }), error);
});

test('fails closed on owner, tenant, key or ciphertext changes', async () => {
  const key = await keyFor();
  const uid = await deriveKindeOwnerId(issuer, subject);
  const otherUid = await deriveKindeOwnerId(issuer, 'kp_other-synthetic-user');
  const codec = createKindeErasureTargetCodec({ issuer, keyId, key });
  const record = await codec.seal({ uid, subject });
  const wrongKey = createKindeErasureTargetCodec({ issuer, keyId, key: await keyFor() });
  const wrongIssuer = createKindeErasureTargetCodec({ issuer: 'https://other-tenant.kinde.com', keyId, key });
  const wrongVersion = createKindeErasureTargetCodec({ issuer, keyId: 'next', key });
  await assert.rejects(codec.open(otherUid, { ...record, uid: otherUid }), error);
  await assert.rejects(wrongKey.open(uid, record), error);
  await assert.rejects(wrongIssuer.open(uid, record), error);
  await assert.rejects(wrongVersion.open(uid, { ...record, keyId: 'next' }), error);
  for (const invalid of [{ ...record, version: 2 }, { ...record, subject }, { ...record, iv: record.iv + '=' },
    { ...record, ciphertext: (record.ciphertext[0] === 'A' ? 'B' : 'A') + record.ciphertext.slice(1) }]) {
    await assert.rejects(codec.open(uid, invalid), error);
  }
});

test('rejects a key that can be exported or a missing key identifier', async () => {
  const key = await keyFor(true);
  const privateKey = await keyFor();
  assert.throws(() => createKindeErasureTargetCodec({ issuer, keyId, key }), error);
  assert.throws(() => createKindeErasureTargetCodec({ issuer, keyId: '', key: privateKey }), error);
});
