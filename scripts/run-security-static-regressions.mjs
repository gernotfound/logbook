import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { extractVerifiedToolBinary, fetchVerifiedToolArchive, scanRange } from './run-security-static.mjs';

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
const archiveResponse = (status, bytes = trustedBytes, headers = {}) => new Response(bytes, { status, headers });

void test('security tool download uses the pinned release asset on success', async () => {
  let calls = 0;
  const bytes = await fetchVerifiedToolArchive(downloadedTool, async (url, options) => {
    calls += 1;
    assert.equal(url, downloadedTool.url);
    assert.equal(options.redirect, 'follow');
    assert.equal(options.signal instanceof AbortSignal, true);
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

void test('archive download rejects oversized content-length and streamed payloads', async () => {
  await assert.rejects(
    fetchVerifiedToolArchive(downloadedTool, async () => archiveResponse(200, trustedBytes, { 'content-length': '999999999' })),
    /download size limit/,
  );
  await assert.rejects(
    fetchVerifiedToolArchive(downloadedTool, async () => archiveResponse(200, trustedBytes), { maxBytes: 8 }),
    /download size limit/,
  );
  assert.deepEqual(
    await fetchVerifiedToolArchive(downloadedTool, async () => archiveResponse(200), { maxBytes: trustedBytes.length }),
    trustedBytes,
  );
});

void test('download timeout aborts a stalled request without skipping the scanner', async () => {
  await assert.rejects(
    fetchVerifiedToolArchive(
      { ...downloadedTool, assetApiUrl: undefined },
      async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
      { timeoutMs: 10 },
    ),
    /timed out|abort/i,
  );
});

void test('scanner installer writes only the selected archive member', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logbook-scanner-extract-'));
  try {
    const source = join(directory, 'source');
    const target = join(directory, 'target');
    mkdirSync(source);
    mkdirSync(target);
    const expected = Buffer.from('fixture executable bytes');
    writeFileSync(join(source, 'fixture-scanner'), expected);
    writeFileSync(join(source, 'unwanted.txt'), 'not an executable');
    const archive = execFileSync('tar', ['-czf', '-', '-C', source, 'fixture-scanner', 'unwanted.txt']);
    const installed = await extractVerifiedToolBinary({ ...downloadedTool, archive: 'scanner.tar.gz' }, target, archive);
    assert.equal(installed, join(target, 'fixture-scanner'));
    assert.deepEqual(readFileSync(installed), expected);
    assert.equal(existsSync(join(target, 'unwanted.txt')), false, 'other archive members must never be written');
    await assert.rejects(
      extractVerifiedToolBinary({ ...downloadedTool, archive: 'scanner.tar.gz' }, target, archive),
      { code: 'EEXIST' },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('scanner installer rejects missing and malformed archive members without writing a binary', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'logbook-scanner-reject-'));
  try {
    const source = join(directory, 'source');
    const target = join(directory, 'target');
    mkdirSync(source);
    mkdirSync(target);
    writeFileSync(join(source, 'unwanted.txt'), 'not the requested executable');
    const archive = execFileSync('tar', ['-czf', '-', '-C', source, 'unwanted.txt']);
    const tool = { ...downloadedTool, archive: 'scanner.tar.gz' };
    await assert.rejects(extractVerifiedToolBinary(tool, target, archive), /Unable to extract verified/);
    await assert.rejects(extractVerifiedToolBinary(tool, target, Buffer.from('not an archive')), /Unable to extract verified/);
    assert.equal(existsSync(join(target, 'fixture-scanner')), false);
    await assert.rejects(
      extractVerifiedToolBinary({ ...tool, binary: '../escape' }, target, archive),
      /Invalid security scanner executable name/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
