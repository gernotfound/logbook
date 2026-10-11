import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('./check-typecheck-coverage.mjs', import.meta.url));

function writeFixture(root, path, content = 'export {};\n') {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'logbook-ts-coverage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFixture(root, 'tsconfig.m5-tests.json', JSON.stringify({
    compilerOptions: { noEmit: true },
    include: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests/**/*.tsx', 'e2e/**/*.ts', '*.config.ts'],
  }));
  writeFixture(root, 'tsconfig.m7-server.json', JSON.stringify({
    compilerOptions: { noEmit: true },
    include: ['api/**/*.ts', 'server/**/*.ts'],
  }));
  for (const path of [
    'src/app.tsx',
    'src/types.d.ts',
    'tests/app.test.ts',
    'e2e/smoke.ts',
    'vite.config.ts',
    'api/handler.ts',
    'server/job.ts',
  ]) writeFixture(root, path);

  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '--all'], { cwd: root });

  return root;
}

function run(root) {
  return spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
}

test('accepts tracked files covered by either TypeScript project', t => {
  const root = fixture(t);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /all 7 tracked/);
});

test('rejects a tracked TypeScript file in an unconfigured directory', t => {
  const root = fixture(t);
  writeFixture(root, 'scripts/new-helper.ts');
  execFileSync('git', ['add', 'scripts/new-helper.ts'], { cwd: root });

  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /scripts\/new-helper\.ts/);
});

test('rejects new TypeScript extensions not selected by existing globs', t => {
  const root = fixture(t);
  writeFixture(root, 'src/new-module.mts');
  execFileSync('git', ['add', 'src/new-module.mts'], { cwd: root });

  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/new-module\.mts/);
});

test('rejects changes that silently remove existing files from a project', t => {
  const root = fixture(t);
  writeFixture(root, 'tsconfig.m5-tests.json', JSON.stringify({
    compilerOptions: { noEmit: true },
    include: ['tests/**/*.ts'],
  }));

  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/app\.tsx/);
  assert.match(result.stderr, /vite\.config\.ts/);
});

test('ignores untracked TypeScript scratch files', t => {
  const root = fixture(t);
  writeFixture(root, 'scripts/untracked.ts');

  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});
