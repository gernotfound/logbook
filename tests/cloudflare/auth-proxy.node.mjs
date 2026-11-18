import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../../cloudflare/auth-proxy.mjs';

const ORIGIN = 'https://thelogbook.me';
const req = (path, init) => new Request(ORIGIN + path, init);

void test('retired Firebase Hosting helpers and all other unsupported URLs never reach an upstream', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('external Firebase network fetch attempted'); };
  const calls = [];
  const env = { APP_ORIGIN: ORIGIN, KINDE_HTTP: { async fetch(request) {
    calls.push(request);
    throw Error('Kinde service must not see Firebase helpers');
  } } };
  try {
    for (const path of [
      '/__/auth', '/__/auth/', '/__/auth/iframe', '/__/auth/handler?code=synthetic',
      '/__/authx/iframe', '/__/unrelated', '/v1/sync/control',
      '/v1/cloud-key/sync', '/api/auth/kinde/unknown', '/api/auth/session/extra',
      '/assets/missing.js',
    ]) {
      const response = await handler.fetch(req(path), env);
      assert.equal(response.status, 404, path);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

void test('public Worker code and routing configuration contain no retired Firebase helper proxy', () => {
  const source = readFileSync(new URL('../../cloudflare/auth-proxy.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /firebaseapp\.com|AUTH_UPSTREAM|fetch\(\s*AUTH_UPSTREAM/);
  const config = JSON.parse(readFileSync(new URL('../../cloudflare/wrangler.jsonc', import.meta.url), 'utf8'));
  assert.ok(config.assets.run_worker_first.every(route => !route.startsWith('/__/')));
  assert.deepEqual(config.assets.run_worker_first, [
    '/api/auth/kinde/start', '/api/auth/kinde/callback',
    '/api/auth/session', '/api/auth/logout',
  ]);
});

void test('Kinde OAuth is still forwarded solely over private binding with no external fetch', async () => {
  let count = 0;
  const env = { APP_ORIGIN: ORIGIN, KINDE_HTTP: {
    async fetch(request) {
      count++;
      assert.equal(request.url, ORIGIN + '/api/auth/kinde/start');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('authorization'), null);
      assert.equal(request.headers.get('x-original-route'), null);
      return new Response(null, {
        status: 303, headers: {
          'Location': 'https://thelogbook.kinde.com/oauth2/auth',
          'Cache-Control': 'no-store',
        },
      });
    },
  } };
  const response = await handler.fetch(req('/api/auth/kinde/start', {
    method: 'POST', headers: {
      Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin',
      Authorization: 'Bearer attacker', 'X-Original-Route': '/v1/consent/status',
    },
  }), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://thelogbook.kinde.com/oauth2/auth');
  assert.equal(count, 1);
  assert.equal((await handler.fetch(req('/api/auth/kinde/start'), env)).status, 405);
  assert.equal((await handler.fetch(req('/api/auth/kinde/start', {
    method: 'POST', headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' },
  }), { APP_ORIGIN: ORIGIN })).status, 503);
});

void test('session failures propagate without fallback to a third-party provider', async () => {
  const env = { APP_ORIGIN: ORIGIN, KINDE_HTTP: { fetch: async () => Response.json({
    error: 'not-signed-in',
  }, { status: 401, headers: { 'Cache-Control': 'no-store' } }) } };
  const response = await handler.fetch(req('/api/auth/session', {
    method: 'POST', headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' },
  }), env);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
