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
  assert.match(checkProductionBuildSecrets(altered, firestore).join('; '), /unreviewed job-level env binding/);
});

void test('rejects an unreviewed browser diagnostic DSN', () => {
  const altered = hosting.replace('      FIREBASE_HOSTING_DEPLOY:',
    '      VITE_DIAGNOSTIC_DSN: ${{ vars.VITE_DIAGNOSTIC_DSN }}\n      FIREBASE_HOSTING_DEPLOY:');
  assert.notEqual(altered, hosting);
  assert.match(checkProductionBuildSecrets(altered, firestore).join('; '), /unreviewed job-level env binding/);
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

void test('rejects missing Firestore production project pin before provider authentication', () => {
  const changed = firestore.replace(
    'if [ "${FIREBASE_PROJECT_ID}" != "logbook-db-98cc4" ]; then',
    'if [ "${FIREBASE_PROJECT_ID}" != "another-project" ]; then',
  );
  assert.notEqual(changed, firestore);
  assert.match(checkProductionBuildSecrets(hosting, changed).join('; '), /production project/);
});

void test('rejects a stale-main guard removed from either Firestore mutation step', () => {
  const steps = [
    ['Retire explicitly removed Firestore single-field indexes', 'Deploy Firestore Rules and indexes'],
    ['Deploy Firestore Rules and indexes', 'Verify live Firestore Rules and indexes'],
  ];
  for (const [name, next] of steps) {
    const start = firestore.indexOf('      - name: ' + name);
    const end = firestore.indexOf('      - name: ' + next, start);
    assert.ok(start >= 0 && end > start);
    const section = firestore.slice(start, end);
    const damaged = section.replace('git ls-remote --exit-code origin refs/heads/main', 'echo unverified-main');
    assert.notEqual(section, damaged);
    const changed = firestore.slice(0, start) + damaged + firestore.slice(end);
    assert.match(checkProductionBuildSecrets(hosting, changed).join('; '), /recheck exact main SHA/);
  }
});

void test('direct dependencies require explicit review before a new runtime or build SDK can be installed', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lockRoot = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages[''];
  const approvedRuntime = new Set([
    '@noble/ciphers', 'chart.js', 'date-fns', 'fast-deep-equal', 'firebase',
    // JOSE 5.10.0 is the reviewed, locked runtime JWT/JWKS verifier for Kinde; no install hook.
    'firebase-admin', 'fuse.js', 'idb-keyval', 'jose', 'lucide-react', 'react',
    'react-chartjs-2', 'react-dom', 'zod', 'zustand',
  ]);
  const approvedDev = new Set([
    '@axe-core/playwright', '@babel/parser', '@firebase/rules-unit-testing',
    '@playwright/test', '@stryker-mutator/core', '@stryker-mutator/vitest-runner', '@testing-library/dom', '@testing-library/react',
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

void test('mutation tooling remains exactly pinned, dev-only and lockfile-matched', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const packages = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages;
  for (const name of ['@stryker-mutator/core', '@stryker-mutator/vitest-runner']) {
    assert.equal(manifest.devDependencies?.[name], '10.1.1');
    assert.equal(packages['']?.devDependencies?.[name], '10.1.1');
    assert.equal(packages['node_modules/' + name]?.version, '10.1.1');
    assert.equal(manifest.dependencies?.[name], undefined);
  }
});


void test('hosting revalidates live main after the build and immediately before deploy', () => {
  const build = hosting.indexOf('      - name: Build exact production frontend');
  const fence = hosting.indexOf('      - name: Recheck exact main SHA before Hosting deployment');
  const deploy = hosting.indexOf('      - name: Deploy Firebase Hosting only');
  assert.ok(build >= 0 && fence > build && deploy > fence, 'Expected post-build SHA fence immediately before deploy');
  const preDeploy = hosting.slice(fence, deploy);
  assert.match(preDeploy, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.match(preDeploy, /git rev-parse HEAD/);
  assert.ok(preDeploy.includes('[ "${current_main}" != "${EXPECTED_SHA}" ]'), 'Must compare freshly read main with exact expected SHA');
  assert.match(preDeploy, /exit 1/);
});

void test('hosting post-deploy asset probes avoid find|head SIGPIPE under pipefail', () => {
  const smoke = hosting.slice(hosting.indexOf('      - name: Verify public Hosting PWA cache policy'));
  assert.doesNotMatch(smoke, /\|\s*head\s+-n\s+1/);
  assert.match(smoke, /workbox_file="\$\(find dist[^\n]*-quit\)"/);
  assert.match(smoke, /build_assets=\(dist\/assets\/\*\*\/\*\.\{js,css\}\)/);
  assert.match(smoke, /if \[ "\$\{#build_assets\[@\]\}" -eq 0 \]/);
});


void test('rejects an unreviewed artifact downloader version in the privileged deploy job', () => {
  const altered = hosting.replace(
    'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333',
    'actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131',
  );
  assert.notEqual(altered, hosting);
  assert.match(checkProductionBuildSecrets(altered, firestore).join('; '), /artifact handoff/);
});

void test('Hosting build remains unprivileged and hands an exact SHA artifact to its deploy job', () => {
  assert.deepEqual(checkProductionBuildSecrets(hosting, firestore), []);
  for (const [replacement, finding] of [
    [hosting.replace('    name: Build verified main frontend', '    name: Build verified main frontend\n    permissions:\n      id-token: write'),
      /build can access cloud identity/],
    [hosting.replace('    needs: build', '    needs: none'), /artifact handoff/],
    [hosting.replace('      - name: Download same-run verified frontend', '      - name: Download discarded frontend'), /credentials or exact main SHA guard out of order/],
  ]) {
    assert.notEqual(replacement, hosting);
    assert.match(checkProductionBuildSecrets(replacement, firestore).join('; '), finding);
  }
});

void test('Hosting rejects additional privileged or unreviewed workflow jobs', () => {
  const thirdJob = hosting + [
    '  diagnostic-deploy:',
    '    runs-on: ubuntu-24.04',
    '    permissions:',
    '      id-token: write',
    '    steps:',
    '      - run: echo bypass',
    '',
  ].join('\n');
  assert.match(checkProductionBuildSecrets(thirdJob, firestore).join('; '),
    /unexpected job outside the reviewed build\/deploy boundary/);
});

void test('Hosting independently requires the exact successful-main upstream gate on both jobs', () => {
  assert.deepEqual(checkProductionBuildSecrets(hosting, firestore), []);
  const deployOffset = hosting.indexOf('\n  deploy:\n');
  assert.ok(deployOffset > 0);
  const build = hosting.slice(0, deployOffset);
  const deploy = hosting.slice(deployOffset);
  const originalCondition = "github.event.workflow_run.head_branch == 'main'";
  for (const [jobName, altered] of [
    ['build', build.replace(originalCondition, "github.event.workflow_run.head_branch == 'release'") + deploy],
    ['deploy', build + deploy.replace(originalCondition, "github.event.workflow_run.head_branch == 'release'")],
    ['deploy', build + deploy.replace(originalCondition, originalCondition + ' || true')],
  ]) {
    assert.notEqual(altered, hosting);
    assert.match(checkProductionBuildSecrets(altered, firestore).join('; '),
      new RegExp('Hosting: ' + jobName + ' must require a successful upstream'));
  }
});

void test('Hosting rejects unreviewed environment bindings in either job', () => {
  const rogueDeployEnv = hosting.replace('      GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT: ${{ vars.GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT }}',
    '      GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT: ${{ vars.GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT }}\n      UNREVIEWED_DEPLOY_FLAG: 1');
  assert.notEqual(rogueDeployEnv, hosting);
  assert.match(checkProductionBuildSecrets(rogueDeployEnv, firestore).join('; '), /deploy contains an unreviewed/);

  const rogueBuildEnv = hosting.replace('      FIREBASE_HOSTING_DEPLOY: production',
    '      FIREBASE_HOSTING_DEPLOY: production\n      UNREVIEWED_BUILD_FLAG: 1');
  assert.notEqual(rogueBuildEnv, hosting);
  assert.match(checkProductionBuildSecrets(rogueBuildEnv, firestore).join('; '), /build contains an unreviewed/);
});

void test('Hosting smoke verifies served bytes and browser MIME for critical PWA resources', () => {
  const smoke = hosting.slice(hosting.indexOf('      - name: Verify public Hosting PWA cache policy'));
  assert.ok(smoke.includes('assert_served_bytes "/" "dist/index.html" html'));
  assert.ok(smoke.includes('assert_served_bytes "/sw.js" "dist/sw.js" js'));
  assert.ok(smoke.includes('assert_served_bytes "/manifest.webmanifest" "dist/manifest.webmanifest" json'));
  assert.ok(smoke.includes('assert_served_bytes "/appearance.js" "dist/appearance.js" js'));
  assert.ok(smoke.includes('assert_served_bytes "/appearance.css" "dist/appearance.css" css'));
  assert.ok(smoke.includes('assert_served_bytes "/$workbox_file" "dist/$workbox_file" js'));
  assert.ok(smoke.includes('for asset in "${build_assets[@]}"; do'));
  assert.ok(smoke.includes('relative_path="${asset#dist/}"'));
  assert.ok(smoke.includes('assert_served_bytes "/${relative_path}" "${asset}" "${asset##*.}"'));
  assert.ok(smoke.includes('fetch_headers "/${relative_path}" /tmp/thelogbook-asset-headers.txt'));
  assert.match(smoke, /cache-control: .*max-age=31536000.*immutable/);
  assert.match(smoke, /x-content-type-options: nosniff/);
  assert.match(smoke, /content-security-policy:/);
  assert.match(smoke, /cmp -s/);
  assert.match(smoke, /Accept-Encoding: identity/);
  assert.match(smoke, /content_type/);
  assert.ok(smoke.includes('if [ "${attempt}" -lt 5 ]; then sleep 2; fi'));
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
