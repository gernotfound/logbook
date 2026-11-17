import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { warningIdentity } from './lint-warning-identity.mjs';

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
  save(root, '.oxlintrc.type-aware.json', {
    plugins: ['typescript'], options: { typeAware: true },
    rules: { 'typescript/no-floating-promises': 'error' },
  });
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

await test('identifies warnings independently of JSON property order without hiding new warnings', t => {
  const reordered = {
    count: warning.count, source: warning.source, message: warning.message,
    code: warning.code, file: warning.file, suite: warning.suite,
  };
  assert.equal(warningIdentity(reordered), JSON.stringify([
    'default', 'src/App.tsx', 'react(set-state-in-effect)',
    'Reviewed warning', 'setVisible(false);',
  ]));
  assert.equal(warningIdentity(reordered), warningIdentity(warning));
  assert.notEqual(warningIdentity({ ...reordered, source: 'setVisible(true);' }), warningIdentity(warning));

  const ctx = fixture(t);
  save(ctx.root, 'config/lint-warning-baseline.json', [reordered]);
  commit(ctx.root);
  assert.equal(run(ctx).status, 0);
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


await test('a11y lint catches concrete failures of every configured rule', t => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-a11y-lint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oxlint = fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url));
  const config = fileURLToPath(new URL('../.oxlintrc.a11y.json', import.meta.url));
  const cases = {
    'alt-text': '<img src="image.png" />',
    'anchor-has-content': '<a href="/path" />',
    'aria-props': '<div aria-unknown="value" />',
    'aria-role': '<div role="invalid-role" />',
    'aria-unsupported-elements': '<meta aria-label="invalid" />',
    'heading-has-content': '<h2 />',
    'label-has-associated-control': '<label>Unassociated field</label>',
    'role-has-required-aria-props': '<div role="checkbox" />',
  };
  const runCase = (jsx) => {
    save(root, 'case.tsx', 'export const Example = () => (' + jsx + ');\n');
    return spawnSync(process.execPath, [oxlint, '--config', config, '--format=json', 'case.tsx'], {
      cwd: root, encoding: 'utf8',
    });
  };
  for (const [rule, jsx] of Object.entries(cases)) {
    const result = runCase(jsx);
    assert.equal(result.status, 1, rule + ' must reject invalid JSX: ' + result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.ok(report.diagnostics?.some(entry => String(entry.code).includes(rule)),
      rule + ' was not actually executed: ' + result.stdout);
  }
  const valid = runCase('<div><label htmlFor="field">Name</label><input id="field" /><label>Consent<input type="checkbox" /></label><label><input type="radio" /><span><strong>Calcolo da misure</strong></span></label></div>');
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
});

await test('default React lint executes the hook and Fast Refresh rules with their configured severities', t => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-react-lint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oxlint = fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url));
  const config = fileURLToPath(new URL('../.oxlintrc.json', import.meta.url));
  const runCase = source => {
    save(root, 'case.tsx', source);
    const result = spawnSync(process.execPath, [oxlint, '--config', config, '--format=json', 'case.tsx'], {
      cwd: root, encoding: 'utf8',
    });
    assert.ok(result.stdout, result.stderr);
    return { result, diagnostics: JSON.parse(result.stdout).diagnostics ?? [] };
  };

  const invalidHooks = runCase(
    "import { useState } from 'react'; export function Example({ enabled }: { enabled: boolean }) { if (enabled) useState(0); return <div />; }",
  );
  assert.equal(invalidHooks.result.status, 1, invalidHooks.result.stdout + invalidHooks.result.stderr);
  assert.ok(invalidHooks.diagnostics.some(item =>
    String(item.code).includes('rules-of-hooks') && item.severity === 'error'),
  'Conditional hooks must be rejected by the configured rule');

  const unsafeExport = runCase('export const helper = () => 1; export const Example = () => <div />;');
  assert.equal(unsafeExport.result.status, 0, unsafeExport.result.stdout + unsafeExport.result.stderr);
  assert.ok(unsafeExport.diagnostics.some(item =>
    String(item.code).includes('only-export-components') && item.severity === 'warning'),
  'Non-component exports must trigger the configured Fast Refresh warning');

  const valid = runCase(
    "import { useState } from 'react'; export const VERSION = '1'; export function Example() { const [count] = useState(0); return <div>{count}</div>; }",
  );
  assert.equal(valid.result.status, 0, valid.result.stdout + valid.result.stderr);
  assert.equal(valid.diagnostics.filter(item =>
    /rules-of-hooks|only-export-components/.test(String(item.code))).length, 0,
  'Top-level hooks and allowed constant exports must remain valid');
});

await test('blocks removal of a lint plugin', t => {
  const ctx = fixture(t);
  save(ctx.root, '.oxlintrc.json', { plugins: [], rules: { 'react/rules-of-hooks': 'error' } });
  commit(ctx.root);
  mustFail(run(ctx), /existing lint plugin removed/);
});

await test('blocks lowering lint rule severity', t => {
  const ctx = fixture(t);
  save(ctx.root, '.oxlintrc.type-aware.json', {
    plugins: ['typescript'], options: { typeAware: true },
    rules: { 'typescript/no-floating-promises': 'off' },
  });
  commit(ctx.root);
  mustFail(run(ctx), /lint rules weakened/);
});

await test('blocks downgrading the type-aware Promise rule from error to warning', t => {
  const ctx = fixture(t);
  save(ctx.root, '.oxlintrc.type-aware.json', {
    plugins: ['typescript'], options: { typeAware: true },
    rules: { 'typescript/no-floating-promises': 'warn' },
  });
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

function dedicatedLeafFixture(t) {
  const ctx = fixture(t);
  save(ctx.root, 'tests/m7_account_deletion_api.test.ts', "import { it, expect } from 'vitest';\nit('checks the deletion API', () => expect(1).toBe(1));\n");
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts['test:m7'] = 'vitest run tests/m7_account_deletion_api.test.ts';
  pkg.scripts['verify:m8'] += ' && npm run test:m7';
  save(ctx.root, 'package.json', pkg);
  commit(ctx.root);
  return { ...ctx, base: git(ctx.root, 'rev-parse', 'HEAD') };
}

await test('preserves mandatory Vitest coverage when a test is Git-renamed into a domain folder', t => {
  const ctx = dedicatedLeafFixture(t);
  mkdirSync(join(ctx.root, 'tests/account/deletion'), { recursive: true });
  renameSync(join(ctx.root, 'tests/m7_account_deletion_api.test.ts'), join(ctx.root, 'tests/account/deletion/m7_account_deletion_api.test.ts'));
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts['test:m7'] = 'vitest run tests/account/deletion/m7_account_deletion_api.test.ts';
  save(ctx.root, 'package.json', pkg);
  commit(ctx.root);
  const result = run(ctx);
  assert.equal(result.status, 0, result.stderr);
});

await test('rejects a moved verification command when the original test was only copied', t => {
  const ctx = dedicatedLeafFixture(t);
  save(ctx.root, 'tests/account/deletion/m7_account_deletion_api.test.ts', readFileSync(join(ctx.root, 'tests/m7_account_deletion_api.test.ts'), 'utf8'));
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts['test:m7'] = 'vitest run tests/account/deletion/m7_account_deletion_api.test.ts';
  save(ctx.root, 'package.json', pkg);
  commit(ctx.root);
  mustFail(run(ctx), /Mandatory verification leaf removed/);
});

await test('rejects renaming a mandatory test to a different basename', t => {
  const ctx = dedicatedLeafFixture(t);
  mkdirSync(join(ctx.root, 'tests/account/deletion'), { recursive: true });
  renameSync(join(ctx.root, 'tests/m7_account_deletion_api.test.ts'), join(ctx.root, 'tests/account/deletion/replacement.test.ts'));
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts['test:m7'] = 'vitest run tests/account/deletion/replacement.test.ts';
  save(ctx.root, 'package.json', pkg);
  commit(ctx.root);
  mustFail(run(ctx), /Mandatory verification leaf removed/);
});


function configuredLeafFixture(t) {
  const ctx = fixture(t);
  save(ctx.root, 'tests/isolated/m8_domain_commit.test.ts', "import { it, expect } from 'vitest';\nit('domain commit', () => expect(1).toBe(1));\n");
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts['test:m8'] = 'vitest run --config vitest.isolated.config.ts tests/isolated/m8_domain_commit.test.ts';
  pkg.scripts['verify:m8'] += ' && npm run test:m8';
  save(ctx.root, 'package.json', pkg);
  commit(ctx.root);
  return { ...ctx, base: git(ctx.root, 'rev-parse', 'HEAD') };
}

await test('preserves mandatory configured Vitest leaf when an isolated test moves into a domain folder', t => {
  const ctx = configuredLeafFixture(t);
  mkdirSync(join(ctx.root, 'tests/isolated/domain'), { recursive: true });
  renameSync(join(ctx.root, 'tests/isolated/m8_domain_commit.test.ts'), join(ctx.root, 'tests/isolated/domain/m8_domain_commit.test.ts'));
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts['test:m8'] = 'vitest run --config vitest.isolated.config.ts tests/isolated/domain/m8_domain_commit.test.ts';
  save(ctx.root, 'package.json', pkg);
  commit(ctx.root);
  const result = run(ctx);
  assert.equal(result.status, 0, result.stderr);
});

await test('rejects a configured Vitest leaf copied instead of Git-renamed', t => {
  const ctx = configuredLeafFixture(t);
  save(ctx.root, 'tests/isolated/domain/m8_domain_commit.test.ts', readFileSync(join(ctx.root, 'tests/isolated/m8_domain_commit.test.ts'), 'utf8'));
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts['test:m8'] = 'vitest run --config vitest.isolated.config.ts tests/isolated/domain/m8_domain_commit.test.ts';
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

await test('blocks disabling type-aware lint while leaving the rule text unchanged', t => {
  const ctx = fixture(t);
  save(ctx.root, '.oxlintrc.type-aware.json', {
    plugins: ['typescript'], options: { typeAware: false },
    rules: { 'typescript/no-floating-promises': 'error' },
  });
  commit(ctx.root);
  mustFail(run(ctx), /type-aware lint analysis disabled/);
});

await test('blocks introducing an oxlint ignore file that hides app source', t => {
  const ctx = fixture(t);
  save(ctx.root, '.oxlintignore', 'src/**\n');
  commit(ctx.root);
  mustFail(run(ctx), /lint ignore-file contents changed/);
});

await test('blocks disabling Oxlint implicit correctness rules', t => {
  const ctx = fixture(t);
  save(ctx.root, '.oxlintrc.json', {
    plugins: ['react'], categories: { correctness: 'off' },
    rules: { 'react/rules-of-hooks': 'error' },
  });
  commit(ctx.root);
  mustFail(run(ctx), /lint category weakened: correctness/);
});

await test('blocks newly added explicit rule suppressions', t => {
  const ctx = fixture(t);
  save(ctx.root, '.oxlintrc.json', {
    plugins: ['react'],
    rules: { 'react/rules-of-hooks': 'error', 'react/no-unknown-property': 'off' },
  });
  commit(ctx.root);
  mustFail(run(ctx), /newly disabled lint rule/);
});

await test('blocks weakening existing rule options without a policy review', t => {
  const ctx = fixture(t);
  save(ctx.root, '.oxlintrc.json', {
    plugins: ['react'],
    rules: { 'react/rules-of-hooks': ['error', { strict: true }] },
  });
  commit(ctx.root);
  const base = git(ctx.root, 'rev-parse', 'HEAD');
  save(ctx.root, '.oxlintrc.json', {
    plugins: ['react'],
    rules: { 'react/rules-of-hooks': ['error', { strict: false }] },
  });
  commit(ctx.root);
  mustFail(run({ ...ctx, base }), /existing lint rule options changed/);
});

await test('blocks noCheck even when strict and noEmit remain true', t => {
  const ctx = fixture(t);
  save(ctx.root, 'tsconfig.m7-server.json', {
    compilerOptions: { strict: true, noEmit: true, noCheck: true },
  });
  commit(ctx.root);
  mustFail(run(ctx), /full checking disabled by noCheck/);
});

await test('blocks gitignore rules that hide tracked TypeScript code from lint', t => {
  const ctx = fixture(t);
  save(ctx.root, '.gitignore', 'src/App.tsx\n');
  commit(ctx.root);
  mustFail(run(ctx), /Tracked JS\/TS files hidden from lint/);
});

await test('allows unrelated gitignore additions with no tracked JS or TS excluded', t => {
  const ctx = fixture(t);
  save(ctx.root, '.gitignore', 'dist/\n');
  commit(ctx.root);
  assert.equal(run(ctx).status, 0);
});

await test('blocks inline suppression comments on existing source lines', t => {
  const ctx = fixture(t);
  save(ctx.root, 'src/App.tsx', 'export const safe = true; // oxlint-' + 'disable-line no-console\n');
  commit(ctx.root);
  mustFail(run(ctx), /New lint\/typecheck\/coverage suppression/);
});

await test('blocks ts-expect-error comments in root-level TypeScript files', t => {
  const ctx = fixture(t);
  save(ctx.root, 'vite.config.ts', '// @ts-' + 'expect-error suppress regression\nexport const safe = true;\n');
  commit(ctx.root);
  mustFail(run(ctx), /New lint\/typecheck\/coverage suppression/);
});

await test('allows harmless reordering of existing rule-option object properties', t => {
  const ctx = fixture(t);
  save(ctx.root, '.oxlintrc.json', {
    plugins: ['react'],
    rules: { 'react/rules-of-hooks': ['error', { strict: true, mode: 'safe' }] },
  });
  commit(ctx.root);
  const base = git(ctx.root, 'rev-parse', 'HEAD');
  save(ctx.root, '.oxlintrc.json', {
    plugins: ['react'],
    rules: { 'react/rules-of-hooks': ['error', { mode: 'safe', strict: true }] },
  });
  commit(ctx.root);
  assert.equal(run({ ...ctx, base }).status, 0);
});

await test('blocks nested Oxlint configuration that overrides the root policy', t => {
  const ctx = fixture(t);
  save(ctx.root, 'src/.oxlintrc.json', { categories: { correctness: 'off' } });
  commit(ctx.root);
  mustFail(run(ctx), /additional or nested Oxlint configuration/);
});

await test('blocks newly tracked minified-looking application source', t => {
  const ctx = fixture(t);
  save(ctx.root, 'src/recovery.min.ts', 'export const recovery = true;\n');
  commit(ctx.root);
  mustFail(run(ctx), /New tracked source skipped by Oxlint minified-file defaults/);
});

await test('does not retroactively reject pre-existing minified-looking files', t => {
  const ctx = fixture(t);
  save(ctx.root, 'src/legacy.min.js', 'export const legacy = true;\n');
  commit(ctx.root);
  const base = git(ctx.root, 'rev-parse', 'HEAD');
  save(ctx.root, 'src/App.tsx', 'export const safe = 42;\n');
  commit(ctx.root);
  assert.equal(run({ ...ctx, base }).status, 0);
});


function nativeNodeBatchFixture(t) {
  const ctx = fixture(t);
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts['test:pwa:m7'] = 'node --test tests/cloudflare/first.node.mjs && node --test tests/cloudflare/second.node.mjs';
  pkg.scripts['verify:m8'] += ' && npm run test:pwa:m7';
  save(ctx.root, 'package.json', pkg);
  commit(ctx.root);
  return { ...ctx, base: git(ctx.root, 'rev-parse', 'HEAD') };
}

await test('accepts a bounded Node test batch only if each required file remains', t => {
  const ctx = nativeNodeBatchFixture(t);
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts['test:pwa:m7'] = 'node --test --test-concurrency=4 tests/cloudflare/first.node.mjs tests/cloudflare/second.node.mjs';
  save(ctx.root, 'package.json', pkg);
  assert.equal(run(ctx).status, 0);
});

await test('rejects a Node batch missing a previously mandatory suite', t => {
  const ctx = nativeNodeBatchFixture(t);
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts['test:pwa:m7'] = 'node --test --test-concurrency=4 tests/cloudflare/first.node.mjs tests/cloudflare/first.node.mjs';
  save(ctx.root, 'package.json', pkg);
  mustFail(run(ctx), /Mandatory verification leaf removed/);
});

await test('rejects a batch with unapproved Node test flags', t => {
  const ctx = nativeNodeBatchFixture(t);
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts['test:pwa:m7'] = 'node --test --test-concurrency=4 --test-skip-pattern=.* tests/cloudflare/first.node.mjs tests/cloudflare/second.node.mjs';
  save(ctx.root, 'package.json', pkg);
  mustFail(run(ctx), /Mandatory verification leaf removed/);
});

await test('rejects excessive concurrency for a mandatory Node batch', t => {
  const ctx = nativeNodeBatchFixture(t);
  const pkg = read(ctx.root, 'package.json');
  pkg.scripts['test:pwa:m7'] = 'node --test --test-concurrency=1000 tests/cloudflare/first.node.mjs tests/cloudflare/second.node.mjs';
  save(ctx.root, 'package.json', pkg);
  mustFail(run(ctx), /Mandatory verification leaf removed/);
});
