import { readFileSync } from 'node:fs';
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

void test('rejects an unexpected Firebase deploy identity in either workflow', () => {
  const altered = hosting.replace('service_account: ${{ env.GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT }}', 'service_account: ${{ env.GCP_FIRESTORE_DEPLOY_SERVICE_ACCOUNT }}');
  assert.notEqual(altered, hosting);
  assert.match(checkProductionBuildSecrets(altered, firestore).join('; '), /Hosting: unexpected WIF/);
  const other = firestore.replace('service_account: ${{ env.GCP_FIRESTORE_DEPLOY_SERVICE_ACCOUNT }}', 'service_account: ${{ env.GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT }}');
  assert.notEqual(other, firestore);
  assert.match(checkProductionBuildSecrets(hosting, other).join('; '), /Firestore: unexpected WIF/);
});
