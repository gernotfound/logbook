import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const smokeScript = fileURLToPath(new URL('./check-m7-smoke-test.mjs', import.meta.url));

const fakeNpx = [
  "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  'const args = process.argv.slice(2);',
  "const outputIndex = args.indexOf('--outDir');",
  "if (args[0] !== 'tsc' || outputIndex < 0 || !args[outputIndex + 1]) process.exit(44);",
  'const outDir = args[outputIndex + 1];',
  "appendFileSync(join(process.cwd(), 'compiler-destinations.txt'), outDir + '\\n');",
  "mkdirSync(join(outDir, 'api'), { recursive: true });",
  "if (process.env.LOGBOOK_SMOKE_FIXTURE_MODE === 'compile-error') {",
  "  writeFileSync(join(outDir, 'partial.js'), 'incomplete output');",
  '  process.exit(2);',
  '}',
  "const denied = 'export async function GET() { return new Response(null, { status: 403 }); }\\n';",
  "const cron = 'export async function GET() { return new Response(null, { status: 401 }); }\\n';",
  "const fail = 'throw new Error(\\'injected runtime failure\\');\\n';",
  "writeFileSync(join(outDir, 'api/account-deletion.js'), process.env.LOGBOOK_SMOKE_FIXTURE_MODE === 'runtime-error' ? fail : denied);",
  "writeFileSync(join(outDir, 'api/account-deletion-device.js'), denied);",
  "writeFileSync(join(outDir, 'api/account-deletion-cron.js'), cron);",
].join('\n') + '\n';

function prepare(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'logbook-m7-smoke-regression-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const bin = join(cwd, 'bin');
  mkdirSync(bin);
  writeFileSync(join(cwd, 'package.json'), '{"type":"module"}\n');
  const fakePath = join(bin, 'fake-npx.mjs');
  writeFileSync(fakePath, fakeNpx);
  if (process.platform === 'win32') {
    writeFileSync(join(bin, 'npx.cmd'), '@echo off\r\n"' + process.execPath + '" "' + fakePath + '" %*\r\n');
  } else {
    writeFileSync(join(bin, 'npx'), '#!/bin/sh\nexec "' + process.execPath + '" "' + fakePath + '" "$@"\n', { mode: 0o755 });
  }
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  const env = { ...process.env, [pathKey]: bin + delimiter + (process.env[pathKey] ?? '') };
  return { cwd, env };
}

function artifacts(cwd) {
  return readdirSync(cwd).filter(name => name.startsWith('.smoke-test-') && name !== '.smoke-test-dist' && name !== '.smoke-test-runner.mjs');
}

function run({ cwd, env }, mode = 'ok') {
  const result = spawnSync(process.execPath, [smokeScript], {
    cwd, env: { ...env, LOGBOOK_SMOKE_FIXTURE_MODE: mode }, encoding: 'utf8',
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

await test('success checks the same HTTP responses without touching pre-existing paths', t => {
  const fixture = prepare(t);
  const legacyDist = join(fixture.cwd, '.smoke-test-dist');
  mkdirSync(legacyDist);
  writeFileSync(join(legacyDist, 'sentinel.txt'), 'keep directory');
  writeFileSync(join(fixture.cwd, '.smoke-test-runner.mjs'), 'keep runner');
  const result = run(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /M7 smoke test passed/);
  assert.equal(readFileSync(join(legacyDist, 'sentinel.txt'), 'utf8'), 'keep directory');
  assert.equal(readFileSync(join(fixture.cwd, '.smoke-test-runner.mjs'), 'utf8'), 'keep runner');
  assert.deepEqual(artifacts(fixture.cwd), []);
});

await test('partial compiler output is removed and failure stays nonzero', t => {
  const fixture = prepare(t);
  const result = run(fixture, 'compile-error');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Failed to compile functions for smoke test/);
  assert.deepEqual(artifacts(fixture.cwd), []);
});

await test('runtime failure removes compiled files and fails', t => {
  const fixture = prepare(t);
  const result = run(fixture, 'runtime-error');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /M7 smoke test failed/);
  assert.deepEqual(artifacts(fixture.cwd), []);
});

await test('concurrent smoke invocations use different compilation directories', async t => {
  const fixture = prepare(t);
  const execute = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [smokeScript], { cwd: fixture.cwd, env: fixture.env });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stderr }));
  });
  const results = await Promise.all([execute(), execute()]);
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  const destinations = readFileSync(join(fixture.cwd, 'compiler-destinations.txt'), 'utf8').trim().split('\n');
  assert.equal(destinations.length, 2);
  assert.notEqual(destinations[0], destinations[1]);
  assert.deepEqual(artifacts(fixture.cwd), []);
});
