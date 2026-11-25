import assert from 'node:assert/strict';
import test from 'node:test';
import { routeCandidateFirstPartyApi } from '../../cloudflare/first-party-api-candidate.mjs';

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
    '/v1/sync/replica/retire', '/v1/sync/replica/status',
  ]) {
    const response = await routeCandidateFirstPartyApi(request(path), env);
    assert.equal(response.status, 200, path);
  }
  assert.equal(calls.data.length, 16);
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
