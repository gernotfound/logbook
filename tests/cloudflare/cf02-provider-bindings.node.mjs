import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPrivateWorkerBindings } from '../../scripts/verify-cloudflare-api-provider.mjs';

const db = '9aa51833-8adc-495f-bdfc-93b5542e8023';
const registry = '19dad53f-0dda-4503-b161-758ac8cb7b21';
const gate = 'thelogbook-cf03-auth-gate-isolated';
const dataWorker = 'thelogbook-api-isolated';
const settings = {
  [gate]: { bindings: [
    { type: 'd1', name: 'DB', id: db, database_id: db },
    { type: 'ratelimit', name: 'API_RATE_LIMITER', namespace_id: '31003' },
  ] },
  [dataWorker]: { bindings: [
    { type: 'd1', name: 'DB', id: db, database_id: db },
    { type: 'd1', name: 'RECOVERY_DB', id: registry, database_id: registry },
    { type: 'service', name: 'AUTH_GATE', service: gate },
    { type: 'secret_text', name: 'CLOUD_ACCOUNT_KEK_V1' },
  ] },
};

function cloudflareMock(overrides = {}) {
  const calls = [];
  const request = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method, headers: init.headers });
    const worker = path.includes('/workers/scripts/' + gate + '/')
      ? gate : dataWorker;
    const result = path.endsWith('/settings') ? settings[worker]
      : { enabled: false, previews_enabled: false };
    const value = overrides[path] ?? { success: true, result };
    return { ok: value.httpStatus === undefined || value.httpStatus < 400,
      status: value.httpStatus ?? 200, json: async () => value };
  };
  return { request, calls };
}

function args(mock) {
  return { account: '0123456789abcdef0123456789abcdef', bearer: 'synthetic-test',
    request: mock.request };
}

void test('verifies real Worker binding shapes and uses no D1 SQL permissions', async () => {
  const mock = cloudflareMock();
  await verifyPrivateWorkerBindings(args(mock));
  assert.equal(mock.calls.length, 4);
  assert.ok(mock.calls.every(call => call.path.includes('/workers/scripts/')));
  assert.ok(mock.calls.every(call => call.method === 'GET'));
  assert.ok(mock.calls.every(call => call.headers.Authorization === 'Bearer synthetic-test'));
});

void test('rejects absent D1 binding, authorization service or limiter', async () => {
  for (const [name, bindingName] of [[gate, 'DB'], [gate, 'API_RATE_LIMITER'],
    [dataWorker, 'DB'], [dataWorker, 'RECOVERY_DB'], [dataWorker, 'AUTH_GATE']]) {
    const path = '/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/' + name + '/settings';
    const bindings = settings[name].bindings.filter(item => item.name !== bindingName);
    const mock = cloudflareMock({ [path]: { success: true, result: { bindings } } });
    await assert.rejects(verifyPrivateWorkerBindings(args(mock)), /absent|incorrect|independent recovery D1/);
  }
});

void test('rejects wrong D1 UUID and public preview URLs', async () => {
  const prefix = '/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/';
  const wrongDb = cloudflareMock({ [prefix + gate + '/settings']: {
    success: true, result: { bindings: settings[gate].bindings.map(b =>
      b.name === 'DB' ? { ...b, id: 'not-the-db' } : b) },
  } });
  await assert.rejects(verifyPrivateWorkerBindings(args(wrongDb)), /UUID/);
  const publicPreview = cloudflareMock({ [prefix + gate + '/subdomain']: {
    success: true, result: { enabled: false, previews_enabled: true },
  } });
  await assert.rejects(verifyPrivateWorkerBindings(args(publicPreview)), /preview exposed/);
});

void test('rejects HTTP 401 and provider-level failures (never treats absent proof as success)', async () => {
  const prefix = '/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/';
  const unauthorized = cloudflareMock({ [prefix + gate + '/settings']: {
    success: false, httpStatus: 401,
  } });
  await assert.rejects(verifyPrivateWorkerBindings(args(unauthorized)), /HTTP 401/);
  const providerError = cloudflareMock({ [prefix + gate + '/settings']: {
    success: false, result: null,
  } });
  await assert.rejects(verifyPrivateWorkerBindings(args(providerError)), /readback failed/);
});

void test('fails closed when KEK is missing, plaintext, duplicated or provider proof is absent', async () => {
  const prefix = '/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/';
  const path = prefix + dataWorker + '/settings';
  const present = settings[dataWorker].bindings;
  const candidates = [
    present.filter(binding => binding.name !== 'CLOUD_ACCOUNT_KEK_V1'),
    present.map(binding => binding.name === 'CLOUD_ACCOUNT_KEK_V1'
      ? { name: binding.name, type: 'plain_text' } : binding),
    [...present, { name: 'CLOUD_ACCOUNT_KEK_V1', type: 'secret_text' }],
    present.map(binding => binding.name === 'CLOUD_ACCOUNT_KEK_V1'
      ? { name: binding.name } : binding),
  ];
  for (const bindings of candidates) {
    const mock = cloudflareMock({ [path]: { success: true, result: { bindings } } });
    await assert.rejects(verifyPrivateWorkerBindings(args(mock)), /KEK/);
  }
  for (const failed of [
    { success: false, result: null },
    { success: false, httpStatus: 403, result: null },
    { success: true, result: {} },
  ]) {
    const mock = cloudflareMock({ [path]: failed });
    await assert.rejects(verifyPrivateWorkerBindings(args(mock)));
  }
});

void test('private Worker deployment preflights and rechecks the KEK after exact-main gate', () => {
  const yml = readFileSync(new URL('../../.github/workflows/cloudflare-api-isolated.yml', import.meta.url), 'utf8');
  const verify = 'run: node scripts/verify-cloudflare-api-provider.mjs';
  const preflight = yml.indexOf(verify);
  const mainLease = yml.indexOf('name: Verify main lease again immediately before provider writes');
  const deployAuth = yml.indexOf('name: Deploy private auth gate');
  const deployApi = yml.indexOf('name: Deploy private API service binding');
  const postDeploy = yml.lastIndexOf(verify);
  assert.equal(yml.split(verify).length - 1, 2);
  assert.ok(preflight > yml.indexOf('Wait for verified release gate')
    && preflight < mainLease && mainLease < deployAuth
    && deployAuth < deployApi && deployApi < postDeploy);
  assert.doesNotMatch(yml, /secret put|CLOUD_ACCOUNT_KEK_V1\s*:/);
});

void test('rejects substituted or main-DB alias recovery bindings', async () => {
  const prefix = '/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/';
  for (const wrong of [db, 'other']) {
    const broken = settings[dataWorker].bindings.map(binding =>
      binding.name === 'RECOVERY_DB' ? { ...binding, id: wrong, database_id: wrong } : binding);
    const mock = cloudflareMock({ [prefix + dataWorker + '/settings']: {
      success: true, result: { bindings: broken },
    } });
    await assert.rejects(verifyPrivateWorkerBindings(args(mock)), /independent erasure D1/);
  }
});
