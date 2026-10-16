import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./vercel-ignore-build.mjs', import.meta.url));

function command(cwd, executable, args, env = process.env) {
  const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8' });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function git(cwd, ...args) {
  const result = command(cwd, 'git', args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

await test('Vercel skips only frontend-only commits relative to the last successful backend release', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'logbook-vercel-ignore-'));
  try {
    git(cwd, 'init', '--quiet');
    function commit(path, content) {
      const target = join(cwd, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      git(cwd, 'add', '--all');
      git(cwd, '-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', 'commit', '--quiet', '-m', path);
      return git(cwd, 'rev-parse', 'HEAD');
    }
    function evaluate(previousSha, currentSha) {
      return command(cwd, process.execPath, [script], {
        ...process.env,
        VERCEL_GIT_PREVIOUS_SHA: previousSha,
        VERCEL_GIT_COMMIT_SHA: currentSha,
      });
    }

    const deployed = commit('src/components/view.tsx', 'original frontend');
    const frontendOnly = commit('src/components/view.tsx', 'new frontend');
    assert.equal(evaluate(deployed, frontendOnly).status, 0, 'frontend-only changes should skip');
    assert.equal(evaluate(deployed, deployed).status, 0, 'identical SHAs should skip');

    const backend = commit('server/accountDeletion/service.ts', 'new backend behavior');
    assert.equal(evaluate(deployed, backend).status, 1, 'server changes after skipped commits must deploy');
    assert.equal(evaluate(frontendOnly, backend).status, 1, 'direct server changes must deploy');

    const legal = commit('src/lib/legalVersions.ts', 'new shared legal contract');
    assert.equal(evaluate(backend, legal).status, 1, 'shared legal versions used by the server must deploy');

    const manifest = commit('package.json', '{"version":"2.0.0"}');
    assert.equal(evaluate(legal, manifest).status, 1, 'dependency/runtime changes must deploy');

    assert.equal(evaluate('', manifest).status, 1, 'missing deployment baseline must fail open to deploy');
    assert.equal(evaluate('not-a-git-object', manifest).status, 1, 'unreadable git history must fail open to deploy');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
