import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkProductionBuildSecrets } from './check-production-build-secrets.mjs';

const hosting = readFileSync('.github/workflows/firebase-hosting-production.yml', 'utf8');
const firestore = readFileSync('.github/workflows/firebase-firestore-production.yml', 'utf8');

void test('hosting and firestore use independent WIF identities with no external error monitoring', () => {
  assert.deepEqual(checkProductionBuildSecrets(hosting, firestore), []);
});

void test('rejects an unreviewed diagnostic credential in the production build', () => {
  const altered = hosting.replace('      FIREBASE_HOSTING_DEPLOY:',
    '      ERROR_MONITOR_AUTH_TOKEN: ${{ secrets.ERROR_MONITOR_AUTH_TOKEN }}\n      FIREBASE_HOSTING_DEPLOY:');
  assert.notEqual(altered, hosting);
  assert.match(checkProductionBuildSecrets(altered, firestore).join('; '), /external error monitoring/);
});

void test('rejects an unreviewed browser diagnostic DSN', () => {
  const altered = hosting.replace('      FIREBASE_HOSTING_DEPLOY:',
    '      VITE_DIAGNOSTIC_DSN: ${{ vars.VITE_DIAGNOSTIC_DSN }}\n      FIREBASE_HOSTING_DEPLOY:');
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
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) yield* clientSources(path);
    else if (entry.isFile() && /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/.test(entry.name)) yield path;
  }
}

void test('client and production CSP do not contain diagnostic transport markers', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const diagnosticPackage = /(?:error[-_]?monitor|exception[-_]?track|crash[-_]?report|session[-_]?replay)/i;
  for (const packages of [
    manifest.dependencies ?? {}, manifest.devDependencies ?? {},
  ]) {
    assert.deepEqual(Object.keys(packages).filter(name => diagnosticPackage.test(name)), []);
  }
  assert.deepEqual(Object.keys(lock.packages).filter(name => diagnosticPackage.test(name)), []);

  const forbidden = /\b(?:VITE_[A-Z0-9_]*(?:_DSN|_MONITOR_[A-Z0-9_]+)|captureException\s*\(|sendDiagnosticReport\s*\()|(?:ingest|envelope)\.error-monitor\./i;
  for (const source of clientSources('src')) {
    assert.doesNotMatch(readFileSync(source, 'utf8'), forbidden, 'Unexpected diagnostic transport in ' + source);
  }
  assert.doesNotMatch(readFileSync('firebase.json', 'utf8'), forbidden,
    'Firebase Hosting CSP must not allow external diagnostic ingestion');
});
