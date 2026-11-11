import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../cloudflare/auth-proxy.mjs';

const app = 'https://thelogbook.example.workers.dev';
const req = (path, init) => new Request(app + path, init);
async function mockedFetch(fn, run) {
  const saved = globalThis.fetch;
  globalThis.fetch = fn;
  try { await run(); } finally { globalThis.fetch = saved; }
}
test('non-Auth paths and unsupported methods never reach Firebase', async () => {
  await mockedFetch(() => { throw Error('no upstream permitted'); }, async () => {
    assert.equal((await handler.fetch(req('/assets/missing.js'))).status, 404);
    assert.equal((await handler.fetch(req('/__/unrelated/'))).status, 404);
    assert.equal((await handler.fetch(req('/__/authx/iframe'))).status, 404);
    assert.equal((await handler.fetch(req('/__/auth/iframe', { method: 'PUT' }))).status, 405);
  });
});
test('the same-origin helper proxies only the fixed firebaseapp.com host', async () => {
  await mockedFetch(async (url, options) => {
    assert.equal(url, 'https://logbook-db-98cc4.firebaseapp.com/__/auth/iframe?apiKey=synthetic');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.get('authorization'), null);
    return new Response('helper', { headers: { 'Content-Type': 'text/html' } });
  }, async () => {
    const response = await handler.fetch(req('/__/auth/iframe?apiKey=synthetic', {
      headers: { Authorization: 'not-forwarded' },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Frame-Options'), null);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(await response.text(), 'helper');
  });
});
test('first-party redirects are rebased but external insecure redirects fail closed', async () => {
  await mockedFetch(async () => new Response(null, { status: 302, headers: { Location: '/__/auth/handler?code=test' } }), async () => {
    assert.equal((await handler.fetch(req('/__/auth/handler'))).headers.get('location'), app + '/__/auth/handler?code=test');
  });
  await mockedFetch(async () => new Response(null, { status: 302, headers: { Location: 'http://evil.example/' } }), async () => {
    assert.equal((await handler.fetch(req('/__/auth/handler'))).status, 502);
  });
});
test('POST size is bounded and only reviewed headers reach upstream', async () => {
  await mockedFetch(async (_url, options) => {
    assert.equal(options.headers.get('x-admin-key'), null);
    assert.equal(options.headers.get('origin'), app);
    assert.equal(new TextDecoder().decode(options.body), 'synthetic');
    return new Response('ok');
  }, async () => {
    assert.equal((await handler.fetch(req('/__/auth/handler', {
      method: 'POST', body: 'synthetic',
      headers: { Origin: app, 'X-Admin-Key': 'forbidden' },
    }))).status, 200);
  });
  await mockedFetch(() => { throw Error('not reached'); }, async () => {
    assert.equal((await handler.fetch(req('/__/auth/handler', { method: 'POST', body: 'x'.repeat(70000) }))).status, 413);
  });
});
