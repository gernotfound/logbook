import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
const mark = (status: 'active' | 'withdrawn') => ({
  uid: 'u', status, revision: 1, withdrawnAt: new Date(),
});

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Only the isolated local emulator is allowed.');
  env = await initializeTestEnvironment({
    projectId: 'demo-consent-privacy',
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
  });
});
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env?.cleanup(); });

it('keeps withdrawal records server-only even for their owner', async () => {
  const db = env.authenticatedContext('u', { email_verified: true }).firestore();
  await assertFails(getDoc(doc(db, 'health_consent_withdrawals/u')));
  await assertFails(setDoc(doc(db, 'health_consent_withdrawals/u'), mark('active')));
});

it('denies all direct fitness reads and writes after withdrawal', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'health_consent_withdrawals/u'), mark('withdrawn'));
    await setDoc(doc(context.firestore(), 'users/u'), { legacy: 'retained for export' });
  });
  const db = env.authenticatedContext('u', { email_verified: true }).firestore();
  await assertFails(getDoc(doc(db, 'users/u')));
  await assertFails(deleteDoc(doc(db, 'users/u/telemetry_events/one')));
  await assertFails(setDoc(doc(db, 'users/u/telemetry_events/one'), {
    timestamp: Date.now(), type: 'workout_started', userId: 'u', sessionId: 's',
    context: { appVersion: '1.0', platform: 'other', displayMode: 'browser', online: true },
    expireAt: new Date(Date.now() + 86400000),
  }));
});
