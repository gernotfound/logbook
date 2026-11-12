import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const forbiddenCredentials = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_TOKEN', 'CF_API_KEY'];
for (const key of forbiddenCredentials) {
  if (process.env[key]) throw new Error('Temporary Cloudflare test must run without Cloudflare account credentials');
}

const sandbox = mkdtempSync(join(tmpdir(), 'thelogbook-cf00-cloudflare-temp-'));
const secret = randomBytes(32).toString('hex');
const secretFile = join(sandbox, 'probe-secret.json');
writeFileSync(secretFile, JSON.stringify({ CF00_PROBE_SECRET: secret }), { mode: 0o600, flag: 'wx' });

function checkResult(body, algorithm) {
  assert.equal(body.algorithm, algorithm === 'pbkdf2' ? 'pbkdf2-sha256' : 'scrypt');
  assert.equal(body.outputBits, 256);
  // Cloudflare deliberately freezes in-Worker clocks during CPU-only work.
  assert.ok(Number.isFinite(body.wallMs) && body.wallMs >= 0);
  assert.equal(Object.hasOwn(body, 'hash'), false);
  if (algorithm === 'pbkdf2') assert.equal(body.workFactor, 600000);
  else assert.deepEqual([body.N, body.r, body.p], [16384, 8, 5]);
}

async function requestWithBoundedRetries(url, headers) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { method: 'POST', headers, signal: AbortSignal.timeout(20000) });
    } catch (error) {
      lastError = error;
    }
    if (response?.status === 200) return response;
    if (response && ![404, 502, 503, 504].includes(response.status)) {
      const data = await response.clone().json().catch(() => null);
      const category = typeof data?.category === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(data.category)
        ? data.category : 'unspecified';
      const hint = typeof data?.hint === 'string'
        ? data.hint.replace(/https?:\/\/[^\s]+/g, '[url]').slice(0, 160) : '';
      throw new Error('Remote Worker HTTP ' + response.status + ', error='
        + (data?.error === 'kdf-runtime-failure' ? 'kdf-runtime-failure/' : 'non-kdf/')
        + category + ', hint=' + hint);
    }
    if (response) lastError = new Error('Remote Worker unavailable (HTTP ' + response.status + ')');
    if (attempt < 4) await sleep(1200);
  }
  throw lastError;
}

try {
  // Output contains a bearer claim URL. Capture it, but never print or persist it.
  const args = ['--yes', 'wrangler@4.159.0', 'deploy', '--temporary', '--strict',
    '--config', 'cloudflare/cf00/wrangler.temporary.jsonc', '--secrets-file', secretFile];
  const environment = { ...process.env, HOME: sandbox, XDG_CONFIG_HOME: join(sandbox, 'config'),
    WRANGLER_SEND_METRICS: 'false', CI: 'true' };
  delete environment.CLOUDFLARE_ACCOUNT_ID;
  delete environment.CF_ACCOUNT_ID;
  const deploy = spawnSync('npx', args, {
    cwd: root, env: environment, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024,
  });
  if (deploy.error) throw new Error('Temporary Cloudflare deploy process failed: ' + deploy.error.code);
  if (deploy.status !== 0) {
    const response = String(deploy.stdout ?? '') + String(deploy.stderr ?? '');
    const category = /429|rate.limit|too many requests/i.test(response) ? 'provider-rate-limit'
      : /not authorized|authentication|permission|credentials/i.test(response) ? 'provider-authorization'
        : 'provider-or-tool-failure';
    throw new Error('Temporary Cloudflare deploy failed (' + category + ', exit ' + deploy.status + '). Raw provider output withheld because it may include claim credentials.');
  }
  const captured = String(deploy.stdout ?? '') + '\n' + String(deploy.stderr ?? '');
  const found = captured.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev\b/i);
  if (!found) throw new Error('No temporary workers.dev endpoint returned (raw output suppressed)');
  const origin = new URL(found[0]);
  assert.equal(origin.protocol, 'https:');
  assert.ok(origin.hostname.endsWith('.workers.dev'));

  const headers = { 'x-cf00-secret': secret };
  const unauthorized = await fetch(new URL('/__cf00/health', origin),
    { method: 'POST', signal: AbortSignal.timeout(10000) });
  assert.equal(unauthorized.status, 404, 'Worker must deny requests before authentication');

  const health = await requestWithBoundedRetries(new URL('/__cf00/health', origin), headers);
  const healthStatus = await health.json();
  assert.deepEqual(healthStatus, { ready: true, durableObjectBinding: true, d1Binding: false });
  console.log('CF00 temporary remote Worker entrypoint: PASS; DO binding present, D1 absent');

  const results = {};
  const failures = [];
  for (const algorithm of ['pbkdf2', 'scrypt']) {
    const started = performance.now();
    try {
      const response = await requestWithBoundedRetries(
        new URL('/__cf00/password?algorithm=' + algorithm, origin), headers);
      const body = await response.json();
      checkResult(body, algorithm);
      results[algorithm] = { roundTripMs: performance.now() - started, workerClockMs: body.wallMs };
    } catch (error) {
      if (algorithm === 'pbkdf2'
        && error.message.includes('kdf-runtime-failure/NotSupportedError')
        && error.message.includes('iteration counts above 100000')) {
        console.log('CF00 temporary remote PBKDF2 600000: runtime rejects iterations above 100000 (known incompatibility, no work-factor downgrade).');
        continue;
      }
      failures.push(algorithm);
      console.error('CF00 temporary remote ' + algorithm + ' FAIL: ' + error.message);
    }
  }
  assert.ok(Object.hasOwn(results, 'scrypt'), 'Secure scrypt must execute successfully remotely');
  for (const [algorithm, result] of Object.entries(results)) {
    console.log('CF00 temporary remote ' + algorithm + ': external round-trip ms='
      + result.roundTripMs.toFixed(1) + ', in-Worker clock delta=' + result.workerClockMs.toFixed(1));
  }
  console.log('External round-trip includes network overhead; neither measurement is provider CPU time.');
  console.log('Temporary account was not claimed; its resources expire automatically.');
  assert.deepEqual(failures, [], 'All unanticipated KDF failures must be resolved');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
