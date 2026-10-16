import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const TEST_VALUES = {
  VITE_FIREBASE_PROJECT_ID: 'thelogbook-test',
  VITE_FIREBASE_APP_ID: '1:1016481853013:web:1dbfcc122026dc757baedc',
  VITE_FIREBASE_AUTH_DOMAIN: 'thelogbook-test.web.app',
  VITE_ACCOUNT_DELETION_API_ORIGIN: 'https://thelogbook-test-backend-gnfcreator.vercel.app',
};

export function checkFirebaseTestFrontendEnv(env) {
  for (const [key, expected] of Object.entries(TEST_VALUES)) {
    assert.equal(env[key], expected, `Unsafe Firebase Test frontend setting: ${key}`);
  }
  assert.match(env.VITE_FIREBASE_API_KEY ?? '', /^AIza[A-Za-z0-9_-]{25,}$/,
    'Firebase Test Web API key is required');
  assert.match(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY ?? '', /^[A-Za-z0-9_-]{25,}$/,
    'Firebase Test reCAPTCHA Enterprise site key is required (not a secret key)');
  assert.equal(env.VITE_SENTRY_DSN || '', '', 'Test must not forward errors to Production Sentry');
  assert.notEqual(env.FIREBASE_HOSTING_DEPLOY, 'production',
    'Test must not execute the Production Hosting/Sentry deployment mode');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  checkFirebaseTestFrontendEnv(process.env);
  console.log('Firebase Test frontend environment is isolated from Production.');
}
