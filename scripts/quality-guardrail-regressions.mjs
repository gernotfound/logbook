import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const checker = fileURLToPath(new URL('./check-quality-guardrails.mjs', import.meta.url));
const warning = {
  suite: 'default', file: 'src/App.tsx', code: 'react(set-state-in-effect)',
  message: 'Reviewed warning', source: 'setVisible(false);', count: 2,
};

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function save(root, path, contents) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2) + '\n');
}

function read(root, path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function commit(root) {
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=QualityTest', '-c', 'user.email=quality@example.invalid', 'commit', '-qm', 'fixture');
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'logbook-quality-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  save(root, 'config/lint-warning-baseline.json', [warning]);
  save(root, '.oxlintrc.json', { plugins: ['react'], rules: { 'react/rules-of-hooks': 'error' } });
  save(root, '.oxlintrc.a11y.json', { plugins: ['jsx-a11y'], rules: { 'jsx-a11y/alt-text': 'error' } });
  save(root, '.oxlintrc.type-aware.json', { plugins: ['typescript'], rules: { 'typescript/no-floating-promises': 'warn' } });
  save(root, 'tsconfig.json', { compilerOptions: { strict: true, noEmit: true } });
  save(root, 'tsconfig.m5-tests.json', { extends: './tsconfig.json', compilerOptions: { noEmit: true } });
  save(root, 'tsconfig.m7-server.json', { compilerOptions: { strict: true, noEmit: true } });
  save(root, 'src/App.tsx', 'export const safe = true;\n');
  const scripts = {
    build: 'tsc --noEmit && vite build',
    lint: 'oxlint',
    'lint:a11y': 'oxlint --config .oxlintrc.a11y.json',
    'lint:type-aware': 'oxlint --config .oxlintrc.type-aware.json',
    'lint:baseline': 'node scripts/check-lint-baseline.mjs',
    'test:ci-contract': 'node scripts/check-ci-contract.mjs',
    'test:typecheck-coverage': 'node scripts/check-typecheck-coverage.mjs',
    'test:typecheck:m5': 'tsc --noEmit -p tsconfig.m5-tests.json',
    'test:typecheck:m7': 'tsc --noEmit -p tsconfig.m7-server.json',
    'test:quality:m5': 'node scripts/check-m5-test-quality.mjs',
    'test:dead-code': 'knip',
    'test:repo-hygiene': 'node scripts/check-repo-hygiene.mjs',
    'test:no-skips': 'node scripts/check-test-skips.mjs',
    'test:security-static': 'node scripts/run-security-static.mjs',
    'test:e2e': 'node scripts/run-e2e.mjs',
    'test:rules': 'node scripts/run-firestore-rules-tests.mjs',
    'test:domain-boundary:m8': 'node scripts/check-m8-domain-boundary.mjs',
    'verify:m6': 'npm run lint && npm run test:typecheck:m5 && npm run test:rules',
    'verify:m8': 'npm run verify:m6',
  };
  save(root, 'package.json', { scripts });
  commit(root);
  return { root, base: git(root, 'rev-parse', 'HEAD') };
}

function run(ctx, env = {}) {
  return spawnSync(process.execPath, [checker], {
    cwd: ctx.root, encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', QUALITY_BASE_SHA: ctx.base, ...env },
  });
}

function mustFail(result, pattern) {
  assert.equal(result.status, 1, result.stdout + '\n' + result.stderr);
  assert.match(result.stderr, pattern);
}

await test('accepts unchanged warning identities and unchanged controls', t => {
  const ctx = fixture(t);
  const result = run(ctx);
  assert.equal(result.status, 0, result.stderr);
});

await test('permits reductions in the existing warning count', t => {
  const ctx = fixture(t);
  save(ctx.root, 'config/lint-warning-baseline.json', [{ ...warning, count: 1 }]);
  commit(ctx.root);
  const result = run(ctx);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 warnings removed/);
});

await test('blocks new warning identities at the same overall count', t => {
  const ctx = fixture(t);
  save(ctx.root, 'config/lint-warning-baseline.json', [{ ...warning, code: 'react/rules-of-hooks' }]);
  commit(ctx.root);
  mustFail(run(ctx), /New or increased warning forbidden/);
});

await test('blocks increasing an existing warning count', t => {
  const ctx = fixture(t);
  save(ctx.root, 'config/lint-warning-baseline.json', [{ ...warning, count: 3 }]);
  commit(ctx.root);
  mustFail(run(ctx), /New or increased warning forbidden/);
});

await test('blocks removal of a lint plugin', t => {
  const ctx = fixture(t);
  save(ctx.root, '.oxlintrc.json', { plugins: [], rules: { 'react/rules-of-hooks': 'error' } });
  commit(ctx.root);
  mustFail(run(ctx), /existing lint plugin removed/);
});

await test('blocks lowering lint rule severity', t => {
  const ctx = fixture(t);
  save(ctx.root, '.oxlintrc.type-aware.json', { plugins: ['typescript'], rules: { 'typescript/no-floating-promises': 'off' } });
  commit(ctx.root);
  mustFail(run(ctx), /lint rules weakened/);
});

await test('blocks introducing new lint ignore patterns', t => {
  const ctx = fixture(t);
  save(ctx.root, '.oxlintrc.json', {
    plugins: ['react'], rules: { 'react/rules-of-hooks': 'error' }, ignorePatterns: ['src/**'],
  });
  commit(ctx.root);
  mustFail(run(ctx), /lint exclusions/);
});

await test('blocks disabling strict TypeScript', t => {
  const ctx = fixture(t);
  save(ctx.root, 'tsconfig.json', { compilerOptions: { strict: false, noEmit: true } });
  commit(ctx.root);
  mustFail(run(ctx), /TypeScript check weakened/);
});

await test('blocks adding TypeScript exclusion globs', t => {
  const ctx = fixture(t);
  save(ctx.root, 'tsconfig.m5-tests.json', {
    extends: './tsconfig.json', compilerOptions: { noEmit: true }, exclude: ['src/**'],
  });
  commit(ctx.root);
  mustFail(run(ctx), /new TypeScript exclusion/);
});

await test('blocks replacing lint command with a green shortcut', t => {
  const ctx = fixture(t);
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts.lint = 'echo green';
  save(ctx.root, 'package.json', pkg);
  commit(ctx.root);
  mustFail(run(ctx), /Mandatory package.json quality gate changed/);
});

await test('blocks removal of a leaf from the canonical verification chain', t => {
  const ctx = fixture(t);
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts['verify:m6'] = 'npm run lint && npm run test:typecheck:m5';
  save(ctx.root, 'package.json', pkg);
  commit(ctx.root);
  mustFail(run(ctx), /Mandatory verification leaf removed/);
});

await test('blocks newly added source suppression comments', t => {
  const ctx = fixture(t);
  save(ctx.root, 'src/App.tsx', '// oxlint-disable react/rules-of-hooks\nexport const safe = true;\n');
  commit(ctx.root);
  mustFail(run(ctx), /New lint\/typecheck\/coverage suppression is forbidden/);
});

await test('fails closed if a PR does not provide its real base SHA', t => {
  const ctx = fixture(t);
  mustFail(run(ctx, { QUALITY_BASE_SHA: '' }), /requires QUALITY_BASE_SHA/);
});

await test('fails closed if the comparison commit cannot be read', t => {
  const ctx = fixture(t);
  mustFail(run(ctx, { QUALITY_BASE_SHA: 'a'.repeat(40) }), /comparison commit unavailable/);
});

await test('checks the first parent of merged main in push CI', t => {
  const ctx = fixture(t);
  save(ctx.root, 'config/lint-warning-baseline.json', [{ ...warning, count: 3 }]);
  commit(ctx.root);
  mustFail(run(ctx, { QUALITY_BASE_SHA: '', GITHUB_EVENT_NAME: 'push' }), /New or increased warning forbidden/);
});
