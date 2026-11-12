import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const varsPath = resolve(root, 'cloudflare/cf00/.dev.vars');
const secret = randomBytes(32).toString('hex');
const origin = 'http://127.0.0.1:8794';
const header = { 'x-cf00-secret': secret, 'content-type': 'application/json' };

function request(path, body) {
  return fetch(origin + path, { method: 'POST', headers: header, body: JSON.stringify(body ?? {}) });
}

async function waitForWorker(child) {
  for (let n = 0; n < 120; n += 1) {
    if (child.exitCode !== null) throw new Error('Wrangler exited before the local probe was ready');
    try {
      const response = await fetch(origin + '/__cf00/init', { method: 'POST' });
      if (response.status === 404) return;
    } catch { /* Local workerd startup is still in progress. */ }
    await sleep(500);
  }
  throw new Error('Timed out waiting for local workerd');
}

writeFileSync(varsPath, `CF00_PROBE_ENABLED=true\nCF00_PROBE_SECRET=${secret}\n`, { mode: 0o600, flag: 'wx' });
let logs = '';
let child;
try {
  child = spawn('npx', ['--yes', 'wrangler@4.159.0', 'dev', '--local', '--config',
    'cloudflare/cf00/wrangler.local.jsonc', '--port', '8794'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', data => { logs = (logs + data.toString()).slice(-8000); });
  }
  await waitForWorker(child);

  const health = await request('/__cf00/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ready: true, durableObjectBinding: true, d1Binding: true });
  const init = await request('/__cf00/init');
  assert.equal(init.status, 200, 'D1 schema and synthetic fixture must initialize');

  const batch = (writer, batchId, rev, epoch = 7) => request('/__cf00/write', {
    writer, batchId, expectedRev: rev, consentEpoch: epoch,
  });
  const [first, second] = await Promise.all([
    batch('writer-a', 'batch000000000001-a', 0),
    batch('writer-b', 'batch000000000001-b', 0),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const committed = await (first.status === 200 ? first : second).json();
  assert.equal(committed.queryMetrics?.statements, 3);
  assert.ok(Number.isSafeInteger(committed.queryMetrics.rowsRead));
  assert.ok(Number.isSafeInteger(committed.queryMetrics.rowsWritten));
  assert.ok(committed.queryMetrics.rowsRead >= 0);
  assert.ok(committed.queryMetrics.rowsWritten > 0);
  assert.ok(committed.queryMetrics.sizeAfterBytes > 0);
  console.log('CF00 simulated D1 write rows: read=' + committed.queryMetrics.rowsRead
    + ' written=' + committed.queryMetrics.rowsWritten + ' (NOT remote D1)');
  const planResponse = await request('/__cf00/plan');
  assert.equal(planResponse.status, 200);
  const plan = await planResponse.json();
  assert.deepEqual(plan.plans.map(item => item.name), ['control', 'receipt', 'document']);
  for (const item of plan.plans) {
    assert.ok(item.detail.some(text => /USING (?:COVERING )?INDEX/.test(text)),
      item.name + ' must search the PK index');
  }
  const stateResponse = await request('/__cf00/state');
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.control.revision, 1);
  assert.equal(state.docs.length, 1);

  const winner = first.status === 200 ? 'a' : 'b';
  const receipt = await request('/__cf00/receipt', { batchId: `batch000000000001-${winner}` });
  assert.equal((await receipt.json()).receipt.committed_rev, 1);
  assert.equal((await batch('writer-a', `batch000000000001-${winner}`, 0)).status, 409);
  assert.equal((await batch('writer-c', 'batch000000000002-a', 1, 6)).status, 409);
  const final = await request('/__cf00/state');
  assert.deepEqual(await final.json(), state);

  for (const algorithm of ['pbkdf2', 'scrypt']) {
    const response = await request(`/__cf00/password?algorithm=${algorithm}`);
    assert.equal(response.status, 200, `Durable Object ${algorithm} hashing must execute`);
    const result = await response.json();
    assert.equal(result.outputBits, 256);
    assert.ok(result.wallMs > 0);
    assert.ok(!('hash' in result));
    console.log(`CF00 ${algorithm}: wall_ms=${result.wallMs.toFixed(1)} (NOT provider CPU)`);
  }
  console.log('CF00 workerd local D1/DO smoke: PASS (simulated bindings, no remote quota claims)');
} catch (error) {
  console.error(logs.replaceAll(secret, '[REDACTED]').slice(-3000));
  throw error;
} finally {
  if (child && child.exitCode === null) {
    if (process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    } else child.kill('SIGTERM');
  }
  rmSync(varsPath, { force: true });
}
