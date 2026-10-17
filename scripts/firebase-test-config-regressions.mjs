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
        const directiveSources = (csp, name) => {
          const part = csp.split(';').map(value => value.trim())
            .find(value => value.startsWith(name + ' '));
          assert.ok(part, `Missing ${name} CSP directive`);
          return part.split(/\s+/).slice(1);
        };
        const connect = directiveSources(derived.value, 'connect-src');
        const frames = directiveSources(derived.value, 'frame-src');
        const productionConnect = directiveSources(original.value, 'connect-src');
        assert.equal(connect.filter(token => token === 'https://thelogbook-test-backend-gnfcreator.vercel.app').length, 1);
        assert.equal(frames.filter(token => token === 'https://thelogbook-test.firebaseapp.com').length, 1);
        assert.equal(productionConnect.filter(token => token === 'https://logbook-gnf.vercel.app').length, 1);
        for (const tokens of [connect, frames]) {
          for (const token of tokens) {
            if (!token.startsWith('https://')) continue;
            const origin = new URL(token);
            assert.notEqual(origin.origin, 'https://logbook-gnf.vercel.app');
            assert.notEqual(origin.origin, 'https://logbook-db-98cc4.firebaseapp.com');
            assert.equal(origin.hostname === 'sentry.io' || origin.hostname.endsWith('.sentry.io'), false);
          }
        }
        assert.equal(derived.value.split(';').some(part => part.trim() === "default-src 'self'"), true);
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

void test('Test CSP rejects deceptive origin fragments, paths and changed Sentry collectors', () => {
  const csp = source.hosting.headers.find(route => route.source === '/**')
    .headers.find(header => header.key === 'Content-Security-Policy').value;
  const unexpected = [
    csp.replace('https://logbook-gnf.vercel.app', 'https://logbook-gnf.vercel.app.attacker.example'),
    csp.replace('https://logbook-db-98cc4.firebaseapp.com', 'https://logbook-db-98cc4.firebaseapp.com.attacker.example'),
    csp.replace('https://logbook-gnf.vercel.app', 'https://logbook-gnf.vercel.app/path'),
    csp.replace('https://o4512174476230656.ingest.de.sentry.io', 'https://another.ingest.de.sentry.io'),
    csp.replace('https://o4512174476230656.ingest.de.sentry.io', 'https://o4512174476230656.ingest.de.sentry.io.attacker.example'),
  ];
  for (const changedCsp of unexpected) {
    assert.notEqual(changedCsp, csp, 'Regression must actually change the CSP');
    const altered = structuredClone(source);
    altered.hosting.headers.find(route => route.source === '/**')
      .headers.find(header => header.key === 'Content-Security-Policy').value = changedCsp;
    assert.throws(() => testFirebaseConfig(altered, TEST_FIREBASE_PROJECT));
  }
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
