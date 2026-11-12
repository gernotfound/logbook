import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const generatedConfig = join(root, 'cloudflare/cf00/wrangler.temporary.generated.jsonc');
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


function runWrangler(args, environment, label) {
  const output = spawnSync('npx', ['--yes', 'wrangler@4.159.0', ...args], {
    cwd: root, env: environment, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
  });
  if (output.error) throw new Error(label + ' process failure: ' + output.error.code);
  const captured = String(output.stdout ?? '') + '\n' + String(output.stderr ?? '');
  if (output.status !== 0) {
    const category = /429|rate.limit|too many requests/i.test(captured) ? 'provider-rate-limit'
      : /not authorized|unauthorized|authentication|permission|credentials|access denied|403/i.test(captured)
        ? 'provider-authorization' : 'provider-or-tool-failure';
    throw new Error(label + ' failed (' + category + ', exit=' + output.status + '). Sensitive provider output withheld.');
  }
  return captured;
}

function parseDatabaseId(output) {
  const found = output.match(/["']?database_id["']?\s*[:=]\s*["']([a-f0-9-]{36})["']/i);
  return found?.[1] ?? null;
}

function safeRemoteD1Response(response, label) {
  assert.equal(response.status, 200, label + ' HTTP ' + response.status);
}

async function callD1(origin, headers, path, payload = {}) {
  return fetch(new URL(path, origin), {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(12000),
  });
}

async function exerciseD1(origin, headers, environment) {
  const dbName = 'cf00-temporary-' + randomBytes(5).toString('hex');
  const createOutput = runWrangler(['d1', 'create', dbName, '--jurisdiction=eu'], environment, 'D1 EU create in temporary account');
  const dbId = parseDatabaseId(createOutput);
  assert.ok(dbId && /^[a-f0-9-]{36}$/.test(dbId), 'Temporary D1 UUID missing; provider raw output withheld');

  const infoOutput = runWrangler(['d1', 'info', dbName, '--json'], environment, 'D1 remote info');
  let info;
  try {
    const start = infoOutput.indexOf('{');
    info = JSON.parse(infoOutput.slice(start));
  } catch {
    throw new Error('Temporary D1 info did not return parseable JSON (raw output withheld)');
  }
  const actualJurisdiction = info.jurisdiction ?? info.result?.jurisdiction;
  assert.equal(actualJurisdiction, 'eu', 'Provider D1 readback must attest EU jurisdiction');
  console.log('CF00 temporary D1: remote create and EU jurisdiction readback confirmed');

  const config = JSON.parse(readFileSync(join(root, 'cloudflare/cf00/wrangler.temporary.jsonc'), 'utf8'));
  config.d1_databases = [{ binding: 'DB', database_name: dbName, database_id: dbId }];
  writeFileSync(generatedConfig, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  // The second deployment explicitly reuses the same cached temporary account.
  runWrangler(['deploy', '--temporary', '--strict', '--config',
    'cloudflare/cf00/wrangler.temporary.generated.jsonc', '--secrets-file', secretFile], environment, 'Redeploy temporary Worker with D1');
  let ready = false;
  for (let n = 0; n < 6; n += 1) {
    const response = await callD1(origin, headers, '/__cf00/health');
    if (response.ok) {
      const body = await response.json();
      if (body.ready === true && body.durableObjectBinding === true && body.d1Binding === true) {
        ready = true;
        break;
      }
    }
    if (n < 5) await sleep(1000);
  }
  assert.ok(ready, 'Temporary remote Worker did not expose D1 binding');

  safeRemoteD1Response(await callD1(origin, headers, '/__cf00/init'), 'D1 fixture initialization');
  const requests = [
    { writer: 'writer-a', batchId: 'batch000000000021-a', expectedRev: 0, consentEpoch: 7 },
    { writer: 'writer-b', batchId: 'batch000000000021-b', expectedRev: 0, consentEpoch: 7 },
  ];
  const outcomes = await Promise.all(requests.map(x => callD1(origin, headers, '/__cf00/write', x)));
  assert.deepEqual(outcomes.map(x => x.status).sort((a, b) => a - b), [200, 409],
    'Same snapshot must have one winner, one conflict');
  const winner = outcomes[0].status === 200 ? 0 : 1;
  const commit = await outcomes[winner].json();
  assert.equal(commit.batchId, requests[winner].batchId);
  assert.equal(commit.queryMetrics?.statements, 3);
  assert.ok(Number.isSafeInteger(commit.queryMetrics?.rowsRead) && commit.queryMetrics.rowsRead >= 0);
  assert.ok(Number.isSafeInteger(commit.queryMetrics?.rowsWritten) && commit.queryMetrics.rowsWritten > 0);
  console.log('CF00 temporary REMOTE D1 batch metering: reads=' + commit.queryMetrics.rowsRead
    + ', writes=' + commit.queryMetrics.rowsWritten + ', SQL statements=3');

  const stateResponse = await callD1(origin, headers, '/__cf00/state');
  safeRemoteD1Response(stateResponse, 'D1 state read');
  const state = await stateResponse.json();
  assert.equal(state.control.revision, 1);
  assert.equal(state.control.consent_epoch, 7);
  assert.equal(state.docs.length, 1);
  assert.equal(state.docs[0].path, requests[winner].writer);
  const receiptResponse = await callD1(origin, headers, '/__cf00/receipt', { batchId: requests[winner].batchId });
  safeRemoteD1Response(receiptResponse, 'D1 winner receipt');
  const receipt = (await receiptResponse.json()).receipt;
  assert.deepEqual({ writer: receipt.writer, expected_rev: receipt.expected_rev,
    consent_epoch: receipt.consent_epoch, committed_rev: receipt.committed_rev },
    { writer: requests[winner].writer, expected_rev: 0, consent_epoch: 7, committed_rev: 1 });
  const loserReceiptResponse = await callD1(origin, headers, '/__cf00/receipt', { batchId: requests[1 - winner].batchId });
  safeRemoteD1Response(loserReceiptResponse, 'D1 losing receipt');
  assert.equal((await loserReceiptResponse.json()).receipt, null);

  const duplicate = await callD1(origin, headers, '/__cf00/write', requests[winner]);
  assert.equal(duplicate.status, 409, 'Already-applied batch must not execute again');
  const staleConsent = await callD1(origin, headers, '/__cf00/write', {
    writer: 'writer-c', batchId: 'batch000000000022-c', expectedRev: 1, consentEpoch: 6,
  });
  assert.equal(staleConsent.status, 409, 'Consent epoch stale must fail closed');
  const afterResponse = await callD1(origin, headers, '/__cf00/state');
  safeRemoteD1Response(afterResponse, 'D1 state after rejected writes');
  assert.deepEqual(await afterResponse.json(), state);

  const planResponse = await callD1(origin, headers, '/__cf00/plan');
  safeRemoteD1Response(planResponse, 'D1 index plans');
  const plans = (await planResponse.json()).plans;
  assert.deepEqual(plans.map(x => x.name), ['control', 'receipt', 'document']);
  for (const p of plans) {
    assert.ok(p.detail.some(detail => /USING (?:COVERING )?INDEX/.test(detail)), 'Index scan expected for ' + p.name);
  }
  console.log('CF00 temporary REMOTE D1: CAS race 200/409, receipt, stale consent, replay and index checks PASS');
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
  assert.deepEqual(failures, [], 'All unanticipated KDF failures must be resolved');
  await exerciseD1(origin, headers, environment);
  console.log('Temporary account was not claimed; its resources expire automatically.');
} finally {
  rmSync(generatedConfig, { force: true });
  rmSync(sandbox, { recursive: true, force: true });
}
