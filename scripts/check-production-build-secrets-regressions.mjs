import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkProductionBuildSecrets } from './check-production-build-secrets.mjs';

const hosting = readFileSync('.github/workflows/firebase-hosting-production.yml', 'utf8');
const firestore = readFileSync('.github/workflows/firebase-firestore-production.yml', 'utf8');

void test('hosting and firestore use independent WIF identities with no external error monitoring', () => {
  assert.deepEqual(checkProductionBuildSecrets(hosting, firestore), []);
});

void test('rejects the reintroduction of an external error-monitoring credential', () => {
  const altered = hosting.replace('      FIREBASE_HOSTING_DEPLOY:', '      SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}\n      FIREBASE_HOSTING_DEPLOY:');
  assert.notEqual(altered, hosting);
  assert.match(checkProductionBuildSecrets(altered, firestore).join('; '), /external error monitoring/);
});

void test('rejects the reintroduction of the browser Sentry DSN', () => {
  const altered = hosting.replace('      FIREBASE_HOSTING_DEPLOY:', '      VITE_SENTRY_DSN: ${{ vars.VITE_SENTRY_DSN }}\n      FIREBASE_HOSTING_DEPLOY:');
  assert.notEqual(altered, hosting);
  assert.match(checkProductionBuildSecrets(altered, firestore).join('; '), /external error monitoring/);
});

void test('rejects an unexpected Firebase deploy identity in either workflow', () => {
  const altered = hosting.replace('service_account: ${{ env.GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT }}', 'service_account: ${{ env.GCP_FIRESTORE_DEPLOY_SERVICE_ACCOUNT }}');
  assert.notEqual(altered, hosting);
  assert.match(checkProductionBuildSecrets(altered, firestore).join('; '), /Hosting: unexpected WIF/);
  const other = firestore.replace('service_account: ${{ env.GCP_FIRESTORE_DEPLOY_SERVICE_ACCOUNT }}', 'service_account: ${{ env.GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT }}');
  assert.notEqual(other, firestore);
  assert.match(checkProductionBuildSecrets(hosting, other).join('; '), /Firestore: unexpected WIF/);
});

function* clientSources(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) yield* clientSources(path);
    else if (entry.isFile() && /\\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/.test(entry.name)) yield path;
  }
}

void test('client and production CSP cannot silently restore an external Sentry transport', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

  for (const [type, packages] of Object.entries({
    dependencies: manifest.dependencies ?? {},
    devDependencies: manifest.devDependencies ?? {},
  })) {
    assert.deepEqual(Object.keys(packages).filter(name => /sentry/i.test(name)), [], `Unexpected ${type} Sentry packages`);
  }
  assert.deepEqual(Object.keys(lock.packages).filter(name => /(?:^|\\/)node_modules\\/@sentry\\//i.test(name)), [],
    'No Sentry packages should remain in the npm lockfile');

  const forbidden = /\\bSentry\\b|@sentry\\/|sentry\\.io|VITE_SENTRY_/i;
  for (const source of clientSources('src')) {
    assert.doesNotMatch(readFileSync(source, 'utf8'), forbidden, `External diagnostic integration in ${source}`);
  }
  assert.doesNotMatch(readFileSync('firebase.json', 'utf8'), forbidden,
    'Firebase Hosting CSP must not allow Sentry ingestion');
});
