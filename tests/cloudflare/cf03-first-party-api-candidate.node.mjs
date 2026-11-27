import assert from 'node:assert/strict';
import test from 'node:test';
import { routeCandidateFirstPartyApi } from '../../cloudflare/first-party-api-candidate.mjs';
import { CANDIDATE_API_ROUTE_PATHS, candidateApiRoutePolicy } from '../../cloudflare/api-route-policy.mjs';
import apiWorker from '../../cloudflare/api/worker.mjs';
import kindeWorker from '../../cloudflare/auth/kinde-http-worker.mjs';
import { withFixture, makeEnv, origin as privateOrigin } from './cf02-documents-fixture.mjs';

const ORIGIN = 'https://thelogbook.me';
const CSRF = 'A'.repeat(43);
const KINDE_START = '/api/auth/kinde/start';
const CALLBACK = '/api/auth/kinde/callback';
const CONTROL = '/v1/sync/control';

function request(path, options = {}) {
  return new Request(ORIGIN + path, {
    method: options.method ?? 'POST',
    headers: {
      origin: ORIGIN, 'sec-fetch-site': 'same-origin',
      ...(options.headers ?? {}),
    },
    ...(options.body === undefined ? {} : { body: options.body }),
    redirect: 'manual',
  });
}
function reply(body = '{}', status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...extra },
  });
}
function environment(overrides = {}) {
  const calls = { kinde: [], data: [] };
  const KINDE_HTTP = {
    async fetch(req) {
      calls.kinde.push(req);
      return reply('{"error":"rate-limited"}', 429);
    },
  };
  const D1_API = {
    async fetch(req) {
      calls.data.push(req);
      return reply('{"revision":0}');
    },
  };
  return { calls, env: { APP_ORIGIN: ORIGIN, KINDE_HTTP, D1_API, ...overrides } };
}
function privateApiRequest(body, headers = {}) {
  return new Request(privateOrigin + CONTROL, {
    method: 'POST',
    headers: { origin: privateOrigin, 'content-type': 'application/json', ...headers },
    body, duplex: 'half',
  });
}

void test('candidate gateway is not a generic proxy or an SPA fallback', async () => {
  const { env, calls } = environment();
  for (const path of ['/', '/login', '/favicon.ico', '/__/auth/handler',
    '/api/auth/unknown', '/v1/auth/logout', '/v1/admin', '/v1/sync/missing']) {
    const result = await routeCandidateFirstPartyApi(request(path), env);
    assert.equal(result.status, 404, path);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls.kinde.length, 0);
  assert.equal(calls.data.length, 0);
});

void test('private Auth Gate routes cannot acquire a public service binding', async () => {
  const { env, calls } = environment();
  assert.deepEqual(candidateApiRoutePolicy('/v1/auth/logout'), {
    public: false, identityOnly: true, csrfRequired: true,
    emailVerifiedRequired: false, maxBodyBytes: 0,
  });
  for (const path of ['/v1/auth/logout', '/v1/auth/logout/other', '/v1/sync/__proto__']) {
    assert.equal((await routeCandidateFirstPartyApi(request(path), env)).status, 404, path);
  }
  assert.equal(calls.kinde.length + calls.data.length, 0);
});

void test('routes only explicitly named POST endpoints to private service bindings', async () => {
  const { env, calls } = environment();
  const auth = await routeCandidateFirstPartyApi(request('/api/auth/session'), env);
  assert.equal(auth.status, 429);
  const data = await routeCandidateFirstPartyApi(request(CONTROL, {
    headers: { 'content-type': 'application/json' }, body: '{}',
  }), env);
  assert.equal(data.status, 200);
  assert.equal(calls.kinde.length, 1);
  assert.equal(calls.data.length, 1);
  for (const path of [
    '/v1/consent/status', '/v1/consent/initial', '/v1/consent/withdraw', '/v1/account/activity',
    '/v1/cloud-key/sync', '/v1/cloud-key/rights-export', '/v1/rights/scan',
    '/v1/sync/read', '/v1/sync/scan', '/v1/sync/receipt',
    '/v1/sync/commit', '/v1/sync/commit/status', '/v1/sync/replica/claim',
    '/v1/sync/replica/retire', '/v1/sync/replica/status', '/v1/sync/replica/cancel',
  ]) {
    const response = await routeCandidateFirstPartyApi(request(path), env);
    assert.equal(response.status, 200, path);
  }
  assert.equal(calls.data.length, 17);
});

void test('rejects wrong methods, queries and missing bindings before private I/O', async () => {
  const { env, calls } = environment();
  for (const p of [KINDE_START, '/api/auth/session', CONTROL]) {
    assert.equal((await routeCandidateFirstPartyApi(request(p, { method: 'GET' }), env)).status, 405);
    assert.equal((await routeCandidateFirstPartyApi(request(p + '?x=1'), env)).status, 400);
  }
  assert.equal((await routeCandidateFirstPartyApi(request(CALLBACK), env)).status, 405);
  assert.equal((await routeCandidateFirstPartyApi(request(CONTROL),
    { APP_ORIGIN: ORIGIN, KINDE_HTTP: env.KINDE_HTTP })).status, 503);
  assert.equal((await routeCandidateFirstPartyApi(request(KINDE_START),
    { APP_ORIGIN: ORIGIN, D1_API: env.D1_API })).status, 503);
  assert.equal(calls.kinde.length + calls.data.length, 0);
});

void test('POST requires exact origin and same-origin fetch-site, not merely a cookie', async () => {
  const { env, calls } = environment();
  for (const headers of [
    { origin: 'https://attacker.invalid' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
  ]) {
    const result = await routeCandidateFirstPartyApi(request(KINDE_START, {
      headers: { cookie: '__Host-logbook_session=synthetic', ...headers },
    }), env);
    assert.equal(result.status, 403);
  }
  assert.equal((await routeCandidateFirstPartyApi(new Request(ORIGIN + CONTROL, {
    method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: '{}',
  }), env)).status, 403);
  assert.equal(calls.kinde.length + calls.data.length, 0);
});

void test('rejects mismatched/malformed deployment origin and never resolves public bindings', async () => {
  const { env, calls } = environment();
  for (const APP_ORIGIN of ['http://thelogbook.me', ORIGIN + '/', ORIGIN + ':443',
    'https://attacker.invalid', '', null]) {
    assert.equal((await routeCandidateFirstPartyApi(request(KINDE_START),
      { ...env, APP_ORIGIN })).status, 503);
  }
  assert.equal((await routeCandidateFirstPartyApi(new Request('https://other.invalid' + KINDE_START, {
    method: 'POST', headers: { origin: ORIGIN },
  }), env)).status, 503);
  assert.equal(calls.kinde.length, 0);
});

void test('rejects oversized, malformed and non-decimal declared request bodies', async () => {
  const { env, calls } = environment();
  for (const length of ['7608193', '99999999', '-1', '1e10', '1.5', 'unknown']) {
    const response = await routeCandidateFirstPartyApi(request(CONTROL, {
      body: '{}', headers: { 'content-length': length },
    }), env);
    assert.equal(response.status, 413, length);
  }
  assert.equal(calls.data.length, 0);
});

void test('gateway enforces independent per-route declared budgets before calling either service', async () => {
  const { env, calls } = environment();
  const publicData = CANDIDATE_API_ROUTE_PATHS.filter(path => candidateApiRoutePolicy(path).public);
  const allowed = [KINDE_START, '/api/auth/session', '/api/auth/logout', ...publicData];
  for (const path of allowed) {
    const max = path.startsWith('/api/auth/') ? 0 : candidateApiRoutePolicy(path).maxBodyBytes;
    assert.ok(Number.isSafeInteger(max) && max >= 0, path);
    const options = { headers: { 'content-length': String(max + 1) },
      ...(max === 0 ? {} : { body: '{}' }) };
    assert.equal((await routeCandidateFirstPartyApi(request(path, options), env)).status, 413, path);
    assert.equal((await routeCandidateFirstPartyApi(request(path, {
      headers: { 'content-length': String(max) },
      ...(max === 0 ? {} : { body: '{}' }),
    }), env)).status, path.startsWith('/api/auth/') ? 429 : 200, path);
  }
  assert.equal(calls.kinde.length, 3);
  assert.equal(calls.data.length, publicData.length);
  assert.equal((await routeCandidateFirstPartyApi(new Request(ORIGIN + CALLBACK, {
    headers: { 'content-length': '1' },
  }), env)).status, 413);
  assert.equal(calls.kinde.length, 3);
});

void test('private handlers reject actual excess bytes with absent or forged Content-Length', () => withFixture(async db => {
  let reachedApi = 0;
  const env = { APP_ORIGIN: privateOrigin,
    D1_API: { async fetch(request) {
      reachedApi += 1;
      assert.equal(request.headers.has('content-length'), false);
      return apiWorker.fetch(request, makeEnv(db));
    } },
  };
  for (const headers of [{}, { 'content-length': '1' }]) {
    const response = await routeCandidateFirstPartyApi(new Request(privateOrigin + CONTROL, {
      method: 'POST', headers: {
        origin: privateOrigin, 'content-type': 'application/json', ...headers,
      }, body: '{}'.padEnd(129, ' '),
    }), env);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'payload-too-large' });
  }
  assert.equal(reachedApi, 2);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
}));

void test('private JSON body reader times out a stalled stream and does not await cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withFixture(async db => {
    let beginPull;
    let observeCancel;
    const pulling = new Promise(resolve => { beginPull = resolve; });
    const cancelled = new Promise(resolve => { observeCancel = resolve; });
    const body = new ReadableStream({
      pull() {
        beginPull();
        return new Promise(() => {});
      },
      cancel() {
        observeCancel();
        return new Promise(() => {});
      },
    }, { highWaterMark: 0 });
    const responsePromise = apiWorker.fetch(privateApiRequest(body), makeEnv(db));
    await pulling;
    t.mock.timers.tick(2_000);
    const response = await responsePromise;
    assert.equal(response.status, 408);
    assert.deepEqual(await response.json(), { error: 'request-body-timeout' });
    await cancelled;
    assert.equal(body.locked, false, 'timed-out body reader must release its lock');
    assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
  });
});

void test('first-party gateway preserves the private 408 timeout without an ACK or database mutation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withFixture(async db => {
    let reachedApi = 0;
    let pulled = false;
    let notifyCancel;
    const cancelled = new Promise(resolve => { notifyCancel = resolve; });
    const body = new ReadableStream({
      pull() {
        pulled = true;
        return new Promise(() => {});
      },
      cancel() {
        notifyCancel();
        return new Promise(() => {});
      },
    }, { highWaterMark: 0 });
    const env = {
      APP_ORIGIN: privateOrigin,
      D1_API: { fetch: request => {
        reachedApi += 1;
        return apiWorker.fetch(request, makeEnv(db));
      } },
    };
    const pending = routeCandidateFirstPartyApi(privateApiRequest(body), env);
    for (let attempt = 0; attempt < 20 && !pulled; attempt += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(reachedApi, 1, 'the gateway must reach the private API');
    assert.equal(pulled, true, 'the private API must start reading the body');
    t.mock.timers.tick(2_000);
    const response = await pending;
    assert.equal(response.status, 408);
    assert.deepEqual(await response.json(), { error: 'request-body-timeout' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.has('set-cookie'), false);
    assert.equal(response.headers.has('location'), false);
    await cancelled;
    assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
  });
});

void test('private JSON body reader accepts a paced valid stream within its idle budget', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withFixture(async db => {
    let notifyPull;
    const pulling = new Promise(resolve => { notifyPull = resolve; });
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode('}'));
          controller.close();
        }, 1_500);
      },
      pull() { notifyPull(); },
    });
    const pending = apiWorker.fetch(privateApiRequest(body), makeEnv(db));
    await pulling;
    t.mock.timers.tick(1_500);
    const response = await pending;
    assert.equal(response.status, 200);
    assert.equal((await response.json()).revision, 0);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
  });
});

void test('private JSON body reader applies its total deadline to a progressing stream', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withFixture(async db => {
    let beginPull;
    let observeCancel;
    let streamController;
    let chunks = 0;
    let settled = false;
    const pulling = new Promise(resolve => { beginPull = resolve; });
    const cancelled = new Promise(resolve => { observeCancel = resolve; });
    const body = new ReadableStream({
      start(controller) { streamController = controller; },
      pull(controller) {
        beginPull();
        return new Promise(resolve => setTimeout(() => {
          chunks += 1;
          controller.enqueue(new Uint8Array([0x20]));
          resolve();
        }, 1_000));
      },
      cancel() {
        observeCancel();
        return new Promise(() => {});
      },
    }, { highWaterMark: 0 });
    const responsePromise = apiWorker.fetch(privateApiRequest(body), makeEnv(db)).then(response => {
      settled = true;
      return response;
    });
    await pulling;
    for (let second = 0; second < 15; second += 1) {
      t.mock.timers.tick(1_000);
      await new Promise(resolve => setImmediate(resolve));
    }
    if (!settled) streamController.error(new Error('test cleanup'));
    const response = await responsePromise;
    assert.equal(settled, true, 'the total deadline must fire before the next idle deadline');
    assert.ok(chunks >= 5, 'the stream must continue making progress before timing out');
    assert.equal(response.status, 408);
    assert.deepEqual(await response.json(), { error: 'request-body-timeout' });
    await cancelled;
    assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
  });
});

void test('private JSON body reader cancels oversized streams without awaiting cancellation', () => withFixture(async db => {
  let observeCancel;
  const cancelled = new Promise(resolve => { observeCancel = resolve; });
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(129)); },
    cancel() {
      observeCancel();
      return new Promise(() => {});
    },
  });
  const response = await apiWorker.fetch(privateApiRequest(body), makeEnv(db));
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'payload-too-large' });
  await cancelled;
  assert.equal(body.locked, false, 'oversized body reader must release its lock');
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
}));

void test('private JSON body reader maps stream errors and accepts a valid streamed request', () => withFixture(async db => {
  const validBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{}'));
      controller.close();
    },
  });
  const valid = await apiWorker.fetch(privateApiRequest(validBody), makeEnv(db));
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).revision, 0);

  const failedBody = new ReadableStream({
    start(controller) { controller.error(new Error('synthetic body read failure')); },
  });
  const failed = await apiWorker.fetch(privateApiRequest(failedBody), makeEnv(db));
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'cloud-unavailable' });
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
}));

void test('forged zero-length Kinde POST cannot bypass the private empty-body guard', async () => {
  const { calls, env } = environment({
    KINDE_HTTP: { fetch: request => kindeWorker.fetch(request, { APP_ORIGIN: ORIGIN }) },
  });
  const response = await routeCandidateFirstPartyApi(request(KINDE_START, {
    headers: { 'content-length': '0' }, body: '{}',
  }), env);
  assert.equal(response.status, 403);
  assert.equal(calls.data.length, 0);
});

void test('forwards only cookie, per-session CSRF, content and browser headers', async () => {
  const { env, calls } = environment();
  const body = '{"paths":[""]}';
  const r = await routeCandidateFirstPartyApi(request('/v1/sync/read', {
    body,
    headers: {
      'content-type': 'application/json',
      cookie: '__Host-logbook_session=synthetic',
      'x-csrf-token': CSRF,
      'authorization': 'Bearer attacker',
      'x-original-route': '/v1/cloud-key/rights-export',
      'x-forwarded-host': 'attacker.invalid',
      'cf-connecting-ip': '127.0.0.1',
    },
  }), env);
  assert.equal(r.status, 200);
  const forwarded = calls.data[0];
  assert.equal(forwarded.url, ORIGIN + '/v1/sync/read');
  assert.equal(forwarded.method, 'POST');
  assert.equal(forwarded.redirect, 'manual');
  assert.equal(await forwarded.text(), body);
  for (const header of ['authorization', 'x-original-route', 'x-forwarded-host', 'cf-connecting-ip']) {
    assert.equal(forwarded.headers.has(header), false, header);
  }
  assert.equal(forwarded.headers.get('cookie'), '__Host-logbook_session=synthetic');
  assert.equal(forwarded.headers.get('x-csrf-token'), CSRF);
  assert.equal(forwarded.headers.get('origin'), ORIGIN);
});

void test('allows a cross-site OAuth GET callback but never a cross-site POST', async () => {
  const { calls, env } = environment();
  const params = '?state=' + 'A'.repeat(43) + '&code=test';
  const callback = new Request(ORIGIN + CALLBACK + params, {
    headers: { 'sec-fetch-site': 'cross-site', cookie: '__Host-logbook_oauth=synthetic' },
  });
  const response = await routeCandidateFirstPartyApi(callback, env);
  assert.equal(response.status, 429);
  assert.equal(calls.kinde.length, 1);
  assert.equal(calls.kinde[0].url, ORIGIN + CALLBACK + params);
  assert.equal((await routeCandidateFirstPartyApi(
    new Request(ORIGIN + CALLBACK + '?' + 'x'.repeat(4097)), env)).status, 400);
  assert.equal((await routeCandidateFirstPartyApi(request(KINDE_START, {
    headers: { 'sec-fetch-site': 'cross-site' },
  }), env)).status, 403);
});

void test('preserves 303 redirects and separate session cookies without parsing private response', async () => {
  const headers = new Headers({ 'Cache-Control': 'no-store', Location: 'https://provider.invalid/oauth2/auth' });
  headers.append('Set-Cookie', '__Host-logbook_session=A; Secure; HttpOnly; Path=/');
  headers.append('Set-Cookie', '__Host-logbook_csrf=B; Secure; Path=/');
  const { env } = environment({
    KINDE_HTTP: { fetch: async () => new Response(null, { status: 303, headers }) },
  });
  const response = await routeCandidateFirstPartyApi(request(KINDE_START), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://provider.invalid/oauth2/auth');
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

void test('propagates private 401/409/429 and refuses non-cache-safe or unavailable responses', async () => {
  const { env } = environment();
  for (const status of [401, 409, 429]) {
    const response = await routeCandidateFirstPartyApi(request(CONTROL), {
      ...env, D1_API: { fetch: async () => reply('{"error":"denied"}', status) },
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal((await routeCandidateFirstPartyApi(request(CONTROL), {
    ...env, D1_API: { fetch: async () => new Response('{}', { headers: { 'Cache-Control': 'public, max-age=300' } }) },
  })).status, 502);
  assert.equal((await routeCandidateFirstPartyApi(request(CONTROL), {
    ...env, D1_API: { fetch: async () => { throw new Error('secret error'); } },
  })).status, 503);
});

void test('fitness responses cannot set identity cookies or redirect the browser', async () => {
  const { env, calls } = environment();
  const forbidden = [
    reply('{}', 200, { 'Set-Cookie': '__Host-logbook_session=forged; Secure; Path=/' }),
    reply('{}', 200, { Location: 'https://attacker.invalid' }),
    new Response(null, { status: 303, headers: {
      Location: 'https://attacker.invalid', 'Cache-Control': 'no-store',
    } }),
  ];
  for (const response of forbidden) {
    const result = await routeCandidateFirstPartyApi(request(CONTROL), {
      ...env, D1_API: { fetch: async req => { calls.data.push(req); return response; } },
    });
    assert.equal(result.status, 502);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.headers.has('set-cookie'), false);
    assert.equal(result.headers.has('location'), false);
  }
  assert.equal(calls.data.length, forbidden.length);
});

void test('missing or invalid runtime bindings fail closed even with a matching URL', async () => {
  const { env } = environment();
  for (const binding of [undefined, {}, { fetch: 'not-a-function' }]) {
    assert.equal((await routeCandidateFirstPartyApi(request(CONTROL),
      { ...env, D1_API: binding })).status, 503);
  }
});
