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

void test('rejects diagnostic secrets introduced in an action step outside the job env', () => {
  const altered = hosting.replace('      - name: Build exact production frontend',
    '      - name: Build exact production frontend\n        env:\n          ERROR_MONITOR_KEY: ${{ secrets.ERROR_MONITOR_KEY }}');
  assert.notEqual(altered, hosting);
  assert.match(checkProductionBuildSecrets(altered, firestore).join('; '), /unreviewed GitHub variable or secret binding/);
});

void test('rejects an unexpected Firebase deploy identity in either workflow', () => {
  const altered = hosting.replace('service_account: ${{ env.GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT }}', 'service_account: ${{ env.GCP_FIRESTORE_DEPLOY_SERVICE_ACCOUNT }}');
  assert.notEqual(altered, hosting);
  assert.match(checkProductionBuildSecrets(altered, firestore).join('; '), /Hosting: unexpected WIF/);
  const other = firestore.replace('service_account: ${{ env.GCP_FIRESTORE_DEPLOY_SERVICE_ACCOUNT }}', 'service_account: ${{ env.GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT }}');
  assert.notEqual(other, firestore);
  assert.match(checkProductionBuildSecrets(hosting, other).join('; '), /Firestore: unexpected WIF/);
});

void test('direct dependencies require explicit review before a new runtime or build SDK can be installed', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lockRoot = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages[''];
  const approvedRuntime = new Set([
    '@noble/ciphers', 'chart.js', 'date-fns', 'fast-deep-equal', 'firebase',
    'firebase-admin', 'fuse.js', 'idb-keyval', 'lucide-react', 'react',
    'react-chartjs-2', 'react-dom', 'zod', 'zustand',
  ]);
  const approvedDev = new Set([
    '@axe-core/playwright', '@babel/parser', '@firebase/rules-unit-testing',
    '@playwright/test', '@testing-library/dom', '@testing-library/react',
    '@types/react', '@types/react-dom', '@unplugin-pwa/core', '@unplugin-pwa/vite', '@vite-pwa/workbox-swkit', '@vitejs/plugin-react',
    '@vitest/coverage-v8', '@vitest/ui', 'fake-indexeddb', 'jsdom',
    'knip', 'oxlint', 'oxlint-tsgolint', 'rollup-plugin-visualizer',
    'sharp', 'typescript', 'vite', 'vitest',
  ]);
  for (const [group, approved] of [
    ['dependencies', approvedRuntime], ['devDependencies', approvedDev],
  ]) {
    const direct = manifest[group] ?? {};
    assert.deepEqual(Object.keys(direct).filter(name => !approved.has(name)), [],
      'Unreviewed direct ' + group + ' require an explicit allowlist change');
    const byName = ([a], [b]) => a.localeCompare(b);
    assert.deepEqual(Object.entries(lockRoot[group] ?? {}).sort(byName), Object.entries(direct).sort(byName),
      'Lockfile direct dependencies must match package.json');
    assert.deepEqual(Object.entries(direct).filter(([, spec]) => /^npm:/i.test(spec)), [],
      'Unreviewed dependency aliases are not permitted');
  }
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
  for (const source of [...clientSources('src'), ...clientSources('public')]) {
    assert.doesNotMatch(readFileSync(source, 'utf8'), forbidden, 'Unexpected diagnostic transport in ' + source);
  }
  // The bootstrap script runs before React and must never acquire a network transport.
  assert.match(readFileSync('index.html', 'utf8'), /appearance\.js/);
  assert.doesNotMatch(readFileSync('public/appearance.js', 'utf8'),
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(/,
    'The standalone appearance bootstrap must remain network-free');
  assert.doesNotMatch(readFileSync('firebase.json', 'utf8'), forbidden,
    'Firebase Hosting CSP must not allow external diagnostic ingestion');
});
