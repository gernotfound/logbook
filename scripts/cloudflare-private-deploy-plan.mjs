import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const manifests = new Set(['package.json', 'package-lock.json']);
const shaPattern = /^[a-f0-9]{40}$/;
const verificationPath = '.github/workflows/verification.yml';
const verificationJobs = ['Main Release Gate', 'Security / CodeQL'];
const privateWorkflows = {
  '.github/workflows/cloudflare-api-isolated.yml': {
    job: 'Deploy and verify private Auth Gate + D1 API',
    paths: [
      'cloudflare/api/**',
      'cloudflare/auth/**',
      'cloudflare/recovery/**',
      'cloudflare/jobs/kinde-erasure-intent.mjs',
      'cloudflare/jobs/kinde-inactivity-time.mjs',
      'cloudflare/sql/**',
      'cloudflare/http/**',
      'package.json',
      'package-lock.json',
      'scripts/cloudflare-private-deploy-plan.mjs',
      'scripts/check-cloudflare-api-isolation.mjs',
      'scripts/check-install-scripts.mjs',
      'scripts/verify-cloudflare-api-provider.mjs',
      '.github/workflows/cloudflare-api-isolated.yml',
    ],
  },
  '.github/workflows/cloudflare-kinde-private.yml': {
    job: 'Compile, deploy and attest Kinde HTTP Worker without public route',
    paths: [
      '.github/workflows/cloudflare-kinde-private.yml',
      'cloudflare/auth/**',
      'cloudflare/sql/**',
      'cloudflare/api/logout-worker.mjs',
      'scripts/verify-cloudflare-kinde-private-provider.mjs',
      'cloudflare/http/**',
      'package.json',
      'package-lock.json',
      'scripts/cloudflare-private-deploy-plan.mjs',
      'scripts/check-cloudflare-api-isolation.mjs',
      'scripts/check-install-scripts.mjs',
    ],
  },
};

// workflow_run has no paths filter. Keep the deployment dependencies here,
// including the static import closure and the deployment/security scripts.
export function privateDeploymentPaths(workflowPath) {
  const paths = privateWorkflows[workflowPath]?.paths;
  if (!paths) throw new Error('Unknown private Worker workflow');
  return [...paths];
}

function matches(path, pattern) {
  return pattern.endsWith('/**')
    ? path.startsWith(pattern.slice(0, -3) + '/')
    : path === pattern;
}

export function versionOnly(before, after, isLock = false) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object'
    || Array.isArray(before) || Array.isArray(after)) return false;
  const oldValue = structuredClone(before);
  const newValue = structuredClone(after);
  delete oldValue.version;
  delete newValue.version;
  if (isLock) {
    if (oldValue.packages?.['']) delete oldValue.packages[''].version;
    if (newValue.packages?.['']) delete newValue.packages[''].version;
  }
  return isDeepStrictEqual(oldValue, newValue);
}

export function mustDeployPrivateWorker({ changed, paths, previousPackage, currentPackage, previousLock, currentLock }) {
  // Entrypoints, transitive imports and deployment security checks always
  // require a freshly verified private Worker, even alongside version bumps.
  if (changed.some(file => paths.some(pattern => !manifests.has(pattern) && matches(file, pattern)))) return true;
  if (!changed.some(file => manifests.has(file))) return true; // Unknown trigger: never skip.
  if (changed.includes('package.json') && !versionOnly(previousPackage, currentPackage)) return true;
  if (changed.includes('package-lock.json') && !versionOnly(previousLock, currentLock, true)) return true;
  return false;
}

function gitJson(ref, path, cwd) {
  return JSON.parse(execFileSync('git', ['show', ref + ':' + path], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

export function planFromGit(workflowPath, baseSha, cwd = process.cwd()) {
  const paths = privateDeploymentPaths(workflowPath);
  if (!paths.includes('package.json') || !paths.includes('package-lock.json')) throw new Error('Missing dependency triggers');
  if (!shaPattern.test(baseSha ?? '') || /^0{40}$/.test(baseSha)) {
    throw new Error('Missing or invalid deployment base SHA');
  }
  // Never compare to an assumed base: the caller must establish that the
  // previous release was successful before a version-only change can skip.
  execFileSync('git', ['merge-base', '--is-ancestor', baseSha, 'HEAD'], { cwd, stdio: 'ignore' });
  const changed = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', baseSha, 'HEAD', '--'], { cwd, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  return mustDeployPrivateWorker({
    changed, paths,
    previousPackage: gitJson(baseSha, 'package.json', cwd),
    currentPackage: JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8')),
    previousLock: gitJson(baseSha, 'package-lock.json', cwd),
    currentLock: JSON.parse(readFileSync(resolve(cwd, 'package-lock.json'), 'utf8')),
  });
}

function githubApi(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));
}

function isSuccessfulRun(run, { repository, sha, path, event }) {
  return run?.head_sha === sha && run.head_branch === 'main'
    && run.repository?.full_name === repository && run.head_repository?.full_name === repository
    && run.path === path && run.event === event && run.status === 'completed' && run.conclusion === 'success'
    && Number.isSafeInteger(run.id) && run.id > 0
    && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0;
}

function successfulJobs(jobs, names) {
  return Array.isArray(jobs) && names.every(name => {
    const matches = jobs.filter(job => job.name === name);
    return matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success';
  });
}

function readJobs(api, repository, run) {
  return api('repos/' + repository + '/actions/runs/' + run.id + '/attempts/' + run.run_attempt + '/jobs?per_page=100').jobs;
}

async function verifyCompletedMainRelease({ repository, sha, runId, runAttempt, eventName, api, pause }) {
  const root = 'repos/' + repository + '/actions/';
  const run = eventName === 'workflow_run'
    ? api(root + 'runs/' + runId)
    : api(root + 'workflows/verification.yml/runs?event=push&head_sha=' + sha + '&per_page=100').workflow_runs?.[0];
  if (!isSuccessfulRun(run, { repository, sha, path: verificationPath, event: 'push' })
    || (eventName === 'workflow_run' && (String(run.id) !== runId || String(run.run_attempt) !== runAttempt))) {
    throw new Error('Missing trusted completed exact-main verification run');
  }
  // The completed event removes the minutes-long wait for CI. Only allow
  // bounded retries for REST visibility of the two required job conclusions.
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const jobs = readJobs(api, repository, run);
    if (successfulJobs(jobs, verificationJobs)) return;
    if (Array.isArray(jobs) && jobs.some(job => verificationJobs.includes(job.name)
      && job.status === 'completed' && job.conclusion !== 'success')) {
      throw new Error('Exact-main release or CodeQL failed');
    }
    if (attempt < 14) await pause(5000);
  }
  throw new Error('Missing successful Main Release Gate or CodeQL');
}

function previousReleaseProven({ repository, sha, workflowPath, api }) {
  const workflowFile = workflowPath.split('/').at(-1);
  const runs = api('repos/' + repository + '/actions/workflows/' + workflowFile
    + '/runs?event=workflow_run&head_sha=' + sha + '&per_page=100').workflow_runs;
  const run = runs?.[0];
  if (!isSuccessfulRun(run, { repository, sha, path: workflowPath, event: 'workflow_run' })) return false;
  return successfulJobs(readJobs(api, repository, run), [privateWorkflows[workflowPath].job]);
}

export async function planVerifiedPrivateRelease({
  workflowPath, repository, sha, runId, runAttempt, eventName, baseSha,
  api = githubApi, pause = delay, plan = planFromGit,
}) {
  privateDeploymentPaths(workflowPath);
  if (repository !== 'gernotfound/logbook' || !shaPattern.test(sha ?? '')) throw new Error('Invalid release identity');
  if (eventName === 'workflow_run') {
    if (!/^[1-9][0-9]*$/.test(runId ?? '') || !/^[1-9][0-9]*$/.test(runAttempt ?? '')) {
      throw new Error('Missing triggering verification run identity');
    }
  } else if (eventName !== 'workflow_dispatch' || workflowPath !== '.github/workflows/cloudflare-kinde-private.yml') {
    throw new Error('Untrusted deployment trigger');
  }
  await verifyCompletedMainRelease({ repository, sha, runId, runAttempt, eventName, api, pause });
  if (eventName === 'workflow_dispatch') return true;

  // A cancelled, stale or failed predecessor cannot justify skipping a
  // Worker update. Reconcile current main whenever its predecessor cannot
  // prove successful completion of this same post-verification workflow.
  try {
    if (!shaPattern.test(baseSha ?? '') || !previousReleaseProven({ repository, sha: baseSha, workflowPath, api })) return true;
    return plan(workflowPath, baseSha) !== false;
  } catch (error) {
    console.error('Cannot prove prior private release; deployment required.', error.message);
    return true;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const sha = process.env.EXPECTED_SHA;
  if (sha !== process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== sha) {
    throw new Error('Private release checkout does not match exact workflow SHA');
  }
  // Main Release Gate attests a single-parent squash. Missing ancestry is
  // conservative: it cannot justify the version-only optimization.
  let baseSha;
  try {
    baseSha = execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    console.error('Cannot read release predecessor; deployment required.');
  }
  const required = await planVerifiedPrivateRelease({
    workflowPath: process.argv[2],
    repository: process.env.GITHUB_REPOSITORY,
    sha,
    runId: process.env.GATE_RUN_ID,
    runAttempt: process.env.GATE_RUN_ATTEMPT,
    eventName: process.env.GITHUB_EVENT_NAME,
    baseSha,
  });
  console.log(required ? 'true' : 'false');
}
