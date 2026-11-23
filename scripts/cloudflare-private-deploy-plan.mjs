import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const manifests = new Set(['package.json', 'package-lock.json']);

export function readPrivatePushPaths(source) {
  const block = source.match(/^    paths:\r?\n((?:      - [^\r\n]+\r?\n)+)/m);
  if (!block) throw new Error('Missing main-only push.paths');
  return [...block[1].matchAll(/^      - (.+)$/gm)]
    .map(([, item]) => item.trim().replace(/^(['"])(.*)\1$/, '$2'));
}

function matches(path, pattern) {
  return pattern.endsWith('/**')
    ? path.startsWith(pattern.slice(0, -3) + '/')
    : path === pattern;
}

export function versionOnly(before, after, isLock = false) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return false;
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

function gitJson(ref, path) {
  return JSON.parse(execFileSync('git', ['show', ref + ':' + path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

export function planFromGit(workflowPath, pushBeforeSha = process.env.PUSH_BEFORE_SHA) {
  const paths = readPrivatePushPaths(readFileSync(workflowPath, 'utf8'));
  if (!paths.includes('package.json') || !paths.includes('package-lock.json')) throw new Error('Missing dependency triggers');
  if (!/^[a-f0-9]{40}$/.test(pushBeforeSha ?? '') || /^0{40}$/.test(pushBeforeSha)) {
    throw new Error('Missing or invalid push before SHA');
  }
  // A push may contain multiple commits: HEAD^ can hide an earlier Worker
  // change followed by a version-only commit. Unknown history must deploy.
  execFileSync('git', ['merge-base', '--is-ancestor', pushBeforeSha, 'HEAD'], { stdio: 'ignore' });
  const changed = execFileSync('git', ['diff', '--name-only', '-z', pushBeforeSha, 'HEAD', '--'], { encoding: 'utf8' })
    .split('\0').filter(Boolean);
  return mustDeployPrivateWorker({
    changed, paths,
    previousPackage: gitJson(pushBeforeSha, 'package.json'),
    currentPackage: JSON.parse(readFileSync('package.json', 'utf8')),
    previousLock: gitJson(pushBeforeSha, 'package-lock.json'),
    currentLock: JSON.parse(readFileSync('package-lock.json', 'utf8')),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Missing Git history or malformed dependency metadata must never bypass
  // the exact-SHA release gate or silently retain stale Worker code.
  let required = true;
  try { required = planFromGit(process.argv[2]); }
  catch (error) { console.error('Cannot prove version-only change; deployment required.', error.message); }
  console.log(required ? 'true' : 'false');
}
