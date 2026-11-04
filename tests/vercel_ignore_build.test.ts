import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const command = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/vercel-ignore-build.mjs');
const dirs: string[] = [];

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-vercel-git-'));
  dirs.push(dir);
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const pkg = (version: string, script = 'build') => ({
    name: 'logbook', version, scripts: { build: script }, dependencies: { firebase: '13.1.0' },
  });
  const lock = (version: string, dep = '13.1.0') => ({
    name: 'logbook', version, lockfileVersion: 3, packages: {
      '': { name: 'logbook', version, dependencies: { firebase: '13.1.0' } },
      'node_modules/firebase': { version: dep },
    },
  });
  const put = (path: string, content: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content, 'utf8');
  };
  const writePackages = (version: string, script?: string, dep?: string) => {
    put('package.json', JSON.stringify(pkg(version, script)));
    put('package-lock.json', JSON.stringify(lock(version, dep)));
  };
  const commit = () => {
    run('add', '.');
    run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
    return run('rev-parse', 'HEAD');
  };
  run('init', '-q');
  writePackages('2.169.0');
  put('api/health.ts', 'export const ok = true;');
  const previous = commit();
  const verify = (current: string, previousSha = previous) => spawnSync(
    process.execPath, [command], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: previousSha, VERCEL_GIT_COMMIT_SHA: current },
    },
  );
  return { put, writePackages, commit, verify, previous };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('Vercel backend-only Git deployment guard', () => {
  it('skips only a valid root PWA version bump', () => {
    const f = fixture();
    f.writePackages('2.170.0');
    expect(f.verify(f.commit()).status).toBe(0);
  });
  it('deploys when package scripts change despite a version bump', () => {
    const f = fixture();
    f.writePackages('2.170.0', 'vite build');
    expect(f.verify(f.commit()).status).toBe(1);
  });
  it('deploys when a nested lockfile dependency changes', () => {
    const f = fixture();
    f.writePackages('2.170.0', 'build', '13.2.0');
    expect(f.verify(f.commit()).status).toBe(1);
  });
  it('deploys when backend source changes despite version-only packages', () => {
    const f = fixture();
    f.writePackages('2.170.0');
    f.put('api/health.ts', 'export const ok = false;');
    expect(f.verify(f.commit()).status).toBe(1);
  });
  it('deploys if the package versions are inconsistent', () => {
    const f = fixture();
    f.writePackages('2.170.0');
    f.put('package.json', JSON.stringify({ name: 'logbook', version: '2.171.0', scripts: { build: 'build' }, dependencies: { firebase: '13.1.0' } }));
    expect(f.verify(f.commit()).status).toBe(1);
  });
  it('fails closed without a verifiable previous deployment SHA', () => {
    const f = fixture();
    f.writePackages('2.170.0');
    expect(f.verify(f.commit(), '') .status).toBe(1);
  });
});
