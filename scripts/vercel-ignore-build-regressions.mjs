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
    function put(path, content) {
      const target = join(cwd, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    function commit(path, content) {
      put(path, content);
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

    const initialPackage = { name: 'logbook', version: '2.169.0', scripts: { build: 'build' }, dependencies: { firebase: '13.1.0' } };
    const initialLock = {
      name: 'logbook', version: '2.169.0', lockfileVersion: 3,
      packages: {
        '': { name: 'logbook', version: '2.169.0', dependencies: { firebase: '13.1.0' } },
        'node_modules/firebase': { version: '13.1.0' },
      },
    };
    put('package.json', JSON.stringify(initialPackage));
    put('package-lock.json', JSON.stringify(initialLock));
    const deployed = commit('src/components/view.tsx', 'original frontend');
    const frontendOnly = commit('src/components/view.tsx', 'new frontend');
    assert.equal(evaluate(deployed, frontendOnly).status, 0, 'frontend-only changes should skip');
    assert.equal(evaluate(deployed, deployed).status, 0, 'identical SHAs should skip');

    // A shallow Vercel checkout only includes the current commit. The selector
    // must recover the exact prior production SHA without broadening its trust.
    const checkoutParent = mkdtempSync(join(tmpdir(), 'logbook-vercel-shallow-'));
    try {
      const checkout = join(checkoutParent, 'checkout');
      const cloned = command(checkoutParent, 'git', ['clone', '--quiet', '--depth=1', `file://${cwd}`, checkout]);
      assert.equal(cloned.status, 0, cloned.stderr);
      assert.notEqual(command(checkout, 'git', ['cat-file', '-e', `${deployed}^{commit}`]).status, 0,
        'a depth-one checkout must initially be missing the prior deployed SHA');
      const restored = command(checkout, process.execPath, [script], {
        ...process.env, VERCEL_GIT_PREVIOUS_SHA: deployed, VERCEL_GIT_COMMIT_SHA: frontendOnly,
      });
      assert.equal(restored.status, 0, `shallow frontend-only checkout should skip: ${restored.stderr}\n${restored.stdout}`);
      assert.equal(command(checkout, 'git', ['cat-file', '-e', `${deployed}^{commit}`]).status, 0,
        'the selector must fetch and verify the missing commit');

      const withoutOrigin = join(checkoutParent, 'without-origin');
      const secondClone = command(checkoutParent, 'git', ['clone', '--quiet', '--depth=1', `file://${cwd}`, withoutOrigin]);
      assert.equal(secondClone.status, 0, secondClone.stderr);
      git(withoutOrigin, 'remote', 'remove', 'origin');
      const unavailable = command(withoutOrigin, process.execPath, [script], {
        ...process.env, VERCEL_GIT_PREVIOUS_SHA: deployed, VERCEL_GIT_COMMIT_SHA: frontendOnly,
      });
      assert.equal(unavailable.status, 1, 'unverifiable prior deployment must still deploy');
    } finally {
      rmSync(checkoutParent, { recursive: true, force: true });
    }

    const backend = commit('server/accountDeletion/service.ts', 'new backend behavior');
    assert.equal(evaluate(deployed, backend).status, 1, 'server changes after skipped commits must deploy');
    assert.equal(evaluate(frontendOnly, backend).status, 1, 'direct server changes must deploy');

    const backendCheckoutParent = mkdtempSync(join(tmpdir(), 'logbook-vercel-shallow-backend-'));
    try {
      const checkout = join(backendCheckoutParent, 'checkout');
      const cloned = command(backendCheckoutParent, 'git', ['clone', '--quiet', '--depth=1', `file://${cwd}`, checkout]);
      assert.equal(cloned.status, 0, cloned.stderr);
      assert.notEqual(command(checkout, 'git', ['cat-file', '-e', `${deployed}^{commit}`]).status, 0);
      const mustDeploy = command(checkout, process.execPath, [script], {
        ...process.env, VERCEL_GIT_PREVIOUS_SHA: deployed, VERCEL_GIT_COMMIT_SHA: backend,
      });
      assert.equal(mustDeploy.status, 1, 'fetching an absent baseline must not conceal backend changes');
    } finally {
      rmSync(backendCheckoutParent, { recursive: true, force: true });
    }

    const legal = commit('src/lib/legalVersions.ts', 'new shared legal contract');
    assert.equal(evaluate(backend, legal).status, 1, 'shared legal versions used by the server must deploy');

    const config = commit('vercel.json', JSON.stringify({ functions: { 'api/test.ts': { maxDuration: 30 } } }));
    assert.equal(evaluate(legal, config).status, 1, 'Vercel function configuration changes must trigger backend deployment');

    put('package.json', JSON.stringify({ ...initialPackage, version: '2.170.0' }));
    const releaseBump = commit('package-lock.json', JSON.stringify({
      ...initialLock, version: '2.170.0',
      packages: { ...initialLock.packages, '': { ...initialLock.packages[''], version: '2.170.0' } },
    }));
    assert.equal(evaluate(config, releaseBump).status, 0, 'PWA version-only bump must not redeploy the backend');

    const changedScript = commit('package.json', JSON.stringify({
      ...initialPackage, version: '2.170.0', scripts: { build: 'vite build' },
    }));
    assert.equal(evaluate(releaseBump, changedScript).status, 1, 'changing package scripts must deploy');

    const changedDependency = commit('package-lock.json', JSON.stringify({
      ...initialLock, version: '2.170.0',
      packages: {
        ...initialLock.packages,
        '': { ...initialLock.packages[''], version: '2.170.0' },
        'node_modules/firebase': { version: '13.2.0' },
      },
    }));
    assert.equal(evaluate(changedScript, changedDependency).status, 1, 'changing lockfile dependencies must deploy');

    const manifest = commit('package.json', '{"version":"2.170.0"}');
    assert.equal(evaluate(changedDependency, manifest).status, 1, 'inconsistent package contents must deploy');

    assert.equal(evaluate('', manifest).status, 1, 'missing deployment baseline must fail open to deploy');
    assert.equal(evaluate('not-a-git-object', manifest).status, 1, 'unreadable git history must fail open to deploy');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
