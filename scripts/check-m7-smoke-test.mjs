import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';

console.log('Compiling server functions to JS for smoke test...');
// Compile api and server folders to a temporary dist directory.
try {
  execFileSync('npx', ['tsc', '--project', 'tsconfig.m7-server.json', '--outDir', '.smoke-test-dist', '--noEmit', 'false'], { stdio: 'inherit' });
} catch {
  console.error('Failed to compile functions for smoke test');
  process.exit(1);
}

const runnerScript = `
import { GET as getDeletion } from './.smoke-test-dist/api/account-deletion.js';
import { GET as getCron } from './.smoke-test-dist/api/account-deletion-cron.js';

async function run() {
  const req1 = new Request('https://example.test/api/account-deletion');
  const res1 = await getDeletion(req1);
  if (res1.status !== 403) throw new Error('Expected 403 on /api/account-deletion, got ' + res1.status);

  const req2 = new Request('https://example.test/api/account-deletion-cron');
  const res2 = await getCron(req2);
  if (res2.status !== 401 && res2.status !== 503) throw new Error('Expected 401 or 503 on cron, got ' + res2.status);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
`;

import { writeFileSync } from 'node:fs';
writeFileSync('.smoke-test-runner.mjs', runnerScript);

console.log('Running compiled JS functions with require(ESM) disabled to match the Vercel dependency boundary...');
let success = false;
try {
  // Vercel's serverless loader currently rejects the jwks-rsa -> jose v6 require(ESM)
  // path. Disabling Node's require(ESM) support reproduces that boundary deterministically.
  execFileSync('node', ['--no-require-module', '.smoke-test-runner.mjs'], { stdio: 'inherit' });
  console.log('M7 smoke test passed: Vercel Functions loaded and returned controlled application responses.');
  success = true;
} catch {
  console.error('M7 smoke test failed: Could not load or execute compiled Vercel Functions at the Vercel-compatible module boundary.');
} finally {
  if (existsSync('.smoke-test-dist')) rmSync('.smoke-test-dist', { recursive: true, force: true });
  if (existsSync('.smoke-test-runner.mjs')) rmSync('.smoke-test-runner.mjs');
  if (!success) process.exit(1);
}
