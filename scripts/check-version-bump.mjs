import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function parseJson(value, label) {
  try { return JSON.parse(value); }
  catch { throw new Error(label + ': invalid JSON'); }
}
function version(value, label) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(label + ': invalid MAJOR.MINOR.PATCH');
  }
  const parts = value.split('.').map(Number);
  if (parts.some(n => !Number.isSafeInteger(n))) throw new Error(label + ': unsafe version number');
  return parts;
}
function baseRef() {
  const explicit = process.env.LOGBOOK_VERSION_BASE_SHA;
  if (explicit) {
    if (!/^[a-f0-9]{40}$/.test(explicit)) throw new Error('invalid LOGBOOK_VERSION_BASE_SHA');
    return explicit;
  }
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') throw new Error('missing PR base LOGBOOK_VERSION_BASE_SHA');
  if (process.env.GITHUB_EVENT_NAME === 'push' || process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') return 'HEAD^';
  const remote = spawnSync('git', ['show-ref', '--quiet', '--verify', 'refs/remotes/origin/main']);
  if (remote.status === 0 && git('rev-parse', 'HEAD') !== git('rev-parse', 'refs/remotes/origin/main')) {
    return git('merge-base', 'HEAD', 'refs/remotes/origin/main');
  }
  return 'HEAD^';
}
function lockMatches(lock, expected, label) {
  if (lock?.version !== expected || lock?.packages?.['']?.version !== expected) {
    throw new Error(label + ': both root lockfile versions must match package.json');
  }
}
try {
  const base = git('rev-parse', '--verify', baseRef() + '^{commit}');
  const head = git('rev-parse', 'HEAD');
  if (base === head || git('merge-base', base, head) !== base) throw new Error('version baseline must be an ancestor of the candidate');
  const oldPkg = parseJson(git('show', base + ':package.json'), 'base package');
  const oldLock = parseJson(git('show', base + ':package-lock.json'), 'base lockfile');
  const pkg = parseJson(readFileSync('package.json', 'utf8'), 'candidate package');
  const lock = parseJson(readFileSync('package-lock.json', 'utf8'), 'candidate lockfile');
  const [major, minor] = version(oldPkg.version, 'base');
  const [nextMajor, nextMinor, nextPatch] = version(pkg.version, 'candidate');
  lockMatches(oldLock, oldPkg.version, 'base');
  lockMatches(lock, pkg.version, 'candidate');
  if (nextMajor !== major || nextMinor !== minor + 1 || nextPatch !== 0) {
    throw new Error('expected ' + major + '.' + (minor + 1) + '.0 relative to ' + oldPkg.version + ', got ' + pkg.version);
  }
  console.log('Version bump OK: ' + oldPkg.version + ' -> ' + pkg.version + ' base=' + base + ' head=' + head);
} catch (error) {
  console.error('Version bump contract failed: ' + error.message);
  process.exitCode = 1;
}
