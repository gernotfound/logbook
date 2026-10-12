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

// An active account retains ordinary reads: only the withdrawn state has the server-export gate.
it('retains direct owner reads when consent is active', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'health_consent_withdrawals/u'), mark('active'));
    await setDoc(doc(context.firestore(), 'users/u'), { profile: { name: 'Test' } });
  });
  const db = env.authenticatedContext('u', { email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(db, 'users/u')));
});

// The server has reactivated the account at revision 2. Stale Protocol 3
// clients without a consent generation must not create or renew replicas.
it('rejects a stale replica registration after reacceptance', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'health_consent_withdrawals/u'), { uid: 'u', status: 'active', revision: 2 });
    await setDoc(doc(context.firestore(), 'users/u'), { profile: { name: 'Test' } });
  });
  const db = env.authenticatedContext('u', { email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(db, 'users/u')));
  const now = Date.now();
  const base = {
    protocolVersion: 3,
    replicas: { s00: { replicaId: 'r', generation: 1, status: 'active', lastSeq: 0,
      checkpointAtMs: now, leaseUntilMs: now + 30_000, checkpointClock: {} } },
    mutation: { slot: 's00', action: 'register' },
  };
  await assertFails(setDoc(doc(db, 'users/u/sync_control/state'), base));
  await assertSucceeds(setDoc(doc(db, 'users/u/sync_control/state'), { ...base, consentRevision: 2 }));
});

it('denies reads for malformed server consent records rather than treating them as active', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'health_consent_withdrawals/u'), { uid: 'u', status: 'malformed', revision: -1 });
    await setDoc(doc(context.firestore(), 'users/u'), { profile: { name: 'Retained' } });
  });
  const db = env.authenticatedContext('u', { email_verified: true }).firestore();
  await assertFails(getDoc(doc(db, 'users/u')));
});

it('rejects private shards, telemetry and replica-control reads during withdrawal', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'health_consent_withdrawals/u'), mark('withdrawn'));
    await setDoc(doc(context.firestore(), 'users/u'), { profile: { name: 'Retained' } });
  });
  const db = env.authenticatedContext('u', { email_verified: true }).firestore();
  for (const path of [
    'users/u/history_months/2026-09',
    'users/u/nutrition_months/2026-09',
    'users/u/sync_control/state',
    'users/u/telemetry_errors/one',
    'users/u/telemetry_events/one',
    'users/u/telemetry_anomalies/one',
  ]) await assertFails(getDoc(doc(db, path)));
});
