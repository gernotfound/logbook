import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc } from 'firebase/firestore';
import { seedTrustedConsent, asModularFirestore, registerReplica } from './replicaHarness';

let env: RulesTestEnvironment;
const privatePaths = [
  'users/a',
  'users/a/history_months/2026-09',
  'users/a/nutrition_months/2026-09',
  'users/a/sync_control/state',
];
const reservedPaths = [
  'account_deletions/a',
  'account_activity/a',
  'account_deletion_devices/a',
  'health_consent_withdrawals/a',
];

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Isolated emulator required');
  env = await initializeTestEnvironment({
    projectId: 'demo-logbook-audit',
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
  });
});
beforeEach(async () => { await env.clearFirestore(); await seedTrustedConsent(env); });
afterAll(async () => { await env?.cleanup(); });

it('denies foreign owner access on every private root/shard/control document and query', async () => {
  await env.withSecurityRulesDisabled(async admin => {
    const db = asModularFirestore(admin.firestore());
    for (const path of privatePaths) await setDoc(doc(db, path), { seeded: true });
  });
  const alice = asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore());
  const bob = asModularFirestore(env.authenticatedContext('b', { email_verified: true }).firestore());
  const anon = asModularFirestore(env.unauthenticatedContext().firestore());
  for (const path of privatePaths) {
    await assertSucceeds(getDoc(doc(alice, path)));
    await assertFails(getDoc(doc(bob, path)));
    await assertFails(getDoc(doc(anon, path)));
    await assertFails(deleteDoc(doc(bob, path)));
  }
  for (const path of ['history_months', 'nutrition_months', 'sync_control']) {
    await assertFails(getDocs(collection(bob, 'users', 'a', path)));
  }
  await assertFails(getDocs(collection(bob, 'users')));
});

it('bounds owner archive queries without blocking document reads or cursor-compatible pages', async () => {
  await env.withSecurityRulesDisabled(async admin => {
    const db = asModularFirestore(admin.firestore());
    for (const path of privatePaths) await setDoc(doc(db, path), { seeded: true });
  });

  const alice = asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore());
  const bob = asModularFirestore(env.authenticatedContext('b', { email_verified: true }).firestore());
  for (const name of ['history_months', 'nutrition_months']) {
    const collectionRef = collection(alice, 'users', 'a', name);
    // Standard sync uses 400 documents/page, backup uses 50.
    const backup = await assertSucceeds(getDocs(query(collectionRef, limit(50))));
    expect(backup.size).toBe(1);
    const fullCheckpoint = await assertSucceeds(getDocs(query(collectionRef, limit(400))));
    expect(fullCheckpoint.size).toBe(1);
    await assertFails(getDocs(collectionRef));
    await assertFails(getDocs(query(collectionRef, limit(401))));
    await assertFails(getDocs(query(collection(bob, 'users', 'a', name), limit(50))));
    await assertSucceeds(getDoc(doc(alice, 'users', 'a', name, '2026-09')));
  }
  // Neither the users root nor replica-control records need enumeration.
  await assertSucceeds(getDoc(doc(alice, 'users/a')));
  await assertSucceeds(getDoc(doc(alice, 'users/a/sync_control/state')));
  await assertFails(getDocs(collection(alice, 'users')));
  await assertFails(getDocs(collection(alice, 'users', 'a', 'sync_control')));
});

it('denies cross-owner replica registration while allowing the verified owner', async () => {
  const alice = asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore());
  const bob = asModularFirestore(env.authenticatedContext('b', { email_verified: true }).firestore());
  await assertFails(registerReplica(bob, 'a'));
  await assertSucceeds(registerReplica(alice, 'a'));

});

it('never exposes administrative deletion, device recovery or consent records to clients', async () => {
  await env.withSecurityRulesDisabled(async admin => {
    const db = asModularFirestore(admin.firestore());
    for (const path of reservedPaths) await setDoc(doc(db, path), { uid: 'a' });
  });
  const clients = [
    asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore()),
    asModularFirestore(env.authenticatedContext('b', { email_verified: true }).firestore()),
    asModularFirestore(env.unauthenticatedContext().firestore()),
  ];
  for (const db of clients) for (const path of reservedPaths) {
    await assertFails(getDoc(doc(db, path)));
    await assertFails(setDoc(doc(db, path), { uid: 'a', status: 'active', revision: 1 }));
    await assertFails(deleteDoc(doc(db, path)));
  }
});
