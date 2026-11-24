import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyCurrentD1Schema } from './current-d1-schema.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  createKindeDeletionReauthVerifier, createKindeIdentityProofVerifier, createKindeLoginProofVerifier,
} from '../../cloudflare/auth/kinde-login-proof.mjs';
import { createKindePrincipalProvisioner, KindePrincipalProvisionError } from '../../cloudflare/auth/kinde-principal-provisioner.mjs';

const issuer = 'https://synthetic-kinde.example';
const clientId = 'synthetic-client-id-123';
const apiAudience = 'thelogbook:isolated-api';
const idTokenAudience = clientId;
const sub = 'kp_synthetic_user_12345';
const nonce = Buffer.alloc(32, 13).toString('base64url');

async function fixture() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const localKeys = createLocalJWKSet({
    keys: [{ ...await exportJWK(publicKey), kid: 'synthetic', use: 'sig', alg: 'RS256' }],
  });
  const config = { issuer, clientId, apiAudience };
  const verify = createKindeLoginProofVerifier(config, localKeys);
  const verifyIdentity = createKindeIdentityProofVerifier(config, localKeys);
  const verifyDeletion = createKindeDeletionReauthVerifier(config, localKeys);
  async function tokens({
    accessClaims = {}, idClaims = {}, signingKey = privateKey,
    accessIssuer = issuer, idIssuer = issuer,
    accessAudience = apiAudience, idAudience = idTokenAudience,
    idKeyId = 'synthetic',
    accessIssuedBefore = 2, idIssuedBefore = 2,
    accessExpiresIn = 300, idExpiresIn = 300,
  } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const access = await new SignJWT({
      azp: clientId, sub, ...accessClaims,
    }).setIssuer(accessIssuer).setAudience(accessAudience)
      .setIssuedAt(now - accessIssuedBefore).setExpirationTime(now + accessExpiresIn)
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' }).sign(privateKey);
    const at_hash = createHash('sha256').update(access).digest().subarray(0, 16).toString('base64url');
    const id = await new SignJWT({
      azp: clientId, sub, nonce, email_verified: true, email: 'sample@example.invalid',
      auth_time: now - 60, at_hash, ...idClaims,
    }).setIssuer(idIssuer).setAudience(idAudience)
      .setIssuedAt(now - idIssuedBefore).setExpirationTime(now + idExpiresIn)
      .setProtectedHeader({ alg: 'RS256', kid: idKeyId }).sign(signingKey);
    return { accessToken: access, idToken: id, expectedNonce: nonce };
  }
  const rawProvision = createKindePrincipalProvisioner(
    { issuer, clientId, apiAudience }, localKeys,
  );
  // Simulate only a trusted callback: the saved nonce is never read from the token payload.
  const provision = (db, proof) => rawProvision(db, proof, nonce);
  return { verify, verifyIdentity, verifyDeletion, tokens, provision, rawProvision };
}

void test('deletion reauthentication returns only the signed time and the already requested owner', async () => {
  const { verifyDeletion, tokens } = await fixture();
  const expectedUid = 'k_' + createHash('sha256')
    .update('thelogbook:kinde-owner:v1\0' + issuer + '\0' + sub).digest('base64url');
  const authenticatedAtMs = Math.floor(Date.now() / 1000) * 1000 - 3000;
  const attempt = { expectedUid, startedAtMs: authenticatedAtMs };
  const valid = await tokens({ idClaims: { auth_time: authenticatedAtMs / 1000 } });
  assert.deepEqual(await verifyDeletion(valid, attempt), { uid: expectedUid, authenticatedAtMs });

  // Signed ownership still lets the same owner request deletion when the
  // provider no longer marks their email as verified.
  const unverifiedEmail = await tokens({
    idClaims: { auth_time: authenticatedAtMs / 1000, email_verified: false },
  });
  assert.deepEqual(await verifyDeletion(unverifiedEmail, attempt), { uid: expectedUid, authenticatedAtMs });
  await assert.rejects(verifyDeletion(valid, { ...attempt, startedAtMs: authenticatedAtMs + 1 }),
    { phase: 'deletion-reauthentication' });
  await assert.rejects(verifyDeletion(valid, { ...attempt, expectedUid: 'k_' + 'a'.repeat(43) }),
    { phase: 'deletion-reauthentication' });
  await assert.rejects(verifyDeletion({ ...valid, expectedNonce: 'A'.repeat(43) }, attempt),
    { phase: 'id-claims' });
});

void test('a fresh token issued on an older or future SSO time cannot authorize account deletion', async (t) => {
  const { verify, verifyDeletion, tokens } = await fixture();
  const expectedUid = 'k_' + createHash('sha256')
    .update('thelogbook:kinde-owner:v1\0' + issuer + '\0' + sub).digest('base64url');
  const fixedTime = Date.now();
  t.mock.method(Date, 'now', () => fixedTime);
  const now = Math.floor(fixedTime / 1000);
  const stale = await tokens({ idClaims: { auth_time: now - 301 } });
  assert.equal((await verify(stale)).emailVerified, true);
  await assert.rejects(verifyDeletion(stale, { expectedUid, startedAtMs: (now - 302) * 1000 }),
    { phase: 'deletion-reauthentication' });
  const future = await tokens({ idIssuedBefore: 0, idClaims: { auth_time: now + 3 } });
  await assert.rejects(verifyDeletion(future, { expectedUid, startedAtMs: now * 1000 }),
    { phase: 'deletion-reauthentication' });
});

void test('trusted login proof failure phases never include JWT contents or user claims', async () => {
  const { verify, tokens } = await fixture();
  const valid = await tokens();
  const rejected = [
    ['identity-input', { ...valid, idToken: 'not-a-jwt' }],
    ['access-token-audience', { ...valid, accessToken: valid.idToken }],
    ['id-token-audience', { ...valid, idToken: valid.accessToken }],
    ['id-claims', await tokens({ idClaims: { email_verified: false } })],
    ['id-claims', await tokens({ idClaims: { nonce: null } })],
    ['token-binding', await tokens({ idClaims: { at_hash: 'bad-binding' } })],
  ];
  for (const [phase, pair] of rejected) {
    await assert.rejects(verify(pair), error =>
      error?.message === 'invalid-kinde-login-proof'
        && error?.phase === phase
        && !JSON.stringify(error).includes('sample@example.invalid'));
  }
});

void test('trusted ID proof keeps access JWT phases finite and refuses Kinde machine grants', async () => {
  const { verify, tokens } = await fixture();
  const invalid = [
    ['access-token-audience', { accessAudience: 'another-api' }],
    ['access-token-issuer', { accessIssuer: 'https://other-kinde.example' }],
    ['access-token-client', { accessClaims: { azp: 'another-client' } }],
    ['access-token-subject', { accessClaims: { sub: 'not-a-kinde-user' } }],
    ['access-token-grant', { accessClaims: { gty: ['client_credentials'] } }],
  ];
  for (const [phase, options] of invalid) {
    const signed = await tokens(options);
    await assert.rejects(verify(signed), error =>
      error?.name === 'KindeLoginProofError'
        && error.message === 'invalid-kinde-login-proof'
        && error.phase === phase
        && !JSON.stringify(error).includes(signed.accessToken)
        && !JSON.stringify(error).includes('sample@example.invalid'));
  }
  assert.equal((await verify(await tokens({
    accessClaims: { gty: ['authorization_code'] },
  }))).emailVerified, true);
});

void test('ID token rejection distinguishes signed audience, issuer, expiry, key and signature', async () => {
  const { verify, tokens } = await fixture();
  const { privateKey: wrongKey } = await generateKeyPair('RS256');
  const cases = [
    ['id-token-audience', { idAudience: 'unrelated-application' }],
    ['id-token-audience', { idAudience: issuer }],
    ['id-token-audience', { idAudience: [clientId, 'untrusted-audience'] }],
    ['id-token-issuer', { idIssuer: 'https://unrelated-kinde.example' }],
    ['id-token-expired', { idExpiresIn: -30 }],
    ['id-token-key', { idKeyId: 'unknown-kid' }],
    ['id-token-signature', { signingKey: wrongKey }],
  ];
  for (const [phase, options] of cases) {
    const proof = await tokens(options);
    await assert.rejects(verify(proof), error =>
      error?.name === 'KindeLoginProofError'
        && error?.message === 'invalid-kinde-login-proof'
        && error?.phase === phase
        && !JSON.stringify(error).includes(proof.idToken)
        && !JSON.stringify(error).includes('sample@example.invalid'));
  }
  // Kinde can issue an audience array containing both the app and issuer.
  assert.equal((await verify(await tokens({ idAudience: [clientId, issuer] }))).emailVerified, true);
  // None of these diagnostics authorize another app's audience or signature.
  assert.equal((await verify(await tokens())).emailVerified, true);
});

void test('identity-only proof returns only signed issuer, subject and explicit email boolean', async () => {
  const { verify, verifyIdentity, tokens } = await fixture();
  for (const emailVerified of [true, false]) {
    const signed = await tokens({ idClaims: { email_verified: emailVerified } });
    const identity = await verifyIdentity(signed);
    assert.deepEqual(identity, { issuer, subject: sub, emailVerified });
    assert.deepEqual(Object.keys(identity).sort(), ['emailVerified', 'issuer', 'subject']);
    assert.ok(Object.isFrozen(identity));
    if (emailVerified) {
      assert.deepEqual(await verify(signed), identity);
    } else {
      await assert.rejects(verify(signed), /invalid-kinde-login-proof/);
    }
  }
});

void test('identity-only proof refuses missing or non-boolean email_verified', async () => {
  const { verify, verifyIdentity, tokens } = await fixture();
  for (const value of [undefined, null, 'true', 'false', 0, 1, [], {}]) {
    const signed = await tokens({ idClaims: { email_verified: value } });
    await assert.rejects(verifyIdentity(signed), /invalid-kinde-login-proof/);
    await assert.rejects(verify(signed), /invalid-kinde-login-proof/);
  }
});

void test('unverified identity proof still enforces both signed tokens, issuer, audiences, azp, subject and trusted nonce', async () => {
  const { verifyIdentity, tokens } = await fixture();
  const { privateKey: forgedKey } = await generateKeyPair('RS256');
  const wrong = [
    { signingKey: forgedKey },
    { accessIssuer: 'https://other-kinde.example' },
    { idIssuer: 'https://other-kinde.example' },
    { accessAudience: 'other-api' },
    { idAudience: 'other-client' },
    { accessClaims: { azp: 'other-client' } },
    { idClaims: { azp: 'other-client' } },
    { accessClaims: { sub: 'kp_other' } },
    { idClaims: { sub: 'kp_other' } },
    { accessClaims: { gty: 'client_credentials' } },
    { idClaims: { nonce: Buffer.alloc(32, 2).toString('base64url') } },
    { idClaims: { nonce: null } },
    { idClaims: { email: '' } },
    { idClaims: { auth_time: Math.floor(Date.now() / 1000) + 900 } },
    { idClaims: { at_hash: 'wrong-binding' } },
  ];
  for (const invalid of wrong) {
    const signed = await tokens({ ...invalid, idClaims: {
      email_verified: false, ...invalid.idClaims,
    } });
    await assert.rejects(verifyIdentity(signed), /invalid-kinde-login-proof/);
  }
  const valid = await tokens({ idClaims: { email_verified: false } });
  for (const expectedNonce of ['client-selected', undefined, null]) {
    await assert.rejects(verifyIdentity({ ...valid, expectedNonce }), /invalid-kinde-login-proof/);
  }
  // Optional at_hash is valid in Authorization Code; if present it must match.
  assert.equal((await verifyIdentity(await tokens({
    idClaims: { email_verified: false, at_hash: undefined },
  }))).emailVerified, false);
});

void test('identity-only proof rejects expired, future-issued, overlong and oversized JWTs', async () => {
  const { verifyIdentity, tokens } = await fixture();
  const rejected = [
    { accessExpiresIn: -1 },
    { idExpiresIn: -1 },
    { accessIssuedBefore: -30 },
    { idIssuedBefore: -30 },
    { idExpiresIn: 3601 },
  ];
  for (const invalid of rejected) {
    await assert.rejects(verifyIdentity(await tokens({
      idClaims: { email_verified: false }, ...invalid,
    })), /invalid-kinde-login-proof/);
  }
  const valid = await tokens({ idClaims: { email_verified: false } });
  for (const changed of [
    { ...valid, accessToken: 'a'.repeat(8193) },
    { ...valid, idToken: 'a'.repeat(8193) },
  ]) {
    await assert.rejects(verifyIdentity(changed), /invalid-kinde-login-proof/);
  }
});

void test('identity-only proof never provisions a principal or issues a D1 session', async () => {
  const { verifyIdentity, verify, provision, tokens } = await fixture();
  const { sqlite, db } = principalDb();
  try {
    const signed = await tokens({ idClaims: { email_verified: false } });
    assert.equal((await verifyIdentity(signed)).emailVerified, false);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
    await assert.rejects(verify(signed), /invalid-kinde-login-proof/);
    await assert.rejects(provision(db, signed), KindePrincipalProvisionError);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
  } finally { sqlite.close(); }
});

void test('Kinde login proof: strict signed identity, nonce, distinct audiences and access binding', async () => {
  const { verify, tokens } = await fixture();
  const proof = await verify(await tokens());
  assert.deepEqual(proof, { issuer, subject: sub, emailVerified: true });
  assert.ok(Object.isFrozen(proof));
  assert.equal(Object.hasOwn(proof, 'email'), false);
});

void test('signed, nonce-bound login proof accepts provider TTL variation but not weaker ID claims', async () => {
  const { verify, verifyIdentity, tokens } = await fixture();
  for (const accessExpiresIn of [24 * 60 * 60 - 2, 24 * 60 * 60 + 1, 3 * 24 * 60 * 60]) {
    const signed = await tokens({ accessExpiresIn });
    assert.deepEqual(await verify(signed), { issuer, subject: sub, emailVerified: true });
    assert.equal((await verifyIdentity(signed)).subject, sub);
  }

  for (const bad of [
    { accessAudience: 'unapproved-api', accessExpiresIn: 3 * 24 * 60 * 60 },
    { idClaims: { email_verified: false }, accessExpiresIn: 3 * 24 * 60 * 60 },
    { idClaims: { nonce: Buffer.alloc(32, 20).toString('base64url') },
      accessExpiresIn: 3 * 24 * 60 * 60 },
    { idExpiresIn: 3601, accessExpiresIn: 3 * 24 * 60 * 60 },
  ]) {
    await assert.rejects(verify(await tokens(bad)), /invalid-kinde-login-proof/);
  }
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

void test('Kinde ID proof rejects invalid OAuth client ID and nonce origin', async () => {
  const { verify, tokens } = await fixture();
  for (const input of [
    { issuer, clientId: '', apiAudience },
    { issuer, clientId: 'short', apiAudience },
    { issuer, clientId: ' invalid client ', apiAudience },
    { issuer, clientId: 'a'.repeat(257), apiAudience },
  ]) {
    assert.throws(() => createKindeLoginProofVerifier(input), TypeError);
  }
  const valid = await tokens();
  await assert.rejects(verify({ ...valid, expectedNonce: undefined }), /invalid-kinde-login-proof/);
});


function principalDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  applyCurrentD1Schema(sqlite);
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

void test('principal failure exposes only a storage checkpoint, never owner or tokens', async () => {
  const { provision, tokens } = await fixture();
  const proof = await tokens();
  await assert.rejects(provision(null, proof), error =>
    error instanceof KindePrincipalProvisionError
      && error.phase === 'principal-storage'
      && error.message === 'kinde-principal-unavailable');
  const { db, sqlite } = principalDb();
  try {
    await assert.rejects(provision(db, await tokens({
      idClaims: { email_verified: false },
    })), error =>
      error instanceof KindePrincipalProvisionError
        && error.phase === 'id-claims');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM auth_principals').get().n, 0);
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
