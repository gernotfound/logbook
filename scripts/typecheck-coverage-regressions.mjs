import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('./check-typecheck-coverage.mjs', import.meta.url));
const serverConfig = fileURLToPath(new URL('../tsconfig.m7-server.json', import.meta.url));
const nodeTsconfig = fileURLToPath(new URL('../tsconfig.node.json', import.meta.url));
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));

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

await test('accepts tracked files covered by either TypeScript project', t => {
  const root = fixture(t);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /all 7 tracked/);
});

await test('rejects a tracked TypeScript file in an unconfigured directory', t => {
  const root = fixture(t);
  writeFixture(root, 'scripts/new-helper.ts');
  execFileSync('git', ['add', 'scripts/new-helper.ts'], { cwd: root });

  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /scripts\/new-helper\.ts/);
});

await test('rejects new TypeScript extensions not selected by existing globs', t => {
  const root = fixture(t);
  writeFixture(root, 'src/new-module.mts');
  execFileSync('git', ['add', 'src/new-module.mts'], { cwd: root });

  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/new-module\.mts/);
});

await test('rejects same-basename .ts and .tsx files when one is shadowed by TypeScript', t => {
  const root = fixture(t);
  writeFixture(root, 'tests/app.test.tsx');
  execFileSync('git', ['add', 'tests/app.test.tsx'], { cwd: root });

  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tests\/app\.test\.tsx/);
});

await test('rejects changes that silently remove existing files from a project', t => {
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

await test('ignores untracked TypeScript scratch files', t => {
  const root = fixture(t);
  writeFixture(root, 'scripts/untracked.ts');

  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});

await test('trusted M7 TypeScript accepts Node web APIs but rejects browser-only globals', t => {
  // TypeScript must resolve the installed @types/node used by the real backend.
  // A child configuration changes only the entrypoint; compiler options are inherited.
  const scratchParent = fileURLToPath(new URL('../node_modules/.tmp/', import.meta.url));
  mkdirSync(scratchParent, { recursive: true });
  const cwd = mkdtempSync(join(scratchParent, 'logbook-m7-types-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  writeFixture(cwd, 'tsconfig.json', JSON.stringify({
    extends: serverConfig,
    include: ['server-fixture.ts'],
  }));
  const compile = () => {
    const result = spawnSync(process.execPath, [compiler, '--project', join(cwd, 'tsconfig.json')], {
      cwd, encoding: 'utf8',
    });
    assert.equal(result.error, undefined, result.error?.message);
    return { status: result.status, output: result.stdout + result.stderr };
  };

  // Native Node 24 Request/Response must work without browser DOM declarations.
  writeFixture(cwd, 'server-fixture.ts', [
    "const request: Request = new Request('https://example.invalid/api');",
    "const response: Response = Response.json({ ok: true });",
    "const bytes = Buffer.from('ok');",
    'export const result = request.method + response.status + bytes.byteLength;',
  ].join('\n') + '\n');
  const supported = compile();
  assert.equal(supported.status, 0, supported.output);

  writeFixture(cwd, 'server-fixture.ts', 'export const browserOnly = [document, window];\n');
  const forbidden = compile();
  assert.notEqual(forbidden.status, 0, 'browser globals must not silently typecheck in Vercel Functions');
  for (const name of ['document', 'window']) {
    assert.match(forbidden.output, new RegExp("Cannot find name '" + name + "'"), forbidden.output);
  }
});

await test('the referenced Node TypeScript project never emits a competing Vite configuration', t => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-ts-node-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFixture(root, 'tsconfig.node.json', readFileSync(nodeTsconfig, 'utf8'));
  writeFixture(root, 'vite.config.ts', 'export const configSentinel = 42;\n');

  // Exercise the actual compiler, not an approximation of composite's emit rules.
  const result = spawnSync(process.execPath, [compiler, '--build', 'tsconfig.node.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(root, 'vite.config.js')), false, 'emitted JS could shadow vite.config.ts');
  assert.equal(existsSync(join(root, 'vite.config.d.ts')), false, 'declarations must not pollute the Vite config directory');
  assert.equal(existsSync(join(root, 'tsconfig.node.tsbuildinfo')), false, 'incremental metadata must remain outside the root');
  assert.equal(
    existsSync(join(root, 'node_modules/.tmp/tsconfig-node/vite.config.d.ts')),
    true,
    'composite project must still build declarations in its ignored output directory',
  );
});
