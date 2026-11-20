import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { validateIsolatedWorkers, validateIsolatedKindeCandidate } from '../../scripts/check-cloudflare-api-isolation.mjs';

const api = JSON.parse(readFileSync('cloudflare/api/wrangler.isolated.jsonc', 'utf8'));
const gate = JSON.parse(readFileSync('cloudflare/auth/wrangler.isolated.jsonc', 'utf8'));
const validate = (a, g) => validateIsolatedWorkers(a, g);

void test('isolated Workers share the EU D1 and gate via private service binding', () => {
  assert.deepEqual(validate(api, gate), []);
});
void test('rejects accidental Worker public exposure', () => {
  for (const change of [
    { workers_dev: true }, { preview_urls: true },
    { routes: [{ pattern: 'thelogbook.me/api/*' }] },
    { assets: { directory: '../dist' } },
  ]) assert.notDeepEqual(validate({ ...api, ...change }, gate), []);
});
void test('rejects database substitutions and missing private authorization', () => {
  assert.notDeepEqual(validate({ ...api, d1_databases: [{ ...api.d1_databases[0], database_id: 'different' }] }, gate), []);
  assert.notDeepEqual(validate({ ...api, services: [] }, gate), []);
  assert.notDeepEqual(validate(api, { ...gate, d1_databases: [] }), []);
  for (const altered of [
    api.d1_databases.slice(0, 1),
    [{ ...api.d1_databases[0] }, { ...api.d1_databases[1], database_id: 'untrusted' }],
    [{ ...api.d1_databases[0] }, { ...api.d1_databases[1], database_id: api.d1_databases[0].database_id }],
    [{ ...api.d1_databases[0] }, { ...api.d1_databases[1], binding: 'DB' }],
  ]) assert.notDeepEqual(validate({ ...api, d1_databases: altered }, gate), []);

});
void test('rejects missing rate limiter, origin changes and injected vars', () => {
  assert.notDeepEqual(validate(api, { ...gate, ratelimits: [] }), []);
  assert.notDeepEqual(validate({ ...api, vars: { ...api.vars, API_ORIGIN: 'https://candidate.invalid' } }, gate), []);
  assert.notDeepEqual(validate({ ...api, vars: { ...api.vars, EXTRA_SECRET: 'bad' } }, gate), []);
});

const kinde = JSON.parse(readFileSync('cloudflare/auth/wrangler.kinde.isolated.jsonc', 'utf8'));
const frontend = JSON.parse(readFileSync('cloudflare/wrangler.jsonc', 'utf8'));

void test('pre-activation Kinde Worker shares only the isolated EU D1 and private Auth Gate', () => {
  assert.deepEqual(validateIsolatedKindeCandidate(kinde, gate, frontend), []);
});
void test('pre-activation Kinde rejects public routes, wrong storage, no rate limiter or checked-in secrets', () => {
  for (const wrong of [
    { ...kinde, workers_dev: true },
    { ...kinde, preview_urls: true },
    { ...kinde, routes: [{ pattern: 'thelogbook.me/api/*' }] },
    { ...kinde, assets: { directory: '../dist' } },
    { ...kinde, services: [] },
    { ...kinde, d1_databases: [{ ...kinde.d1_databases[0], database_id: 'wrong' }] },
    { ...kinde, ratelimits: [] },
    { ...kinde, vars: { APP_ORIGIN: 'https://wrong.example' } },
    { ...kinde, vars: { ...kinde.vars, KINDE_CLIENT_SECRET: 'synthetic-do-not-use' } },
    { ...kinde, observability: { enabled: true } },
  ]) assert.notDeepEqual(validateIsolatedKindeCandidate(wrong, gate, frontend), []);
  assert.notDeepEqual(validateIsolatedKindeCandidate(kinde, { ...gate, name: 'wrong-gate' }, frontend), []);
  assert.notDeepEqual(validateIsolatedKindeCandidate(kinde, gate, {
    ...frontend, assets: { ...frontend.assets, run_worker_first: ['/__/auth', '/__/auth/*', '/api/auth/*'] },
  }), []);
});

void test('OAuth-only frontend rejects extra D1 routes and unapproved service or secret bindings', () => {
  for (const wrong of [
    { ...frontend, services: [] },
    { ...frontend, services: [{ binding: 'KINDE_HTTP', service: 'untrusted' }] },
    { ...frontend, services: [...frontend.services, { binding: 'D1_API', service: 'thelogbook-api-isolated' }] },
    { ...frontend, vars: { ...frontend.vars, KINDE_CLIENT_SECRET: 'forbidden' } },
    { ...frontend, assets: { ...frontend.assets, run_worker_first: [
      ...frontend.assets.run_worker_first, '/v1/consent/*',
    ] } },
    { ...frontend, assets: { ...frontend.assets, run_worker_first: [
      '/__/auth', '/__/auth/*', '/api/auth/*',
    ] } },
  ]) {
    assert.notDeepEqual(validateIsolatedKindeCandidate(kinde, gate, wrong), []);
  }
});


function watchedPrivatePushPaths(workflow) {
  const text = readFileSync(workflow, 'utf8');
  assert.match(text, /^on:\r?\n  push:\r?\n/m);
  const block = text.match(/^    paths:\r?\n((?:      - [^\r\n]+\r?\n)+)/m);
  assert.ok(block, workflow + ': missing push.paths');
  return [...block[1].matchAll(/^      - (.+)$/gm)]
    .map(([, value]) => value.trim().replace(/^(['"])(.*)\1$/, '$2'));
}

function importedPrivateSources(entry) {
  const pending = [resolve(entry)];
  const visited = new Set();
  while (pending.length) {
    const absolute = pending.pop();
    const path = relative('.', absolute).replaceAll('\\', '/');
    assert.ok(path && !path.startsWith('../') && !isAbsolute(path), 'external import: ' + path);
    if (visited.has(path)) continue;
    visited.add(path);
    const source = readFileSync(absolute, 'utf8');
    for (const match of source.matchAll(/\b(?:from|import)\s*(?:\(\s*)?['"](\.{1,2}\/[^'"]+\.mjs)['"]/g)) {
      pending.push(resolve(dirname(absolute), match[1]));
    }
  }
  return [...visited].sort();
}

function missingPrivateSources(paths, sources) {
  return sources.filter(file => !paths.some(pattern =>
    pattern.endsWith('/**') ? file.startsWith(pattern.slice(0, -3) + '/') : file === pattern));
}

void test('private main-only deployments cover every local module in their static import closure', () => {
  const apiPaths = watchedPrivatePushPaths('.github/workflows/cloudflare-api-isolated.yml');
  const kindePaths = watchedPrivatePushPaths('.github/workflows/cloudflare-kinde-private.yml');
  const apiSources = [...new Set([
    ...importedPrivateSources('cloudflare/api/worker.mjs'),
    ...importedPrivateSources('cloudflare/auth/session-gate.mjs'),
    ...importedPrivateSources('cloudflare/auth/kinde-http-worker.mjs'),
  ])].sort();
  const kindeSources = importedPrivateSources('cloudflare/auth/kinde-http-worker.mjs');
  assert.deepEqual(missingPrivateSources(apiPaths, apiSources), []);
  assert.deepEqual(missingPrivateSources(kindePaths, kindeSources), []);

  // A missing trigger for a transitive dependency must fail this test even
  // when the entrypoint itself remains covered by its own workflow path.
  for (const [pattern, source] of [
    ['cloudflare/recovery/**', 'cloudflare/recovery/runtime-sync-fence.mjs'],
    ['cloudflare/sql/**', 'cloudflare/sql/d1-time.mjs'],
    ['cloudflare/http/**', 'cloudflare/http/strict-empty-post.mjs'],
  ]) {
    assert.ok(apiSources.includes(source), source + ': no longer reached by private API');
    assert.ok(missingPrivateSources(apiPaths.filter(path => path !== pattern), apiSources).includes(source));
  }
  assert.ok(kindeSources.includes('cloudflare/http/strict-empty-post.mjs'));
  assert.ok(missingPrivateSources(
    kindePaths.filter(path => path !== 'cloudflare/http/**'), kindeSources,
  ).includes('cloudflare/http/strict-empty-post.mjs'));
});

void test('private Worker deployments also observe package metadata and their provider preflight scripts', () => {
  const apiPaths = watchedPrivatePushPaths('.github/workflows/cloudflare-api-isolated.yml');
  const kindePaths = watchedPrivatePushPaths('.github/workflows/cloudflare-kinde-private.yml');
  for (const paths of [apiPaths, kindePaths]) {
    for (const file of ['package.json', 'package-lock.json', 'scripts/cloudflare-private-deploy-plan.mjs',
      'scripts/check-cloudflare-api-isolation.mjs', 'scripts/check-install-scripts.mjs']) {
      assert.ok(paths.includes(file), file);
    }
  }
  assert.ok(apiPaths.includes('scripts/verify-cloudflare-api-provider.mjs'));
  assert.ok(kindePaths.includes('scripts/verify-cloudflare-kinde-private-provider.mjs'));
});

void test('version-only releases skip private redeploy, but dependency or imported-code changes do not', async () => {
  const { mustDeployPrivateWorker, readPrivatePushPaths } = await import('../../scripts/cloudflare-private-deploy-plan.mjs');
  const paths = readPrivatePushPaths(readFileSync('.github/workflows/cloudflare-api-isolated.yml', 'utf8'));
  const previousPackage = { version: '1.0.0', dependencies: { jose: '5.0.0' } };
  const currentPackage = { ...previousPackage, version: '1.1.0' };
  const previousLock = { version: '1.0.0', packages: { '': { version: '1.0.0' }, 'node_modules/jose': { version: '5.0.0' } } };
  const currentLock = { ...previousLock, version: '1.1.0', packages: { ...previousLock.packages, '': { version: '1.1.0' } } };
  const base = { changed: ['package.json', 'package-lock.json', 'src/components/Home/Unrelated.tsx'], paths,
    previousPackage, currentPackage, previousLock, currentLock };
  assert.equal(mustDeployPrivateWorker(base), false);
  for (const file of ['cloudflare/api/worker.mjs', 'cloudflare/recovery/runtime-sync-fence.mjs',
    'scripts/verify-cloudflare-api-provider.mjs']) {
    assert.equal(mustDeployPrivateWorker({ ...base, changed: [...base.changed, file] }), true);
  }
  assert.equal(mustDeployPrivateWorker({ ...base, currentPackage: {
    ...currentPackage, dependencies: { jose: '6.0.0' } } }), true);
  assert.equal(mustDeployPrivateWorker({ ...base, currentLock: {
    ...currentLock, packages: { ...currentLock.packages, 'node_modules/jose': { version: '6.0.0' } } } }), true);
  assert.equal(mustDeployPrivateWorker({ ...base, previousLock: null }), true);
  assert.equal(mustDeployPrivateWorker({ ...base, changed: [] }), true);
});

void test('private Workers wait boundedly for the actual exact-main gate and stop on terminal failure', () => {
  for (const file of [
    '.github/workflows/cloudflare-api-isolated.yml',
    '.github/workflows/cloudflare-kinde-private.yml',
  ]) {
    const workflow = readFileSync(file, 'utf8');
    assert.match(workflow, /for attempt in \$\(seq 1 40\); do/);
    assert.match(workflow, /head_sha=\$\{EXPECTED_SHA\}/);
    assert.match(workflow, /case "\$\{gate\}" in/);
    assert.match(workflow, /failure\|cancelled\|timed_out\|action_required\) .*exit 1/);
    assert.match(workflow, /test "\$\{verified\}" = true/);
    assert.match(workflow, /if \[ "\$\{attempt\}" != 40 \]; then sleep 15; fi/);
    assert.doesNotMatch(workflow, /for attempt in 1 2 3 4 5 6 7 8 9 10 11 12;/);
  }
});
