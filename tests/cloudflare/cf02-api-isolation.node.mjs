import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { validateIsolatedWorkers, validateIsolatedKindeCandidate } from '../../scripts/check-cloudflare-api-isolation.mjs';
import { privateDeploymentPaths, mustDeployPrivateWorker, planFromGit, planVerifiedPrivateRelease } from '../../scripts/cloudflare-private-deploy-plan.mjs';

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
  const apiPaths = privateDeploymentPaths('.github/workflows/cloudflare-api-isolated.yml');
  const kindePaths = privateDeploymentPaths('.github/workflows/cloudflare-kinde-private.yml');
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
    ['cloudflare/api-route-policy.mjs', 'cloudflare/api-route-policy.mjs'],
    ['cloudflare/recovery/**', 'cloudflare/recovery/runtime-sync-fence.mjs'],
    ['cloudflare/sql/**', 'cloudflare/sql/d1-time.mjs'],
    ['cloudflare/jobs/kinde-erasure-intent.mjs', 'cloudflare/jobs/kinde-erasure-intent.mjs'],
    ['cloudflare/jobs/kinde-inactivity-time.mjs', 'cloudflare/jobs/kinde-inactivity-time.mjs'],
    ['cloudflare/http/**', 'cloudflare/http/strict-empty-post.mjs'],
  ]) {
    assert.ok(apiSources.includes(source), source + ': no longer reached by private API');
    assert.ok(missingPrivateSources(apiPaths.filter(path => path !== pattern), apiSources).includes(source));
  }
  assert.ok(kindeSources.includes('cloudflare/http/strict-empty-post.mjs'));
  assert.ok(kindeSources.includes('cloudflare/api-route-policy.mjs'));
  assert.ok(missingPrivateSources(kindePaths.filter(path => path !== 'cloudflare/api-route-policy.mjs'),
    kindeSources).includes('cloudflare/api-route-policy.mjs'));
  assert.ok(missingPrivateSources(
    kindePaths.filter(path => path !== 'cloudflare/http/**'), kindeSources,
  ).includes('cloudflare/http/strict-empty-post.mjs'));
});

void test('private Worker deployments also observe package metadata and their provider preflight scripts', () => {
  const apiPaths = privateDeploymentPaths('.github/workflows/cloudflare-api-isolated.yml');
  const kindePaths = privateDeploymentPaths('.github/workflows/cloudflare-kinde-private.yml');
  for (const paths of [apiPaths, kindePaths]) {
    for (const file of ['package.json', 'package-lock.json', 'scripts/cloudflare-private-deploy-plan.mjs',
      'scripts/check-cloudflare-api-isolation.mjs', 'scripts/check-install-scripts.mjs']) {
      assert.ok(paths.includes(file), file);
    }
  }
  assert.ok(apiPaths.includes('scripts/verify-cloudflare-api-provider.mjs'));
  assert.ok(kindePaths.includes('scripts/verify-cloudflare-kinde-private-provider.mjs'));
});

void test('version-only releases skip private redeploy, but dependency or imported-code changes do not', () => {
  const paths = privateDeploymentPaths('.github/workflows/cloudflare-api-isolated.yml');
  const previousPackage = { version: '1.0.0', dependencies: { jose: '5.0.0' } };
  const currentPackage = { ...previousPackage, version: '1.1.0' };
  const previousLock = { version: '1.0.0', packages: { '': { version: '1.0.0' }, 'node_modules/jose': { version: '5.0.0' } } };
  const currentLock = { ...previousLock, version: '1.1.0', packages: { ...previousLock.packages, '': { version: '1.1.0' } } };
  const base = { changed: ['package.json', 'package-lock.json', 'src/components/Home/Unrelated.tsx'], paths,
    previousPackage, currentPackage, previousLock, currentLock };
  assert.equal(mustDeployPrivateWorker(base), false);
  for (const file of ['cloudflare/api/worker.mjs', 'cloudflare/recovery/runtime-sync-fence.mjs',
    'cloudflare/api-route-policy.mjs',
    'cloudflare/jobs/kinde-erasure-intent.mjs', 'cloudflare/jobs/kinde-inactivity-time.mjs',
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

void test('multi-commit push planning includes earlier Worker changes and fails closed without a verified base', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-private-push-'));
  const shallow = mkdtempSync(join(tmpdir(), 'logbook-private-shallow-'));
  const workflow = '.github/workflows/cloudflare-api-isolated.yml';
  const git = (...args) => execFileSync('git', args, {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const write = (path, data) => writeFileSync(join(dir, path), data + '\n');
  const pack = { name: 'synthetic', version: '1.0.0', dependencies: { jose: '5.0.0' } };
  const lock = { version: '1.0.0', packages: {
    '': { version: '1.0.0' }, 'node_modules/jose': { version: '5.0.0' },
  } };
  const commit = label => {
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', label);
  };
  try {
    mkdirSync(join(dir, 'cloudflare/api'), { recursive: true });
    write('package.json', JSON.stringify(pack));
    write('package-lock.json', JSON.stringify(lock));
    write('cloudflare/api/worker.mjs', 'export const version = 1;');
    git('init', '-q');
    commit('initial synthetic manifest');
    const before = git('rev-parse', 'HEAD');
    write('cloudflare/api/worker.mjs', 'export const version = 2;');
    commit('update Worker');
    const lastParent = git('rev-parse', 'HEAD');
    write('package.json', JSON.stringify({ ...pack, version: '1.1.0' }));
    write('package-lock.json', JSON.stringify({
      ...lock, version: '1.1.0',
      packages: { ...lock.packages, '': { version: '1.1.0' } },
    }));
    commit('bump version only');

    assert.equal(planFromGit(workflow, lastParent, dir), false, 'a version-only range may skip deploy');
    assert.equal(planFromGit(workflow, before, dir), true, 'the full range includes an earlier Worker change');
    assert.throws(() => planFromGit(workflow, 'invalid-sha', dir), /invalid deployment base/);
    assert.throws(() => planFromGit(workflow, '0'.repeat(40), dir), /invalid deployment base/);
    // Exercise the same two-commit shallow history used by deployment.
    execFileSync('git', ['clone', '--depth', '2', '--no-local', dir, shallow], { stdio: 'ignore' });
    assert.equal(planFromGit(workflow, lastParent, shallow), false);
    assert.throws(() => planFromGit(workflow, before, shallow));

    const beforeRename = git('rev-parse', 'HEAD');
    mkdirSync(join(dir, 'archive'), { recursive: true });
    git('mv', 'cloudflare/api/worker.mjs', 'archive/worker.mjs');
    write('package.json', JSON.stringify({ ...pack, version: '1.2.0' }));
    write('package-lock.json', JSON.stringify({
      ...lock, version: '1.2.0',
      packages: { ...lock.packages, '': { version: '1.2.0' } },
    }));
    commit('move relevant Worker out of watched paths');
    assert.equal(planFromGit(workflow, beforeRename, dir), true, 'a rename must include the removed relevant path');
  } finally {
    rmSync(shallow, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

const privateWorkflow = '.github/workflows/cloudflare-api-isolated.yml';
const kindeWorkflow = '.github/workflows/cloudflare-kinde-private.yml';
const repo = 'gernotfound/logbook';
const sha = 'a'.repeat(40);
const parentSha = 'b'.repeat(40);

function releaseFixture({ workflowPath = privateWorkflow, runPatch = {}, gateJobs, priorRunPatch = {}, priorJobs, noPrior = false, plan = () => false } = {}) {
  const common = {
    head_branch: 'main', status: 'completed', conclusion: 'success', run_attempt: 1,
    repository: { full_name: repo }, head_repository: { full_name: repo },
  };
  const run = { ...common, id: 42, head_sha: sha, event: 'push', path: '.github/workflows/verification.yml', ...runPatch };
  const prior = { ...common, id: 43, head_sha: parentSha, event: 'workflow_run', path: workflowPath, ...priorRunPatch };
  const success = name => ({ name, status: 'completed', conclusion: 'success' });
  const calls = [];
  const planCalls = [];
  const jobName = workflowPath === kindeWorkflow ? 'Compile, deploy and attest Kinde HTTP Worker without public route' : 'Deploy and verify private Auth Gate + D1 API';
  const api = path => {
    calls.push(path);
    if (path.endsWith('/runs/42')) return run;
    if (path.includes('/verification.yml/runs?')) return { workflow_runs: [run] };
    if (path.includes('/runs/42/attempts/1/jobs?')) return { jobs: gateJobs ?? [success('Main Release Gate'), success('Security / CodeQL')] };
    if (path.includes('/' + workflowPath.split('/').at(-1) + '/runs?')) return { workflow_runs: noPrior ? [] : [prior] };
    if (path.includes('/runs/43/attempts/1/jobs?')) return { jobs: priorJobs ?? [success(jobName)] };
    throw new Error('Unexpected GitHub API request: ' + path);
  };
  return { calls, planCalls, options: { workflowPath, repository: repo, sha, baseSha: parentSha,
    runId: '42', runAttempt: '1', eventName: 'workflow_run', api, pause: async () => {},
    plan: (...args) => { planCalls.push(args); return plan(...args); } } };
}

void test('private Worker release rejects failed, stale, forked and non-push gate evidence before planning', async () => {
  for (const runPatch of [
    { conclusion: 'failure' }, { status: 'in_progress' }, { head_sha: parentSha },
    { head_branch: 'feature' }, { head_repository: { full_name: 'fork/logbook' } },
    { repository: { full_name: 'other/logbook' } }, { event: 'pull_request' },
    { path: '.github/workflows/other.yml' }, { run_attempt: 2 }, { id: 99 },
  ]) {
    const f = releaseFixture({ runPatch, plan: () => assert.fail('Untrusted release must not plan a deploy') });
    await assert.rejects(planVerifiedPrivateRelease(f.options), /Missing trusted completed/);
    assert.equal(f.planCalls.length, 0);
  }
  for (const gateJobs of [
    [{ name: 'Main Release Gate', status: 'completed', conclusion: 'success' }],
    [{ name: 'Security / CodeQL', status: 'completed', conclusion: 'failure' }],
    [{ name: 'Main Release Gate', status: 'completed', conclusion: 'success' },
      { name: 'Security / CodeQL', status: 'completed', conclusion: 'skipped' }],
  ]) {
    const f = releaseFixture({ gateJobs, plan: () => assert.fail('Incomplete gate must not plan a deploy') });
    await assert.rejects(planVerifiedPrivateRelease(f.options), /CodeQL/);
    assert.equal(f.planCalls.length, 0);
  }
  await assert.rejects(planVerifiedPrivateRelease({ ...releaseFixture().options, runId: '' }), /triggering verification run/);
  await assert.rejects(planVerifiedPrivateRelease({ ...releaseFixture().options, eventName: 'push' }), /Untrusted deployment trigger/);
});

void test('only successful predecessor reconciliation permits a version-only skip', async () => {
  const good = releaseFixture();
  assert.equal(await planVerifiedPrivateRelease(good.options), false);
  assert.ok(good.calls.some(path => path.includes('head_sha=' + parentSha)));
  assert.deepEqual(good.planCalls, [[privateWorkflow, parentSha]]);
  const kinde = releaseFixture({ workflowPath: kindeWorkflow });
  assert.equal(await planVerifiedPrivateRelease(kinde.options), false);
  assert.deepEqual(kinde.planCalls, [[kindeWorkflow, parentSha]]);
  for (const config of [
    { noPrior: true }, { priorRunPatch: { conclusion: 'cancelled' } },
    { priorRunPatch: { conclusion: 'failure' } }, { priorRunPatch: { head_sha: sha } },
    { priorRunPatch: { event: 'push' } },
    { priorJobs: [{ name: 'Deploy and verify private Auth Gate + D1 API', status: 'completed', conclusion: 'skipped' }] },
    { priorJobs: [] },
  ]) {
    const f = releaseFixture({ ...config, plan: () => assert.fail('Unproven predecessor cannot justify skip') });
    assert.equal(await planVerifiedPrivateRelease(f.options), true);
    assert.equal(f.planCalls.length, 0);
  }
  const unavailable = releaseFixture();
  const priorUnavailable = path => {
    if (path.includes('/cloudflare-api-isolated.yml/runs?')) throw new Error('GitHub transport failure');
    return unavailable.options.api(path);
  };
  assert.equal(await planVerifiedPrivateRelease({ ...unavailable.options, api: priorUnavailable }), true);
  assert.equal(unavailable.planCalls.length, 0);
  assert.equal(await planVerifiedPrivateRelease({ ...good.options, baseSha: '' }), true);
  assert.equal(await planVerifiedPrivateRelease(releaseFixture({ plan: () => { throw new Error('missing history'); } }).options), true);
  assert.equal(await planVerifiedPrivateRelease(releaseFixture({ plan: () => true }).options), true);
  assert.equal(await planVerifiedPrivateRelease(releaseFixture({ plan: () => undefined }).options), true);
});

void test('explicit manual Kinde deploy still requires the exact successful main gate and never skips', async () => {
  const f = releaseFixture({ plan: () => assert.fail('Manual Kinde deploy must not use relevance optimization') });
  assert.equal(await planVerifiedPrivateRelease({ ...f.options, workflowPath: kindeWorkflow, eventName: 'workflow_dispatch' }), true);
  assert.equal(f.planCalls.length, 0);
  await assert.rejects(planVerifiedPrivateRelease({ ...f.options, eventName: 'workflow_dispatch' }), /Untrusted deployment trigger/);
  await assert.rejects(planVerifiedPrivateRelease({ ...releaseFixture({ runPatch: { conclusion: 'failure' } }).options,
    workflowPath: kindeWorkflow, eventName: 'workflow_dispatch' }), /Missing trusted completed/);
});

void test('private deployment workflows are triggered only by completed trusted main verification, without active CI polling', () => {
  for (const file of [privateWorkflow, kindeWorkflow]) {
    const workflow = readFileSync(file, 'utf8');
    assert.match(workflow, /^on:\n  workflow_run:/m);
    assert.match(workflow, /workflows:\n      - Milestone Verification\n    types:\n      - completed\n    branches:\n      - main/);
    assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
    assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
    assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
    assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
    assert.match(workflow, /EXPECTED_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/);
    assert.match(workflow, /GATE_RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/);
    assert.match(workflow, /GATE_RUN_ATTEMPT: \$\{\{ github\.event\.workflow_run\.run_attempt \}\}/);
    assert.match(workflow, /test "\$\{GITHUB_SHA\}" = "\$\{EXPECTED_SHA\}"/);
    assert.match(workflow, /git ls-remote --exit-code origin refs\/heads\/main/);
    assert.match(workflow, /group: cloudflare-isolated-api\n  queue: max/);
    assert.match(workflow, /set -euo pipefail\n          required="\$\(node scripts\/cloudflare-private-deploy-plan\.mjs/);
    assert.doesNotMatch(workflow, /for attempt in|sleep 15|^  push:/m);
  }
  assert.match(readFileSync(kindeWorkflow, 'utf8'), /^  workflow_dispatch:\s*$/m);
});
