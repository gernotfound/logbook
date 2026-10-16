import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { testFirebaseConfig, TEST_FIREBASE_PROJECT, TEST_HOSTING_SITE } from './prepare-firebase-test-config.mjs';

const source = JSON.parse(readFileSync('firebase.json', 'utf8'));

test('Test deployment keeps all canonical rules and hosting behavior but replaces the site', () => {
  const result = testFirebaseConfig(source, TEST_FIREBASE_PROJECT);
  assert.equal(result.hosting.site, TEST_HOSTING_SITE);
  assert.equal(source.hosting.site, 'thelogbook');
  assert.deepEqual(result.firestore, source.firestore);
  assert.deepEqual(result.hosting.headers, source.hosting.headers);
  assert.deepEqual(result.hosting.rewrites, source.hosting.rewrites);
  assert.equal(result.hosting.public, 'dist');
});

test('Test deployment refuses all non-Test projects, including Production', () => {
  for (const project of ['logbook-db-98cc4', '', undefined, 'thelogbook-test-other']) {
    assert.throws(() => testFirebaseConfig(source, project));
  }
});

test('Test deployment refuses unexpected changes to canonical routing or site', () => {
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
