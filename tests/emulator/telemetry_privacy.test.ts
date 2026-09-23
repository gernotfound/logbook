import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

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

beforeEach(() => env.clearFirestore());
afterAll(async () => { await env?.cleanup(); });

const baseEvent = {
  timestamp: 1000,
  type: 'workout_started',
  context: {
    appVersion: '1.1.0',
    platform: 'other',
    displayMode: 'browser',
    online: true,
  },
  userId: 'a',
  sessionId: 'session-a',
};

it('allows technical workout metadata but rejects user-authored routine names', async () => {
  const db = env.authenticatedContext('a').firestore();
  const expireAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));

  await assertSucceeds(setDoc(doc(db, 'users/a/telemetry_events/technical'), {
    ...baseEvent,
    expireAt,
    details: { offline: false, routineId: 'routine-1' },
  }));

  await assertFails(setDoc(doc(db, 'users/a/telemetry_events/business-label'), {
    ...baseEvent,
    expireAt,
    details: {
      offline: false,
      routineId: 'routine-1',
      routineName: 'Riabilitazione ginocchio',
    },
  }));
});
