import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fetchToolArchive, scanRange } from './run-security-static.mjs';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

void test('Gitleaks scans from the explicit base and fails closed when that base is missing', () => {
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

const scanner = { binary: 'scanner', version: '1.0', url: 'https://example.invalid/scanner' };

void test('scanner download retries a transient gateway error with the same pinned URL', async () => {
  const calls = [];
  const waits = [];
  const archive = await fetchToolArchive(scanner, async (url, options) => {
    calls.push({ url, redirect: options.redirect, signal: options.signal });
    return calls.length === 1
      ? new Response('', { status: 504 })
      : new Response('pinned archive', { status: 200 });
  }, async ms => { waits.push(ms); });

  assert.equal(archive.toString(), 'pinned archive');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url === scanner.url && call.redirect === 'follow' && call.signal instanceof AbortSignal));
  assert.deepEqual(waits, [1_000]);
});

void test('scanner download remains blocking after all transient retries', async () => {
  let calls = 0;
  await assert.rejects(fetchToolArchive(scanner, async () => {
    calls += 1;
    return new Response('', { status: 504 });
  }, async () => {}), /Unable to download scanner 1.0: HTTP 504/);
  assert.equal(calls, 3);
});

void test('scanner download does not retry permanent HTTP failures', async () => {
  let calls = 0;
  await assert.rejects(fetchToolArchive(scanner, async () => {
    calls += 1;
    return new Response('', { status: 404 });
  }, async () => {}), /Unable to download scanner 1.0: HTTP 404/);
  assert.equal(calls, 1);
});

void test('scanner download retries a transient transport exception', async () => {
  let calls = 0;
  const archive = await fetchToolArchive(scanner, async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('temporary network failure');
    return new Response('recovered archive', { status: 200 });
  }, async () => {});
  assert.equal(archive.toString(), 'recovered archive');
  assert.equal(calls, 2);
});
