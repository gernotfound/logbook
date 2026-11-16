import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
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

void test('HTML navigation rejects automatic Web Analytics beacon injection from the edge', () => {
  const shell = Buffer.from('<!DOCTYPE html><html><body><main>Training</main></body></html>');
  const injected = Buffer.from('<!DOCTYPE html><html><body><main>Training</main><script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon=\'{"token":"synthetic"}\'></script></body></html>');
  for (const pathname of ['/', '/index.html']) {
    assert.equal(matchesServedCloudflareAsset(pathname, shell, shell), true);
    assert.equal(matchesServedCloudflareAsset(pathname, shell, injected), false);
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

const chunkVerifier = fileURLToPath(new URL('../../scripts/verify-cloudflare-served-chunk.sh', import.meta.url));
const smokeSha = '0123456789abcdef0123456789abcdef01234567';

async function runChunkSmoke(responses, extension = '.js') {
  const directory = mkdtempSync(join(tmpdir(), 'cf09-chunk-'));
  const folder = join(directory, 'dist', 'assets');
  mkdirSync(folder, { recursive: true });
  const relative = 'dist/assets/synthetic' + extension;
  const payload = 'synthetic-bundle-bytes';
  writeFileSync(join(directory, relative), payload);
  const urls = [];
  const server = createServer((request, response) => {
    urls.push(request.url);
    const chosen = responses[Math.min(urls.length - 1, responses.length - 1)];
    if (chosen.drop) {
      request.socket.destroy();
      return;
    }
    response.writeHead(chosen.status, { 'Content-Type': chosen.mime });
    response.end(chosen.body);
  });
  try {
    await new Promise((done, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', done);
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const result = await new Promise((done, fail) => {
      const child = spawn('bash', [chunkVerifier, relative, origin, smokeSha], {
        cwd: directory,
        env: { ...process.env, CLOUDFLARE_CHUNK_RETRY_DELAY_SECONDS: '0',
          CLOUDFLARE_DIAG_RETRY_DELAY_SECONDS: '0' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', fail);
      child.once('close', code => done({ code, stdout, stderr }));
    });
    return { ...result, urls };
  } finally {
    if (server.listening) await new Promise(done => server.close(done));
    rmSync(directory, { recursive: true, force: true });
  }
}

void test('chunk smoke tolerates a transient 404 only after checking exact JS bytes and MIME', async () => {
  const result = await runChunkSmoke([
    { status: 404, mime: 'text/html', body: 'old deployment manifest' },
    { status: 200, mime: 'application/javascript', body: 'synthetic-bundle-bytes' },
  ]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(result.urls, ['/assets/synthetic.js', '/assets/synthetic.js']);
  assert.match(result.stdout, /verified on attempt 2\/4/);
});

void test('chunk smoke rejects wrong bytes and MIME until a later exact response', async () => {
  const result = await runChunkSmoke([
    { status: 200, mime: 'application/javascript', body: 'wrong bytes' },
    { status: 200, mime: 'text/html', body: 'synthetic-bundle-bytes' },
    { status: 200, mime: 'text/javascript', body: 'synthetic-bundle-bytes' },
  ]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.urls.length, 3);
  assert.match(result.stdout, /verified on attempt 3\/4/);
});

void test('chunk smoke handles a broken connection without faking an ACK for the asset', async () => {
  const result = await runChunkSmoke([
    { drop: true },
    { status: 200, mime: 'application/javascript', body: 'synthetic-bundle-bytes' },
  ]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.urls.length, 2);
});

void test('chunk smoke accepts exact CSS only with text/css and HTTP 200', async () => {
  const result = await runChunkSmoke([
    { status: 200, mime: 'text/css', body: 'synthetic-bundle-bytes' },
  ], '.css');
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(result.urls, ['/assets/synthetic.css']);
});

void test('chunk smoke fails closed after bounded 404 retries and reports the missing asset', async () => {
  const result = await runChunkSmoke([
    { status: 404, mime: 'text/html', body: 'still missing' },
  ]);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.urls.length, 6);
  assert.match(result.stdout, /Cloudflare initial asset mismatch on .*\/assets\/synthetic.js/);
  assert.match(result.stdout, /Initial HTTP: 404 text\/html/);
  assert.match(result.stdout, /Deployment rejected/);
  assert.doesNotMatch(result.stdout, /chunk verified on attempt/);
});

void test('chunk smoke fails closed for consistently incorrect MIME even with matching bytes', async () => {
  const result = await runChunkSmoke([
    { status: 200, mime: 'text/html', body: 'synthetic-bundle-bytes' },
  ]);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.urls.length, 6);
});
