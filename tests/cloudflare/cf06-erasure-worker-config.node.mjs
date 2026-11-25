import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import erasureWorker from '../../cloudflare/jobs/health-erasure-worker.mjs';
import { validateErasureCandidate } from '../../scripts/check-cloudflare-erasure-candidate.mjs';

const candidate = JSON.parse(readFileSync('cloudflare/jobs/wrangler.isolated.jsonc', 'utf8'));
const api = JSON.parse(readFileSync('cloudflare/api/wrangler.isolated.jsonc', 'utf8'));

void test('CF-06 scheduled-only candidate is unscheduled, unexposed and has distinct primary D1 authorities', () => {
  assert.deepEqual(validateErasureCandidate(candidate, api), []);
  assert.equal(typeof erasureWorker.scheduled, 'function');
  assert.equal(Object.hasOwn(erasureWorker, 'fetch'), false);
  assert.equal(Object.hasOwn(candidate, 'triggers'), false);
  assert.equal(Object.hasOwn(candidate, 'routes'), false);
  assert.equal(Object.hasOwn(candidate, 'vars'), false);
});

void test('CF-06 scheduler stays inert without an exact, deliberate processing opt-in', async () => {
  for (const flag of [undefined, null, '', false, true, '1', 'true', 'enabled ']) {
    const env = {
      CF06_ERASURE_RUN_ENABLED: flag,
      CF06_ERASURE_RUN_MODE: 'account-application',
      get DB() { throw new Error('unexpected-primary-read'); },
      get RECOVERY_DB() { throw new Error('unexpected-recovery-read'); },
    };
    assert.deepEqual(await erasureWorker.scheduled({}, env), { outcome: 'paused' });
  }
  assert.deepEqual(await erasureWorker.scheduled({}, undefined), { outcome: 'paused' });
  for (const mode of [null, '', true, 'account', 'account-application ', 'alternating-application ', 'provider', 'inactivity']) {
    assert.deepEqual(await erasureWorker.scheduled({}, {
      CF06_ERASURE_RUN_ENABLED: 'enabled',
      CF06_ERASURE_RUN_MODE: mode,
      get DB() { throw new Error('unexpected-primary-read'); },
      get RECOVERY_DB() { throw new Error('unexpected-recovery-read'); },
    }), { outcome: 'paused' });
  }
  for (const pin of [undefined, null, '', true, 2, '0', '-2', '02', '2.0', '2e0', ' 2', '2 ', '2\n', '0x2', '9007199254740992']) {
    for (const mode of ['inactivity-dry-run', 'inactivity-enqueue']) {
      assert.deepEqual(await erasureWorker.scheduled({}, {
        CF06_ERASURE_RUN_ENABLED: 'enabled',
        CF06_ERASURE_RUN_MODE: mode,
        CF06_INACTIVITY_ENQUEUE_ENABLED: 'enabled',
        CF06_INACTIVITY_RECOVERY_GENERATION: pin,
        get DB() { throw new Error('unexpected-primary-read'); },
        get RECOVERY_DB() { throw new Error('unexpected-recovery-read'); },
      }), { outcome: 'paused' });
    }
  }
  for (const gate of [undefined, null, '', true, '1', 'true', 'enabled ']) {
    assert.deepEqual(await erasureWorker.scheduled({}, {
      CF06_ERASURE_RUN_ENABLED: 'enabled',
      CF06_ERASURE_RUN_MODE: 'inactivity-enqueue',
      CF06_INACTIVITY_ENQUEUE_ENABLED: gate,
      CF06_INACTIVITY_RECOVERY_GENERATION: '2',
      get DB() { throw new Error('unexpected-primary-read'); },
      get RECOVERY_DB() { throw new Error('unexpected-recovery-read'); },
    }), { outcome: 'paused' });
  }
  let requestedPrimary = false;
  await assert.rejects(erasureWorker.scheduled({}, {
    CF06_ERASURE_RUN_ENABLED: 'enabled',
    get DB() { requestedPrimary = true; throw new Error('synthetic-primary-binding'); },
  }), /synthetic-primary-binding/);
  assert.equal(requestedPrimary, true);
});

void test('CF-06 candidate rejects accidental cron activation, new routes, secrets or incorrect database bindings', () => {
  for (const change of [
    { workers_dev: true },
    { preview_urls: true },
    { triggers: { crons: ['*/5 * * * *'] } },
    { route: 'thelogbook.me/erase' },
    { routes: [{ pattern: 'thelogbook.me/api/*' }] },
    { assets: { directory: '../dist' } },
    { services: [{ binding: 'KINDE_HTTP', service: 'thelogbook-cf03-kinde-http-isolated' }] },
    { vars: { CLOUD_ACCOUNT_KEK_V1: 'forbidden' } },
    { vars: { CF06_ERASURE_RUN_ENABLED: 'enabled', CF06_ERASURE_RUN_MODE: 'account-application' } },
    { vars: { CF06_ERASURE_RUN_ENABLED: 'enabled', CF06_ERASURE_RUN_MODE: 'alternating-application' } },
    { vars: { CF06_ERASURE_RUN_ENABLED: 'enabled', CF06_ERASURE_RUN_MODE: 'inactivity-dry-run', CF06_INACTIVITY_RECOVERY_GENERATION: '2' } },
    { vars: { CF06_ERASURE_RUN_ENABLED: 'enabled', CF06_ERASURE_RUN_MODE: 'inactivity-enqueue', CF06_INACTIVITY_ENQUEUE_ENABLED: 'enabled', CF06_INACTIVITY_RECOVERY_GENERATION: '2' } },
    { unsafe: { bindings: [] } },
    { d1_databases: [candidate.d1_databases[0]] },
    { d1_databases: [
      candidate.d1_databases[0], { ...candidate.d1_databases[1], database_id: candidate.d1_databases[0].database_id },
    ] },
    { d1_databases: [
      candidate.d1_databases[0], { ...candidate.d1_databases[1], binding: 'DB' },
    ] },
    { d1_databases: [
      { ...candidate.d1_databases[0], database_id: 'other' }, candidate.d1_databases[1],
    ] },
  ]) {
    assert.notDeepEqual(validateErasureCandidate({ ...candidate, ...change }, api), [], JSON.stringify(change));
  }
});

void test('CF-06 must not silently follow an unverified alternate API target', () => {
  const different = { ...api, d1_databases: [
    { ...api.d1_databases[0], database_id: 'untrusted' }, api.d1_databases[1],
  ] };
  assert.notDeepEqual(validateErasureCandidate(candidate, different), []);
});
