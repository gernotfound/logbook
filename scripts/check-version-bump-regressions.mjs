import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const checker = fileURLToPath(new URL('./check-version-bump.mjs', import.meta.url));
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function save(cwd, version, top = version, nested = top) {
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'logbook', version }) + '\n');
  writeFileSync(join(cwd, 'package-lock.json'), JSON.stringify({
    name: 'logbook', version: top, lockfileVersion: 3, packages: { '': { name: 'logbook', version: nested } },
  }) + '\n');
}
function commit(cwd) {
  git(cwd, 'add', '-A');
  git(cwd, '-c', 'user.name=VersionTest', '-c', 'user.email=version@example.invalid', 'commit', '-qm', 'fixture');
}
function setup(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'logbook-version-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '-q');
  save(cwd, '1.162.0');
  commit(cwd);
  return { cwd, base: git(cwd, 'rev-parse', 'HEAD') };
}
function run(ctx, extra = {}) {
  return spawnSync(process.execPath, [checker], {
    cwd: ctx.cwd, encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', LOGBOOK_VERSION_BASE_SHA: ctx.base, ...extra },
  });
}
await test('allows the exact minor bump and matching lockfile roots without mutations', t => {
  const ctx = setup(t);
  save(ctx.cwd, '1.163.0'); commit(ctx.cwd);
  assert.equal(run(ctx).status, 0);
  assert.equal(git(ctx.cwd, 'status', '--porcelain'), '');
});
for (const v of ['1.162.0', '1.164.0', '1.163.1', '2.163.0', 'v1.163.0']) {
  await test('rejects incorrect version ' + v, t => {
    const ctx = setup(t);
    save(ctx.cwd, v); commit(ctx.cwd);
    assert.equal(run(ctx).status, 1);
  });
}
await test('rejects a top-level lockfile mismatch', t => {
  const ctx = setup(t);
  save(ctx.cwd, '1.163.0', '1.162.0'); commit(ctx.cwd);
  assert.equal(run(ctx).status, 1);
});
await test('rejects a nested lockfile mismatch', t => {
  const ctx = setup(t);
  save(ctx.cwd, '1.163.0', '1.163.0', '1.162.0'); commit(ctx.cwd);
  assert.equal(run(ctx).status, 1);
});
await test('requires an exact base on pull requests', t => {
  const ctx = setup(t);
  save(ctx.cwd, '1.163.0'); commit(ctx.cwd);
  const result = run(ctx, { LOGBOOK_VERSION_BASE_SHA: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing PR base/);
});
await test('rejects unknown base commits', t => {
  const ctx = setup(t);
  save(ctx.cwd, '1.163.0'); commit(ctx.cwd);
  assert.equal(run(ctx, { LOGBOOK_VERSION_BASE_SHA: '0'.repeat(40) }).status, 1);
});
