import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPrivateWorkerBindings } from '../../scripts/verify-cloudflare-api-provider.mjs';

const db = '9aa51833-8adc-495f-bdfc-93b5542e8023';
const gate = 'thelogbook-cf03-auth-gate-isolated';
const dataWorker = 'thelogbook-api-isolated';
const kindeWorker = 'thelogbook-cf03-kinde-http-isolated';
const settings = {
  [gate]: { bindings: [
    { type: 'd1', name: 'DB', id: db, database_id: db },
    { type: 'ratelimit', name: 'API_RATE_LIMITER', namespace_id: '31003' },
  ] },
  [dataWorker]: { bindings: [
    { type: 'd1', name: 'DB', id: db, database_id: db },
    { type: 'service', name: 'AUTH_GATE', service: gate },
  ] },
  [kindeWorker]: { bindings: [
    { type: 'd1', name: 'DB', id: db, database_id: db },
    { type: 'service', name: 'AUTH_GATE', service: gate },
    { type: 'ratelimit', name: 'AUTH_RATE_LIMITER', namespace_id: '31004' },
    { type: 'plain_text', name: 'APP_ORIGIN', text: 'https://thelogbook.me' },
  ] },
};

function cloudflareMock(overrides = {}) {
  const calls = [];
  const request = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method, headers: init.headers });
    const worker = path.includes('/workers/scripts/' + gate + '/')
      ? gate : path.includes('/workers/scripts/' + kindeWorker + '/') ? kindeWorker : dataWorker;
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
    [dataWorker, 'DB'], [dataWorker, 'AUTH_GATE']]) {
    const path = '/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/' + name + '/settings';
    const bindings = settings[name].bindings.filter(item => item.name !== bindingName);
    const mock = cloudflareMock({ [path]: { success: true, result: { bindings } } });
    await assert.rejects(verifyPrivateWorkerBindings(args(mock)), /absent|incorrect/);
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

void test('Kinde HTTP Worker is private and has exactly its four approved runtime bindings', async () => {
  const mock = cloudflareMock();
  await verifyPrivateWorkerBindings({ ...args(mock), includeKinde: true });
  assert.equal(mock.calls.length, 6);
  assert.ok(mock.calls.every(call => call.method === 'GET'));
});

void test('Kinde HTTP Worker fails closed on missing ADK-independent identity bindings or extra secrets', async () => {
  const prefix = '/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/';
  const path = prefix + kindeWorker + '/settings';
  for (const bindingName of ['DB', 'AUTH_GATE', 'AUTH_RATE_LIMITER', 'APP_ORIGIN']) {
    const mock = cloudflareMock({ [path]: { success: true, result: { bindings:
      settings[kindeWorker].bindings.filter(b => b.name !== bindingName),
    } } });
    await assert.rejects(verifyPrivateWorkerBindings({ ...args(mock), includeKinde: true }),
      /absent|incorrect|unapproved/);
  }
  const injected = cloudflareMock({ [path]: { success: true, result: { bindings: [
    ...settings[kindeWorker].bindings,
    { name: 'KINDE_CLIENT_SECRET', type: 'secret_text' },
  ] } } });
  await assert.rejects(verifyPrivateWorkerBindings({ ...args(injected), includeKinde: true }),
    /unapproved/);
  const wrongOrigin = cloudflareMock({ [path]: { success: true, result: { bindings:
    settings[kindeWorker].bindings.map(b => b.name === 'APP_ORIGIN'
      ? { ...b, text: 'https://wrong.invalid' } : b),
  } } });
  await assert.rejects(verifyPrivateWorkerBindings({ ...args(wrongOrigin), includeKinde: true }),
    /origin/);
});

void test('Kinde HTTP Worker refuses public workers.dev, preview and incorrect D1', async () => {
  const prefix = '/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/';
  const publicUrl = cloudflareMock({ [prefix + kindeWorker + '/subdomain']: {
    success: true, result: { enabled: true, previews_enabled: false },
  } });
  await assert.rejects(verifyPrivateWorkerBindings({
    ...args(publicUrl), includeKinde: true,
  }), /workers.dev exposed/);
  const publicPreview = cloudflareMock({ [prefix + kindeWorker + '/subdomain']: {
    success: true, result: { enabled: false, previews_enabled: true },
  } });
  await assert.rejects(verifyPrivateWorkerBindings({
    ...args(publicPreview), includeKinde: true,
  }), /preview exposed/);
  const wrongDb = cloudflareMock({ [prefix + kindeWorker + '/settings']: {
    success: true, result: { bindings: settings[kindeWorker].bindings.map(b =>
      b.name === 'DB' ? { ...b, id: 'unapproved-db' } : b) },
  } });
  await assert.rejects(verifyPrivateWorkerBindings({
    ...args(wrongDb), includeKinde: true,
  }), /UUID/);
  const missingWorker = cloudflareMock({ [prefix + kindeWorker + '/settings']: {
    success: false, httpStatus: 404,
  } });
  await assert.rejects(verifyPrivateWorkerBindings({
    ...args(missingWorker), includeKinde: true,
  }), /HTTP 404/);
});
