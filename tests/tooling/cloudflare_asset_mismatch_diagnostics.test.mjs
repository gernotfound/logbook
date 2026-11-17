import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve('scripts/cloudflare-asset-mismatch-diagnostics.sh');
const expectedBytes = 'the-current-service-worker';
const oldBytes = 'a-stale-service-worker';

async function runDiagnostic(retryResponse) {
  const dir = mkdtempSync(join(tmpdir(), 'thelogbook-cloudflare-diagnostic-'));
  const expected = join(dir, 'expected.js');
  const observed = join(dir, 'served.js');
  const headers = join(dir, 'headers.txt');
  writeFileSync(expected, expectedBytes);
  writeFileSync(observed, oldBytes);
  writeFileSync(headers, 'HTTP/2 200\r\nContent-Type: application/javascript\r\nCF-Cache-Status: HIT\r\nSet-Cookie: forbidden-output\r\n');

  const urls = [];
  const server = createServer((request, response) => {
    urls.push(request.url);
    response.writeHead(200, {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-store',
      'CF-Cache-Status': 'MISS',
    });
    response.end(retryResponse(urls.length));
  });

  try {
    await new Promise((done, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', done);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const result = await new Promise((done, fail) => {
      const child = spawn('bash', [
        script, expected, observed, headers, origin + '/sw.js',
        '0123456789abcdef0123456789abcdef01234567', '200 application/javascript',
      ], {
        env: { ...process.env, CLOUDFLARE_DIAG_RETRY_DELAY_SECONDS: '0' },
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
    await new Promise(done => server.close(done));
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Cloudflare exact-asset mismatch diagnostics', () => {
  it('reports hashes, selected cache metadata and persistent wrong bytes without exposing cookies', async () => {
    const result = await runDiagnostic(() => oldBytes);
    expect(result.code).toBe(1);
    expect(result.urls).toEqual([
      '/sw.js',
      '/sw.js?__logbook_diagnostic=0123456789abcdef0123456789abcdef01234567',
    ]);
    expect(result.stdout).toContain('Initial HTTP: 200 application/javascript');
    expect(result.stdout).toContain(createHash('sha256').update(expectedBytes).digest('hex'));
    expect(result.stdout).toContain(createHash('sha256').update(oldBytes).digest('hex'));
    expect(result.stdout).toContain('CF-Cache-Status: HIT');
    expect(result.stdout).toContain('exact: byte mismatch persists');
    expect(result.stdout).toContain('cache-busted: byte mismatch persists');
    expect(result.stdout).toContain('Deployment rejected');
    expect(result.stdout).not.toContain('forbidden-output');
    expect(result.stderr).toBe('');
  });

  it('still fails when the content recovers on the next request', async () => {
    const result = await runDiagnostic(() => expectedBytes);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('exact: bytes recovered; the initial mismatch still fails this deployment');
    expect(result.stdout).toContain('cache-busted: bytes recovered; the initial mismatch still fails this deployment');
    expect(result.stdout).toContain('Deployment rejected');
  });
});
