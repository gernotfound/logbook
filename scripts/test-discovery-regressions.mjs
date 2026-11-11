import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';
import { compareAssignments, normalizePlaywrightLocation } from './check-test-discovery.mjs';
import { isCriticalTest } from './critical-test-selection.mjs';

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

await test('critical coverage selection is invariant under functional test folder moves', () => {
  for (const name of [
    'auth_checkpoint_drain.test.ts',
    'account_deletion_reauth_ui.test.tsx',
    'm7_account_deletion_api.test.ts',
    'guest_bootstrap_lifecycle.test.tsx',
    'guest_account_migration_v3.test.tsx',
    'health_consent_client.test.ts',
    'db_sync_error_semantics.test.ts',
    'storage_bootstrap_integrity.test.ts',
  ]) {
    assert.equal(isCriticalTest('tests/' + name), true, name + ' at root');
    assert.equal(isCriticalTest('tests/account/auth/' + name), true, name + ' in auth folder');
    assert.equal(isCriticalTest('tests/account/deletion/' + name), true, name + ' in deletion folder');
  }
  assert.equal(isCriticalTest('src/lib/auth/recentAuth.test.ts'), true);
  assert.equal(isCriticalTest('src/contexts/auth/session.test.tsx'), true);
  assert.equal(isCriticalTest('tests/isolated/auth_checkpoint_drain.test.ts'), false);
  assert.equal(isCriticalTest('tests/emulator/m7_account_deletion_api.test.ts'), false);
  assert.equal(isCriticalTest('tests/fuzz/storage_bootstrap_integrity.test.ts'), false);
  assert.equal(isCriticalTest('tests/training/auth_checkpoint_drain.spec.ts'), false);
  assert.equal(isCriticalTest('tests/account/auth/guest_login_overlay.test.tsx'), false);
  assert.equal(isCriticalTest('tests\\\\account\\\\auth\\\\auth_checkpoint_drain.test.ts'), true);
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

await test('gc runner preserves causal test discovery and rejects external client endpoints', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const gc = await loadConfigFromFile({ command: 'serve', mode: 'test' }, resolve(root, 'vitest.gc.config.ts'));
  assert.ok(gc?.config.test);
  assert.equal(gc.config.test.environment, 'node');
  assert.deepEqual(gc.config.test.setupFiles, ['./tests/isolated/browserStorageSetup.ts']);
  assert.deepEqual(gc.config.test.include, ['tests/gc/**/*.test.ts']);
  assert.equal(gc.config.test.maxWorkers, 1);
  assert.equal(gc.config.test.testTimeout, 30000);

  const { spawnSync } = await import('node:child_process');
  for (const [key, value] of [
    ['VITE_FIREBASE_PROJECT_ID', 'unapproved-gc-project'],
    ['VITE_ACCOUNT_DELETION_API_ORIGIN', 'https://unapproved-gc.example.invalid'],
  ]) {
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
      "import { loadConfigFromFile } from 'vite'; await loadConfigFromFile({ command: 'serve', mode: 'test' }, 'vitest.gc.config.ts');",
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, [key]: value },
    });
    if (probe.error) throw probe.error;
    assert.notEqual(probe.status, 0, key + ' must be rejected before GC tests load');
    assert.match(probe.stderr + probe.stdout, /Configurazione test non isolata/);
  }
});

await test('recovery runner rejects inherited Firebase and backend endpoints before loading tests', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const recovery = await loadConfigFromFile({ command: 'serve', mode: 'test' }, resolve(root, 'vitest.recovery.config.ts'));
  assert.ok(recovery?.config.test);
  assert.equal(recovery.config.test.environment, 'node');
  assert.deepEqual(recovery.config.test.setupFiles, ['./tests/isolated/browserStorageSetup.ts']);
  assert.deepEqual(recovery.config.test.include, ['tests/recovery/**/*.test.ts']);
  assert.equal(recovery.config.test.maxWorkers, 1);
  assert.equal(recovery.config.test.testTimeout, 15000);
  assert.equal(recovery.config.test.env.VITE_ACCOUNT_DELETION_API_ORIGIN, 'http://127.0.0.1:9');

  const { spawnSync } = await import('node:child_process');
  for (const [key, value] of [
    ['VITE_FIREBASE_PROJECT_ID', 'external-recovery-project'],
    ['VITE_ACCOUNT_DELETION_API_ORIGIN', 'https://external-recovery.example.invalid'],
    ['VITE_RECAPTCHA_ENTERPRISE_SITE_KEY', 'unexpected-recovery-site-key'],
  ]) {
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
      "import { loadConfigFromFile } from 'vite'; await loadConfigFromFile({ command: 'serve', mode: 'test' }, 'vitest.recovery.config.ts');",
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, [key]: value },
    });
    if (probe.error) throw probe.error;
    assert.notEqual(probe.status, 0, key + ' must be rejected before recovery tests load');
    assert.match(probe.stderr + probe.stdout, /Configurazione test non isolata/);
  }
});

await test('emulator runner rejects inherited Firebase endpoints before loading Rules tests', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const emulator = await loadConfigFromFile({ command: 'serve', mode: 'test' }, resolve(root, 'vitest.emulator.config.ts'));
  assert.ok(emulator?.config.test);
  assert.equal(emulator.config.test.environment, 'node');
  assert.deepEqual(emulator.config.test.include, ['tests/emulator/**/*.test.ts']);
  assert.deepEqual(emulator.config.test.setupFiles, ['tests/emulator/setup.ts']);
  assert.equal(emulator.config.test.maxWorkers, 1);
  assert.equal(emulator.config.test.testTimeout, 15000);
  assert.equal(emulator.config.test.hookTimeout, 30000);

  const { spawnSync } = await import('node:child_process');
  for (const [key, value] of [
    ['VITE_FIREBASE_PROJECT_ID', 'unapproved-emulator-project'],
    ['VITE_ACCOUNT_DELETION_API_ORIGIN', 'https://unapproved-emulator.example.invalid'],
  ]) {
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
      "import { loadConfigFromFile } from 'vite'; await loadConfigFromFile({ command: 'serve', mode: 'test' }, 'vitest.emulator.config.ts');",
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, [key]: value },
    });
    if (probe.error) throw probe.error;
    assert.notEqual(probe.status, 0, key + ' must be rejected before Rules tests load');
    assert.match(probe.stderr + probe.stdout, /Configurazione test non isolata/);
  }
});

await test('jsdom runner rejects unsafe client endpoints before UI test setup', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const base = await loadConfigFromFile({ command: 'serve', mode: 'test' }, resolve(root, 'vitest.config.ts'));
  assert.ok(base?.config.test);
  assert.equal(base.config.test.environment, 'jsdom');
  assert.deepEqual(base.config.test.setupFiles, ['./tests/cssReadCompat.ts', './tests/setup.tsx']);
  assert.equal(base.config.test.maxWorkers, 2);
  assert.equal(base.config.test.env.VITE_ACCOUNT_DELETION_API_ORIGIN, 'http://127.0.0.1:9');

  const { spawnSync } = await import('node:child_process');
  for (const [key, value] of [
    ['VITE_FIREBASE_PROJECT_ID', 'external-project'],
    ['VITE_ACCOUNT_DELETION_API_ORIGIN', 'https://external.example.invalid'],
    ['VITE_RECAPTCHA_ENTERPRISE_SITE_KEY', 'unexpected-site-key'],
  ]) {
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
      "import { loadConfigFromFile } from 'vite'; await loadConfigFromFile({ command: 'serve', mode: 'test' }, 'vitest.config.ts');",
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, [key]: value },
    });
    if (probe.error) throw probe.error;
    assert.notEqual(probe.status, 0, key + ' must be rejected before UI test setup');
    assert.match(probe.stderr + probe.stdout, /Configurazione test non isolata/);
  }
});
