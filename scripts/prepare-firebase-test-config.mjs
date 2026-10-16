import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TEST_FIREBASE_PROJECT = 'thelogbook-test';
export const TEST_HOSTING_SITE = 'thelogbook-test';
const TEST_CONFIG_PATH = '.firebase.test.local.json';

export function testFirebaseConfig(source, projectId) {
  assert.equal(projectId, TEST_FIREBASE_PROJECT,
    'Refusing to prepare Firebase config for anything other than the dedicated Test project');
  assert.equal(source?.hosting?.site, 'thelogbook',
    'Expected the canonical Production Hosting site in the source config');
  assert.equal(source?.hosting?.public, 'dist');
  assert.equal(source?.firestore?.rules, 'firestore.rules');
  assert.equal(source?.firestore?.indexes, 'firestore.indexes.json');
  assert.deepEqual(source.hosting.rewrites, [{ source: '**', destination: '/index.html' }]);
  assert.equal(source.functions, undefined, 'Unexpected Firebase Functions config');
  return { ...source, hosting: { ...source.hosting, site: TEST_HOSTING_SITE } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const source = JSON.parse(readFileSync('firebase.json', 'utf8'));
  const config = testFirebaseConfig(source, process.argv[2]);
  writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { flag: 'w', mode: 0o600 });
  console.log('Prepared temporary Firebase Hosting / Firestore config for thelogbook-test only.');
}
