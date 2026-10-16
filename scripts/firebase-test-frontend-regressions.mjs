import assert from 'node:assert/strict';
import test from 'node:test';
import { checkFirebaseTestFrontendEnv } from './check-firebase-test-frontend-env.mjs';

const valid = {
  VITE_FIREBASE_PROJECT_ID: 'thelogbook-test',
  VITE_FIREBASE_APP_ID: '1:1016481853013:web:1dbfcc122026dc757baedc',
  VITE_FIREBASE_AUTH_DOMAIN: 'thelogbook-test.web.app',
  VITE_FIREBASE_API_KEY: 'AIza' + 'A'.repeat(34),
  VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'A'.repeat(39),
  VITE_ACCOUNT_DELETION_API_ORIGIN: 'https://thelogbook-test-backend-gnfcreator.vercel.app',
};

test('Test frontend config accepts complete, isolated Test-only settings', () => {
  assert.doesNotThrow(() => checkFirebaseTestFrontendEnv(valid));
});

test('Test frontend config refuses missing App Check and cross-environment endpoints', () => {
  const unsafe = [
    { VITE_FIREBASE_PROJECT_ID: 'logbook-db-98cc4' },
    { VITE_FIREBASE_APP_ID: '1:9999:web:other' },
    { VITE_FIREBASE_AUTH_DOMAIN: 'thelogbook.web.app' },
    { VITE_FIREBASE_API_KEY: 'your_api_key_here' },
    { VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: '' },
    { VITE_ACCOUNT_DELETION_API_ORIGIN: 'https://logbook-gnf.vercel.app' },
    { VITE_SENTRY_DSN: 'https://fake@errors.example/1' },
    { FIREBASE_HOSTING_DEPLOY: 'production' },
  ];
  for (const changed of unsafe) {
    assert.throws(() => checkFirebaseTestFrontendEnv({ ...valid, ...changed }));
  }
});
