import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createKindeLoginProofVerifier } from '../../cloudflare/auth/kinde-login-proof.mjs';
import { createKindePrincipalProvisioner, KindePrincipalProvisionError } from '../../cloudflare/auth/kinde-principal-provisioner.mjs';

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
  const rawProvision = createKindePrincipalProvisioner(
    { issuer, clientId, apiAudience, idTokenAudience }, localKeys,
  );
  // Simulate only a trusted callback: the saved nonce is never read from the token payload.
  const provision = (db, proof) => rawProvision(db, proof, nonce);
  return { verify, tokens, provision, rawProvision };
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


function principalDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL(
    '../../cloudflare/api/migrations/0003_auth_session_gate.sql', import.meta.url,
  ), 'utf8'));
  const db = {
    withSession(mode) {
      assert.equal(mode, 'first-primary');
      return {
        prepare(sql) {
          return {
            bind(...params) {
              return {
                async run() {
                  const result = sqlite.prepare(sql).run(...params);
                  return { success: true, meta: { changes: result.changes } };
                },
                async first() {
                  return sqlite.prepare(sql).get(...params) ?? null;
                },
              };
            },
          };
        },
      };
    },
  };
  return { sqlite, db };
}

void test('Kinde owner: a signed verified identity creates one stable principal, not an email-derived UID', async () => {
  const { provision, tokens } = await fixture();
  const { sqlite, db } = principalDb();
  try {
    const signed = await tokens();
    const first = await provision(db, { ...signed, expectedNonce: 'untrusted-client-nonce' });
    const firstRow = sqlite.prepare('SELECT * FROM auth_principals WHERE uid = ?').get(first.uid);
    assert.match(first.uid, /^k_[A-Za-z0-9_-]{43}$/);
    assert.equal(firstRow.status, 'active');
    assert.equal(firstRow.auth_epoch, 1);
    assert.ok(firstRow.verified_at_ms > 0);
    assert.ok(Object.isFrozen(first));
    const repeated = await provision(db, signed);
    assert.deepEqual(repeated, first);
    assert.deepEqual(sqlite.prepare('SELECT * FROM auth_principals WHERE uid = ?').get(first.uid), firstRow);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_principals').get().count, 1);

    const otherSubject = 'kp_another_valid_subject';
    const other = await provision(db, await tokens({
      accessClaims: { sub: otherSubject }, idClaims: { sub: otherSubject },
    }));
    assert.notEqual(other.uid, first.uid);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_principals').get().count, 2);
  } finally { sqlite.close(); }
});

void test('Kinde owner: a fresh login never resurrects a disabled/deleted principal or resets its epoch', async () => {
  const { provision, tokens } = await fixture();
  const { sqlite, db } = principalDb();
  try {
    const signed = await tokens();
    const { uid } = await provision(db, signed);
    sqlite.prepare('UPDATE auth_principals SET auth_epoch = 3 WHERE uid = ?').run(uid);
    assert.deepEqual(await provision(db, signed), { uid });
    assert.equal(sqlite.prepare('SELECT auth_epoch FROM auth_principals WHERE uid = ?').get(uid).auth_epoch, 3);
    for (const status of ['disabled', 'deleted']) {
      sqlite.prepare('UPDATE auth_principals SET status = ? WHERE uid = ?').run(status, uid);
      await assert.rejects(provision(db, signed), KindePrincipalProvisionError);
      assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid = ?').get(uid).status, status);
    }
  } finally { sqlite.close(); }
});

void test('Kinde owner: nonce/email/subject/machine-proof failures cause no D1 principal write', async () => {
  const { provision, rawProvision, tokens } = await fixture();
  const { sqlite, db } = principalDb();
  try {
    const valid = await tokens();
    await assert.rejects(rawProvision(db, valid, Buffer.alloc(32, 8).toString('base64url')),
      KindePrincipalProvisionError);
    const altered = [
      await tokens({ idClaims: { nonce: Buffer.alloc(32, 8).toString('base64url') } }),
      await tokens({ idClaims: { email_verified: false } }),
      await tokens({ idClaims: { sub: 'kp_swapped_identity' } }),
      await tokens({ accessClaims: { gty: 'client_credentials' } }),
    ];
    for (const proof of altered) {
      await assert.rejects(provision(db, proof), KindePrincipalProvisionError);
    }
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_principals').get().count, 0);
  } finally { sqlite.close(); }
});

void test('Kinde owner: missing DB, failed or ambiguous D1 write/read cannot produce a principal', async () => {
  const { provision, tokens } = await fixture();
  const proof = await tokens();
  const { sqlite, db } = principalDb();
  try {
    await assert.rejects(provision(null, proof), KindePrincipalProvisionError);
    for (const response of [
      { success: true, meta: { changes: undefined } },
      { success: false, meta: { changes: 1 } },
      { success: true, meta: { changes: 2 } },
    ]) {
      const uncertain = {
        withSession() {
          return { prepare: () => ({ bind: () => ({
            run: async () => response,
          }) }) };
        },
      };
      await assert.rejects(provision(uncertain, proof), KindePrincipalProvisionError);
    }
    const unreadable = {
      withSession(mode) {
        const session = db.withSession(mode);
        return {
          prepare(sql) {
            const original = session.prepare(sql);
            return {
              bind(...params) {
                const statement = original.bind(...params);
                return { run: statement.run, first: async () => { throw new Error('read unavailable'); } };
              },
            };
          },
        };
      },
    };
    await assert.rejects(provision(unreadable, proof), KindePrincipalProvisionError);
    // The initial insert may have committed despite an unreadable result.
    // A new authenticated attempt reconciles the SAME owner, not a new UID.
    const reconciled = await provision(db, proof);
    assert.match(reconciled.uid, /^k_/);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_principals').get().count, 1);
  } finally { sqlite.close(); }
});
