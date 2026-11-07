import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { scanRange } from './run-security-static.mjs';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

test('Gitleaks scans from the explicit base and fails closed when that base is missing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'logbook-gitleaks-range-'));
  const previousCwd = process.cwd();
  const previousBase = process.env.GITLEAKS_BASE_SHA;
  try {
    process.chdir(directory);
    git('init', '--quiet');
    writeFileSync('fixture.txt', 'first');
    git('add', 'fixture.txt');
    git('-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', 'commit', '--quiet', '-m', 'first');
    const firstSha = git('rev-parse', 'HEAD');
    writeFileSync('fixture.txt', 'second');
    git('add', 'fixture.txt');
    git('-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', 'commit', '--quiet', '-m', 'second');

    process.env.GITLEAKS_BASE_SHA = firstSha;
    assert.equal(scanRange(), `${firstSha}..HEAD`);
    process.env.GITLEAKS_BASE_SHA = 'this-ref-does-not-exist';
    assert.throws(() => scanRange(), /requested Gitleaks base commit/);
    delete process.env.GITLEAKS_BASE_SHA;
    assert.equal(scanRange(), `${firstSha}..HEAD`, 'local fallback still works when no base was supplied');
  } finally {
    process.chdir(previousCwd);
    if (previousBase === undefined) delete process.env.GITLEAKS_BASE_SHA;
    else process.env.GITLEAKS_BASE_SHA = previousBase;
    rmSync(directory, { recursive: true, force: true });
  }
});
