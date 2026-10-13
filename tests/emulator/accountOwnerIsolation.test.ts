import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { seedTrustedConsent, asModularFirestore, registerReplica } from './replicaHarness';

let env: RulesTestEnvironment;
const privatePaths = [
  'users/a',
  'users/a/history_months/2026-09',
  'users/a/nutrition_months/2026-09',
  'users/a/sync_control/state',
  'users/a/telemetry_errors/event',
  'users/a/telemetry_events/event',
  'users/a/telemetry_anomalies/event',
];
const reservedPaths = [
  'account_deletions/a',
  'account_deletion_devices/a',
  'health_consent_withdrawals/a',
];

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Isolated emulator required');
  env = await initializeTestEnvironment({
    projectId: 'demo-owner-isolation',
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
  });
});
beforeEach(async () => { await env.clearFirestore(); await seedTrustedConsent(env); });
afterAll(async () => { await env?.cleanup(); });

it('denies foreign owner access on every private root/shard/control/telemetry document and query', async () => {
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
  for (const path of ['history_months', 'nutrition_months', 'sync_control',
    'telemetry_errors', 'telemetry_events', 'telemetry_anomalies']) {
    await assertFails(getDocs(collection(bob, 'users', 'a', path)));
  }
  await assertFails(getDocs(collection(bob, 'users')));
});

it('denies cross-owner replica registration and otherwise valid owner telemetry', async () => {
  const alice = asModularFirestore(env.authenticatedContext('a', { email_verified: true }).firestore());
  const bob = asModularFirestore(env.authenticatedContext('b', { email_verified: true }).firestore());
  await assertFails(registerReplica(bob, 'a'));
  await assertSucceeds(registerReplica(alice, 'a'));
  const event = {
    consentRevision: 1,
    timestamp: Date.now(),
    type: 'workout_started',
    context: { appVersion: '1.1.0', platform: 'other', displayMode: 'browser', online: true },
    userId: 'a',
    sessionId: 'owner-isolation',
    expireAt: new Date(Date.now() + 86_400_000),
  };
  await assertSucceeds(setDoc(doc(alice, 'users/a/telemetry_events/new'), event));
  await assertFails(setDoc(doc(bob, 'users/a/telemetry_events/foreign'), event));
  await assertFails(deleteDoc(doc(bob, 'users/a/telemetry_events/new')));
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
