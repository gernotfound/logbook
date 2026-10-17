import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { testFirebaseConfig, TEST_FIREBASE_PROJECT, TEST_HOSTING_SITE } from './prepare-firebase-test-config.mjs';

const source = JSON.parse(readFileSync('firebase.json', 'utf8'));

void test('Test deployment preserves Firestore and routes while isolating Hosting site and CSP', () => {
  const result = testFirebaseConfig(source, TEST_FIREBASE_PROJECT);
  assert.equal(result.hosting.site, TEST_HOSTING_SITE);
  assert.equal(source.hosting.site, 'thelogbook');
  assert.deepEqual(result.firestore, source.firestore);
  const sourceHeaders = source.hosting.headers;
  const testHeaders = result.hosting.headers;
  assert.equal(testHeaders.length, sourceHeaders.length);
  for (let i = 0; i < sourceHeaders.length; i++) {
    assert.equal(testHeaders[i].source, sourceHeaders[i].source);
    assert.equal(testHeaders[i].headers.length, sourceHeaders[i].headers.length);
    for (let j = 0; j < sourceHeaders[i].headers.length; j++) {
      const original = sourceHeaders[i].headers[j];
      const derived = testHeaders[i].headers[j];
      assert.equal(derived.key, original.key);
      if (original.key !== 'Content-Security-Policy') {
        assert.deepEqual(derived, original);
      } else {
        assert.match(derived.value, /https:\/\/thelogbook-test-backend-gnfcreator\.vercel\.app/);
        assert.match(derived.value, /https:\/\/thelogbook-test\.firebaseapp\.com/);
        assert.doesNotMatch(derived.value, /logbook-gnf\.vercel\.app|logbook-db-98cc4\.firebaseapp\.com|\.sentry\.io/);
        assert.match(derived.value, /default-src 'self'/);
        assert.match(original.value, /https:\/\/logbook-gnf\.vercel\.app/);
      }
    }
  }
  assert.deepEqual(result.hosting.rewrites, source.hosting.rewrites);
  assert.equal(result.hosting.public, 'dist');
});

void test('Test deployment refuses all non-Test projects, including Production', () => {
  for (const project of ['logbook-db-98cc4', '', undefined, 'thelogbook-test-other']) {
    assert.throws(() => testFirebaseConfig(source, project));
  }
});

void test('Test deployment refuses unexpected changes to canonical routing or site', () => {
  assert.throws(() => testFirebaseConfig({
    ...source, hosting: { ...source.hosting, site: TEST_HOSTING_SITE },
  }, TEST_FIREBASE_PROJECT));
  assert.throws(() => testFirebaseConfig({
    ...source, hosting: { ...source.hosting, rewrites: [{ source: '**', destination: 'https://thelogbook.web.app' }] },
  }, TEST_FIREBASE_PROJECT));
  assert.throws(() => testFirebaseConfig({
    ...source, functions: { source: 'functions' },
  }, TEST_FIREBASE_PROJECT));
});

void test('Test CSP fails closed if Production backend/Auth mapping drifts or is duplicated', () => {
  const csp = source.hosting.headers.find(route => route.source === '/**')
    .headers.find(header => header.key === 'Content-Security-Policy').value;
  for (const changedCsp of [
    csp.replace('https://logbook-gnf.vercel.app', 'https://unexpected.example'),
    csp.replace('https://logbook-db-98cc4.firebaseapp.com', 'https://unexpected.example'),
    csp.replace(/connect-src[^;]+;/, ''),
  ]) {
    const altered = structuredClone(source);
    altered.hosting.headers.find(route => route.source === '/**')
      .headers.find(header => header.key === 'Content-Security-Policy').value = changedCsp;
    assert.throws(() => testFirebaseConfig(altered, TEST_FIREBASE_PROJECT));
  }
  const duplicate = structuredClone(source);
  const globalHeaders = duplicate.hosting.headers.find(route => route.source === '/**').headers;
  globalHeaders.push({ key: 'Content-Security-Policy', value: csp });
  assert.throws(() => testFirebaseConfig(duplicate, TEST_FIREBASE_PROJECT));
});

import { checkFirebaseTestFrontendEnv } from './check-firebase-test-frontend-env.mjs';

const validFrontend = {
  VITE_FIREBASE_PROJECT_ID: 'thelogbook-test',
  VITE_FIREBASE_APP_ID: '1:1016481853013:web:1dbfcc122026dc757baedc',
  VITE_FIREBASE_AUTH_DOMAIN: 'thelogbook-test.web.app',
  VITE_FIREBASE_API_KEY: 'AIza' + 'A'.repeat(34),
  VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'A'.repeat(39),
  VITE_ACCOUNT_DELETION_API_ORIGIN: 'https://thelogbook-test-backend-gnfcreator.vercel.app',
};

void test('Test frontend config accepts complete, isolated Test-only settings', () => {
  assert.doesNotThrow(() => checkFirebaseTestFrontendEnv(validFrontend));
});

void test('Test frontend config refuses missing App Check and cross-environment endpoints', () => {
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
    assert.throws(() => checkFirebaseTestFrontendEnv({ ...validFrontend, ...changed }));
  }
});
