import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const workDirectory = mkdtempSync(join(process.cwd(), '.smoke-test-'));
const compiledDirectory = join(workDirectory, 'dist');
const runnerPath = join(workDirectory, 'runner.mjs');

const runnerScript = [
  "import { GET as getDeletion } from './dist/api/account-deletion.js';",
  "import { GET as getDeletionDevice } from './dist/api/account-deletion-device.js';",
  "import { GET as getCron } from './dist/api/account-deletion-cron.js';",
  '',
  'async function run() {',
  "  const req1 = new Request('https://example.test/api/account-deletion', { headers: { origin: 'https://thelogbook.web.app' } });",
  '  const res1 = await getDeletion(req1);',
  "  if (res1.status !== 403) throw new Error('Expected 403 on /api/account-deletion, got ' + res1.status);",
  '',
  "  const deviceReq = new Request('https://example.test/api/account-deletion-device', { headers: { origin: 'https://thelogbook.web.app' } });",
  '  const deviceRes = await getDeletionDevice(deviceReq);',
  "  if (deviceRes.status !== 403) throw new Error('Expected 403 on /api/account-deletion-device without App Check, got ' + deviceRes.status);",
  '',
  "  const req2 = new Request('https://example.test/api/account-deletion-cron');",
  '  const res2 = await getCron(req2);',
  "  if (res2.status !== 401 && res2.status !== 503) throw new Error('Expected 401 or 503 on cron, got ' + res2.status);",
  '}',
  '',
  'run().catch(error => {',
  '  console.error(error);',
  '  process.exit(1);',
  '});',
  '',
].join('\n');

let phase = 'compile';
try {
  console.log('Compiling server functions to JS for smoke test...');
  execFileSync(npxCommand, ['tsc', '--project', 'tsconfig.m7-server.json', '--outDir', compiledDirectory, '--noEmit', 'false'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  phase = 'run';
  writeFileSync(runnerPath, runnerScript);
  console.log('Running compiled JS functions with require(ESM) disabled to match the Vercel dependency boundary...');
  execFileSync('node', ['--no-require-module', runnerPath], { stdio: 'inherit' });
  console.log('M7 smoke test passed: Vercel Functions loaded and returned controlled application responses.');
} catch {
  console.error(phase === 'compile'
    ? 'Failed to compile functions for smoke test'
    : 'M7 smoke test failed: Could not load or execute compiled Vercel Functions at the Vercel-compatible module boundary.');
  process.exitCode = 1;
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
