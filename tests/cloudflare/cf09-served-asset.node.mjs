import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { matchesServedCloudflareAsset } from '../../scripts/verify-cloudflare-served-asset.mjs';

const expected = Buffer.from('User-agent: *\nAllow: /\n\nSitemap: https://thelogbook.me/sitemap.xml\n');
const managed = [
  '# As a condition of accessing this website, you agree to abide by the following',
  '# content signals:',
  '',
  '# BEGIN Cloudflare Managed content',
  '',
  'User-agent: *',
  'Content-Signal: search=yes,ai-train=no,use=reference',
  'Allow: /',
  '',
  'User-agent: GPTBot',
  'Disallow: /',
  '',
  '# END Cloudflare Managed Content',
  '',
  '',
].join('\n');
const response = Buffer.concat([Buffer.from(managed), expected]);

void test('strict byte identity applies to HTML, SW, manifest and other static files', () => {
  for (const pathname of ['/', '/sw.js', '/manifest.webmanifest', '/sitemap.xml', '/assets/app-123.js']) {
    assert.equal(matchesServedCloudflareAsset(pathname, expected, expected), true);
    assert.equal(matchesServedCloudflareAsset(pathname, expected, response), false);
    assert.equal(matchesServedCloudflareAsset(pathname, expected, Buffer.concat([expected, Buffer.from('x')])), false);
  }
});

void test('robots.txt permits the observed Cloudflare managed header only with exact app suffix', () => {
  assert.equal(matchesServedCloudflareAsset('/robots.txt', expected, expected), true);
  assert.equal(matchesServedCloudflareAsset('/robots.txt', expected, response), true);
});

void test('robots.txt rejects changed content, forged wrappers, missing markers and oversized prefixes', () => {
  const variants = [
    Buffer.concat([Buffer.from(managed), Buffer.from('User-agent: *\nDisallow: /\n')]),
    Buffer.concat([response, Buffer.from('\nUser-agent: *\nDisallow: /')]),
    Buffer.from(managed.replace('the following', 'the') + expected),
    Buffer.from(managed.replace('# BEGIN Cloudflare Managed content', '# BEGIN Other content') + expected),
    Buffer.from(managed.replace('# END Cloudflare Managed Content', '# END Other Content') + expected),
    Buffer.from(managed.replace('ai-train=no', 'ai-train=yes') + expected),
    Buffer.from(managed.replace('# END Cloudflare Managed Content', '# END Cloudflare Managed Content\n# END Cloudflare Managed Content') + expected),
    Buffer.from(managed.replace('# BEGIN Cloudflare Managed content', '# BEGIN Cloudflare Managed content\n# BEGIN Cloudflare Managed content') + expected),
    Buffer.concat([Buffer.from(managed), Buffer.alloc(9000, 0x20), expected]),
    Buffer.concat([Buffer.from(managed), Buffer.from([0xff]), expected]),
  ];
  for (const [index, variant] of variants.entries()) {
    assert.equal(matchesServedCloudflareAsset('/robots.txt', expected, variant), false, `rejected variant ${index}`);
  }
  assert.equal(matchesServedCloudflareAsset('/robots.txt', expected, Buffer.from('')), false);
});

void test('CLI preserves explicit exit codes for valid and corrupted served assets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cf09-served-asset-'));
  const script = fileURLToPath(new URL('../../scripts/verify-cloudflare-served-asset.mjs', import.meta.url));
  const expectedFile = join(directory, 'expected.txt');
  const servedFile = join(directory, 'served.txt');
  try {
    writeFileSync(expectedFile, expected);
    writeFileSync(servedFile, response);
    const valid = spawnSync(process.execPath, [script, '/robots.txt', expectedFile, servedFile]);
    assert.equal(valid.status, 0, valid.stderr.toString());
    const invalidRoute = spawnSync(process.execPath, [script, '/sitemap.xml', expectedFile, servedFile]);
    assert.equal(invalidRoute.status, 1);
    writeFileSync(servedFile, Buffer.from('not the app'));
    const invalid = spawnSync(process.execPath, [script, '/robots.txt', expectedFile, servedFile]);
    assert.equal(invalid.status, 1);
    const missing = spawnSync(process.execPath, [script, '/robots.txt', expectedFile, join(directory, 'absent')]);
    assert.equal(missing.status, 1);
    const misuse = spawnSync(process.execPath, [script, '/robots.txt']);
    assert.equal(misuse.status, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
