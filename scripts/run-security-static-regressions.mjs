import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fetchVerifiedToolArchive, scanRange } from './run-security-static.mjs';

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

const trustedBytes = Buffer.from('pinned scanner archive fixture');
const downloadedTool = {
  binary: 'fixture-scanner',
  version: '1.0.0',
  url: 'https://github.com/vendor/scanner/releases/download/v1/scanner.tar.gz',
  assetApiUrl: 'https://api.github.com/repos/vendor/scanner/releases/assets/123',
  sha256: createHash('sha256').update(trustedBytes).digest('hex'),
};
const archiveResponse = (status, bytes = trustedBytes) => ({
  ok: status >= 200 && status < 300,
  status,
  arrayBuffer: async () => bytes,
});

void test('security tool download uses the pinned release asset on success', async () => {
  let calls = 0;
  const bytes = await fetchVerifiedToolArchive(downloadedTool, async (url, options) => {
    calls += 1;
    assert.equal(url, downloadedTool.url);
    assert.equal(options.redirect, 'follow');
    return archiveResponse(200);
  });
  assert.deepEqual(bytes, trustedBytes);
  assert.equal(calls, 1);
});

void test('HTTP 504 recovers only through the official asset API with identical SHA-256', async () => {
  const calls = [];
  const bytes = await fetchVerifiedToolArchive(downloadedTool, async (url, options) => {
    calls.push({ url, options });
    return archiveResponse(calls.length === 1 ? 504 : 200);
  });
  assert.deepEqual(bytes, trustedBytes);
  assert.deepEqual(calls.map(call => call.url), [downloadedTool.url, downloadedTool.assetApiUrl]);
  assert.equal(calls[1].options.headers.Accept, 'application/octet-stream');
  assert.equal(calls[1].options.headers['X-GitHub-Api-Version'], '2022-11-28');
});

void test('checksum mismatch fails closed without trying the alternate download', async () => {
  let calls = 0;
  await assert.rejects(
    fetchVerifiedToolArchive(downloadedTool, async () => {
      calls += 1;
      return archiveResponse(200, Buffer.from('untrusted binary'));
    }),
    /checksum mismatch/,
  );
  assert.equal(calls, 1);
});

void test('HTTP 403 and exhausted transfer failures never authorize a scanner skip', async () => {
  for (const statuses of [[403], [504, 504]]) {
    let calls = 0;
    await assert.rejects(
      fetchVerifiedToolArchive(downloadedTool, async () => archiveResponse(statuses[calls++])),
      /Unable to download.*HTTP (403|504)/,
    );
    assert.equal(calls, statuses.length);
  }
});

void test('unexpected JSON returned by GitHub asset API fails checksum verification', async () => {
  let calls = 0;
  await assert.rejects(
    fetchVerifiedToolArchive(downloadedTool, async () => {
      calls += 1;
      return calls === 1 ? archiveResponse(504) : archiveResponse(200, Buffer.from('{"message":"asset metadata"}'));
    }),
    /checksum mismatch/,
  );
  assert.equal(calls, 2);
});
