import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';
import { compareAssignments, normalizePlaywrightLocation } from './check-test-discovery.mjs';

await test('accepts complete one-to-one discovery', () => {
  assert.deepEqual(compareAssignments(['a.test.ts', 'b.test.ts'], { general: ['a.test.ts'], isolated: ['b.test.ts'] }, 'Vitest'), []);
});

await test('rejects orphan files introduced outside runner discovery', () => {
  assert.match(compareAssignments(['a.test.ts', 'b.test.ts'], { general: ['a.test.ts'] }, 'Vitest').join('\n'), /undiscovered b\.test\.ts/);
});

await test('rejects overlapping discovery even when every expected file is present', () => {
  assert.match(compareAssignments(['a.test.ts'], { general: ['a.test.ts'], hardening: ['a.test.ts'] }, 'Vitest').join('\n'), /duplicate a\.test\.ts/);
});

await test('rejects tests selected from outside the tracked inventory', () => {
  assert.match(compareAssignments(['a.test.ts'], { general: ['a.test.ts', 'ghost.test.ts'] }, 'Vitest').join('\n'), /unexpected ghost\.test\.ts/);
});

await test('rejects an empty dedicated runner', () => {
  assert.match(compareAssignments(['a.test.ts'], { general: ['a.test.ts'], m7: [] }, 'Vitest').join('\n'), /empty runner m7/);
});

await test('rejects Playwright sharding loss and duplicate test identities', () => {
  const tests = ['e2e/a.spec.ts:3:1 › first', 'e2e/a.spec.ts:4:1 › second'];
  assert.match(compareAssignments(tests, { shard1: [tests[0]], shard2: [tests[0]] }, 'Playwright').join('\n'), /duplicate.*undiscovered/s);
});

await test('normalizes both Playwright CLI filename formats to the tracked E2E path', () => {
  assert.equal(normalizePlaywrightLocation('accessibility.spec.ts:33:1'), 'e2e/accessibility.spec.ts:33:1');
  assert.equal(normalizePlaywrightLocation('e2e/accessibility.spec.ts:33:1'), 'e2e/accessibility.spec.ts:33:1');
});

await test('stress runner preserves non-stress exclusions and the base environment', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const env = { command: 'serve', mode: 'test' };
  const base = await loadConfigFromFile(env, resolve(root, 'vitest.config.ts'));
  const stress = await loadConfigFromFile(env, resolve(root, 'vitest.stress.config.ts'));
  assert.ok(base?.config.test && stress?.config.test);

  const stressPatterns = ['**/challenger_*.test.{ts,tsx}', '**/*adversarial*.test.{ts,tsx}', '**/*stress*.test.{ts,tsx}'];
  assert.deepEqual(stress.config.test.include, stressPatterns);
  assert.deepEqual(
    stress.config.test.exclude,
    base.config.test.exclude.filter(pattern => !stressPatterns.includes(pattern)),
  );
  assert.ok(stress.config.test.exclude.includes('**/tests-e2e/**'));
  assert.equal(stress.config.test.environment, base.config.test.environment);
  assert.deepEqual(stress.config.test.setupFiles, base.config.test.setupFiles);
  assert.equal(stress.config.test.maxWorkers, base.config.test.maxWorkers);
  assert.deepEqual(stress.config.test.env, base.config.test.env);
});

await test('isolated runner rejects unsafe Firebase configuration before executing tests', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const isolated = await loadConfigFromFile({ command: 'serve', mode: 'test' }, resolve(root, 'vitest.isolated.config.ts'));
  assert.ok(isolated?.config.test);
  assert.equal(isolated.config.test.environment, 'node');
  assert.deepEqual(isolated.config.test.setupFiles, ['./tests/isolated/browserStorageSetup.ts']);
  assert.deepEqual(isolated.config.test.include, ['tests/isolated/**/*.test.ts']);
  assert.equal(isolated.config.test.maxWorkers, 2);
  assert.equal(isolated.config.test.env.VITE_ACCOUNT_DELETION_API_ORIGIN, 'http://127.0.0.1:9');

  // A fresh process proves the runner itself rejects shell overrides, not just
  // a separately tested helper or a cached Vitest module.
  const { spawnSync } = await import('node:child_process');
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { loadConfigFromFile } from 'vite'; await loadConfigFromFile({ command: 'serve', mode: 'test' }, 'vitest.isolated.config.ts');",
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, VITE_FIREBASE_PROJECT_ID: 'forbidden-isolated-test-project' },
  });
  if (probe.error) throw probe.error;
  assert.notEqual(probe.status, 0, 'unsafe configuration was accepted');
  assert.match(probe.stderr + probe.stdout, /Configurazione test non isolata: VITE_FIREBASE_PROJECT_ID/);
});
