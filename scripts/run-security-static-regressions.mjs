import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
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

const toolBytes = Buffer.from('trusted security binary archive');
const archiveTool = {
  binary: 'security-tool',
  version: '1.0.0',
  url: 'https://example.invalid/security-tool.tar.gz',
  sha256: createHash('sha256').update(toolBytes).digest('hex'),
};
const response = (status, contents = toolBytes) => new Response(contents, { status });

void test('retries temporary 504 then verifies the downloaded archive checksum', async () => {
  let requests = 0;
  const pauses = [];
  const bytes = await fetchVerifiedToolArchive(archiveTool, async () => {
    requests += 1;
    return requests === 1 ? response(504) : response(200);
  }, async ms => { pauses.push(ms); });
  assert.deepEqual(bytes, toolBytes);
  assert.equal(requests, 2);
  assert.deepEqual(pauses, [300]);
});

void test('retries connection failure and 503 within the bounded attempt budget', async () => {
  let attempts = 0;
  const pauses = [];
  const bytes = await fetchVerifiedToolArchive(archiveTool, async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('Connection reset');
    return attempts === 2 ? response(503) : response(200);
  }, async ms => { pauses.push(ms); });
  assert.deepEqual(bytes, toolBytes);
  assert.equal(attempts, 3);
  assert.deepEqual(pauses, [300, 1000]);
});

void test('fails closed on non-transient HTTP errors without retrying', async () => {
  let requests = 0;
  await assert.rejects(fetchVerifiedToolArchive(archiveTool, async () => {
    requests += 1;
    return response(403);
  }, async () => { throw new Error('No retry should occur'); }), /HTTP 403/);
  assert.equal(requests, 1);
});

void test('fails closed when every bounded retry returns HTTP 504', async () => {
  let requests = 0;
  const pauses = [];
  await assert.rejects(fetchVerifiedToolArchive(archiveTool, async () => {
    requests += 1;
    return response(504);
  }, async ms => { pauses.push(ms); }), /HTTP 504/);
  assert.equal(requests, 4);
  assert.deepEqual(pauses, [300, 1000, 2500]);
});

void test('never accepts an archive with the wrong SHA-256 even after a successful HTTP response', async () => {
  let requests = 0;
  await assert.rejects(fetchVerifiedToolArchive(archiveTool, async () => {
    requests += 1;
    return response(200, Buffer.from('tampered archive'));
  }, async () => { throw new Error('No retry on integrity failure'); }), /checksum mismatch/);
  assert.equal(requests, 1);
});
