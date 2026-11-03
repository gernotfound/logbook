import { readFileSync } from 'node:fs';
import { seedTrustedConsent, asModularFirestore } from './replicaHarness';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
    throw new Error('Run via test:rules: only the isolated local emulator is allowed');
  }
  env = await initializeTestEnvironment({
    projectId: 'demo-logbook-audit',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => { await env.clearFirestore(); await seedTrustedConsent(env); });
afterAll(async () => { await env?.cleanup(); });

const context = {
  appVersion: '1.1.0', platform: 'other', displayMode: 'browser', online: true,
};
const base = { consentRevision: 1, timestamp: 1000, userId: 'a', sessionId: 'session-a', context };
const retiredPayloads = {
  telemetry_events: { ...base, type: 'workout_started', details: { offline: false, routineId: 'r' } },
  telemetry_errors: { ...base, type: 'TypeError', message: 'safe message', source: 'window_error',
    count: 1, firstSeen: 1000, lastSeen: 1000 },
  telemetry_anomalies: { consentRevision: 1, type: 'storage_recovery_anomaly',
    reason: 'indexeddb_cache_missing_with_valid_marker', timestamp: 1000, elapsedMs: 50,
    platform: 'other', standalone: false, persisted: null },
};
const cases = Object.entries(retiredPayloads).flatMap(([collectionName, payload]) =>
  [false, true].map(withExpiry => ({ collectionName, payload, withExpiry })));

it.each(cases)('keeps $collectionName client-inaccessible without altering residual data (expiry=$withExpiry)', async ({ collectionName, payload, withExpiry }) => {
  const path = `users/a/${collectionName}/residual`;
  const expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const stored = withExpiry ? { ...payload, expireAt } : payload;
  await env.withSecurityRulesDisabled(async admin => {
    await setDoc(doc(asModularFirestore(admin.firestore()), path), stored);
  });
  const clients = [
    env.authenticatedContext('a', { email_verified: true }),
    env.authenticatedContext('a', { email_verified: false }),
    env.authenticatedContext('b', { email_verified: true }),
    env.unauthenticatedContext(),
  ];
  for (const client of clients) {
    const db = asModularFirestore(client.firestore());
    const ref = doc(db, path);
    await assertFails(getDoc(ref));
    await assertFails(getDocs(collection(db, 'users', 'a', collectionName)));
    await assertFails(setDoc(doc(db, `users/a/${collectionName}/new`), { ...payload, expireAt }));
    await assertFails(setDoc(ref, stored));
    await assertFails(setDoc(ref, { expireAt }, { merge: true }));
    await assertFails(deleteDoc(ref));
  }
  await env.withSecurityRulesDisabled(async admin => {
    const db = asModularFirestore(admin.firestore());
    const saved = (await getDoc(doc(db, path))).data()!;
    const { expireAt: savedExpiry, ...savedPayload } = saved;
    expect(savedPayload).toEqual(payload);
    if (withExpiry) expect(savedExpiry.toMillis()).toBe(expireAt.getTime());
    else expect(savedExpiry).toBeUndefined();
    expect((await getDoc(doc(db, `users/a/${collectionName}/new`))).exists()).toBe(false);
  });
});
