import { spawnSync } from 'node:child_process';

const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA;
const currentSha = process.env.VERCEL_GIT_COMMIT_SHA || 'HEAD';

const backendPaths = [
  'api',
  'server',
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

const result = spawnSync(
  'git',
  ['diff', '--quiet', previousSha, currentSha, '--', ...backendPaths],
  { stdio: 'inherit' },
);

if (result.status === 0) {
  console.log('No backend-relevant changes since the previous successful Vercel deployment; skip deployment.');
  process.exit(0);
}

if (result.status === 1) {
  console.log('Backend-relevant changes detected; continue Vercel deployment.');
  process.exit(1);
}

console.warn('Unable to evaluate backend diff safely; continue Vercel deployment.');
process.exit(1);
