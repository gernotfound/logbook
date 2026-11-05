import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA;
const currentSha = process.env.VERCEL_GIT_COMMIT_SHA || 'HEAD';

const backendPaths = [
  'api',
  'server',
  // Server health-consent acceptance imports this shared version contract.
  'src/lib/legalVersions.ts',
  'vercel.json',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.m7-server.json',
  'scripts/vercel-ignore-build.mjs',
  'scripts/prepare-vercel-backend-static.mjs',
];

if (!previousSha) {
  console.log('No previous successful Vercel deployment SHA available; deploy to fail safe.');
  process.exit(1);
}

// Release policy bumps the PWA version on every PR; this alone does not change
// the backend. All other package and lockfile changes still force a deployment.
const versionFiles = ['package.json', 'package-lock.json'];
const result = spawnSync(
  'git',
  ['diff', '--quiet', previousSha, currentSha, '--', ...backendPaths.filter(path => !versionFiles.includes(path))],
  { stdio: 'inherit' },
);

if (result.status !== 0) {
  console.log('Backend path changed or its Git diff cannot be verified; continue Vercel deployment.');
  process.exit(1);
}

function readPackageAt(commitSha, filePath) {
  const git = spawnSync('git', ['show', `${commitSha}:${filePath}`], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (git.status !== 0) throw new Error(`Cannot inspect ${filePath} at ${commitSha}`);
  const parsed = JSON.parse(git.stdout);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${filePath} at ${commitSha}`);
  }
  return parsed;
}

function semanticPackagePair(commitSha) {
  const pkg = readPackageAt(commitSha, 'package.json');
  const lock = readPackageAt(commitSha, 'package-lock.json');
  const root = lock.packages?.[''];
  if (typeof pkg.version !== 'string' || !pkg.version
      || pkg.version !== lock.version || pkg.version !== root?.version) {
    throw new Error('Inconsistent root release versions');
  }

  const { version: _packageVersion, ...semanticPackage } = pkg;
  const { version: _lockVersion, packages, ...otherLock } = lock;
  const { version: _rootVersion, ...semanticRoot } = root;
  return {
    pkg: semanticPackage,
    lock: { ...otherLock, packages: { ...packages, '': semanticRoot } },
  };
}

try {
  const previous = semanticPackagePair(previousSha);
  const current = semanticPackagePair(currentSha);
  if (isDeepStrictEqual(previous, current)) {
    console.log('Only the PWA release version changed; skip Vercel backend deployment.');
    process.exit(0);
  }
  console.log('Package dependencies, scripts or lockfile content changed; continue backend deployment.');
} catch (error) {
  console.warn('Cannot prove package changes are version-only; continue backend deployment.', error.message);
}
process.exit(1);
