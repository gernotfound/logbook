import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { deriveKindeOwnerId } from '../../cloudflare/auth/kinde-owner-id.mjs';
import { createKindeErasureManagement } from '../../cloudflare/jobs/kinde-erasure-management.mjs';
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

test('requests full profile erasure only after proof for the exact linked owner', async () => {
  const uid = await deriveKindeOwnerId(issuer, subject);
  const token = 'synthetic.worker.token';
  const phases = [];
  const remove = createKindeErasureManagement({
    issuer,
    async proveTerminalFence(owner) {
      assert.equal(owner, uid);
      phases.push('fenced');
      return true;
    },
    async fetchImpl(request) {
      phases.push('management');
      const url = new URL(request.url);
      assert.equal(url.origin, issuer);
      assert.equal(url.pathname, '/api/v1/user');
      assert.deepEqual([...url.searchParams], [['id', subject], ['is_delete_profile', 'true']]);
      assert.equal(request.method, 'DELETE');
      assert.equal(request.redirect, 'error');
      assert.equal(request.headers.get('authorization'), 'Bearer ' + token);
      assert.equal(request.body, null);
      return Response.json({ code: 'OK', message: 'Synthetic acknowledgement' });
    },
  });
  assert.equal(await remove({ uid, subject, accessToken: token }), 'acknowledged');
  assert.deepEqual(phases, ['fenced', 'management']);
});

test('withholds the operation on mismatched identity, invalid token or missing durable fence', async () => {
  const uid = await deriveKindeOwnerId(issuer, subject);
  for (const proveTerminalFence of [async () => false, async () => { throw new Error('D1 unavailable'); }]) {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return Response.json({ code: 'OK', message: 'Synthetic' }); };
    const remove = createKindeErasureManagement({ issuer, fetchImpl, proveTerminalFence });
    const target = { uid, subject, accessToken: 'synthetic.worker.token' };
    assert.equal(await remove(target), 'withheld');
    assert.equal(await remove({ ...target, subject: 'kp_foreign' }), 'withheld');
    assert.equal(await remove({ ...target, accessToken: 'invalid\nheader' }), 'withheld');
    assert.equal(calls, 0);
    assert.throws(() => createKindeErasureManagement({
      issuer: 'https://other.test', fetchImpl, proveTerminalFence,
    }), /kinde-erasure-management-unavailable/);
  }
});

test('never interprets ambiguous provider results as account erasure', async () => {
  const uid = await deriveKindeOwnerId(issuer, subject);
  const target = { uid, subject, accessToken: 'synthetic.worker.token' };
  const responseFactories = [
    ...[204, 302, 401, 403, 404, 429, 500].map(status => () => new Response(null, { status })),
    () => new Response('proxy page', { headers: { 'content-type': 'text/html' } }),
    () => new Response('invalid json', { headers: { 'content-type': 'application/json' } }),
    () => Response.json({ code: 'ERROR', message: 'Rejected' }),
    () => Response.json({ code: 'OK', message: 'x'.repeat(2048) }),
    () => { throw new Error('reply lost after a synthetic submission'); },
  ];
  for (const response of responseFactories) {
    let calls = 0;
    const remove = createKindeErasureManagement({
      issuer,
      async proveTerminalFence() { return true; },
      async fetchImpl() { calls += 1; return response(); },
    });
    assert.equal(await remove(target), 'unconfirmed');
    assert.equal(calls, 1);
  }
});
