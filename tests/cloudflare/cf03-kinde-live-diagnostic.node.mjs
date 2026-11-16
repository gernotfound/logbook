import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { probeKindeSession } from '../../public/verifica-accesso.js';

const page = readFileSync('public/verifica-accesso.html', 'utf8');
const script = readFileSync('public/verifica-accesso.js', 'utf8');
const sw = readFileSync('src/sw.ts', 'utf8');
const headers = readFileSync('cloudflare/_headers', 'utf8');
const WHO = 'k_' + 'A'.repeat(43);
const expected = Object.freeze({
  authenticated: true,
  emailVerified: true,
  fenceEpoch: 1,
  healthConsentRevision: 0,
  uid: WHO,
});

function json(status, body, overrides = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...overrides },
  });
}

void test('first-party diagnostic is an inert, noindex, password-free OAuth launcher', () => {
  assert.match(page, /<html lang="it">/);
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page, /<meta name="referrer" content="no-referrer">/);
  assert.match(page, /<form method="post" action="\/api\/auth\/kinde\/start" autocomplete="off">/);
  assert.match(page, /<script type="module" src="\/verifica-accesso\.js"><\/script>/);
  assert.match(page, /id="check-session"/);
  assert.match(page, /id="session-result" role="status" aria-live="polite"/);
  assert.doesNotMatch(page, /<input\b|name="password"|name="email"|autocomplete="current-password"/i);
  assert.doesNotMatch(page, /https?:\/\/(?!thelogbook\.me)|<iframe\b|<script(?! type="module")/i);
  assert.doesNotMatch(script, /localStorage|sessionStorage|document\.cookie|\.innerHTML|eval\s*\(/i);
  assert.match(sw, /verifica-accesso/);
  for (const path of ['/verifica-accesso', '/verifica-accesso.html', '/verifica-accesso.js']) {
    assert.ok(headers.includes(path + '\n  Cache-Control: no-cache, no-store, must-revalidate'));
  }
});

void test('session diagnostic never requests health endpoints or forwards account credentials', async () => {
  let call;
  const state = await probeKindeSession(async (path, options) => {
    call = { path, options };
    return json(200, expected);
  });
  assert.equal(state, 'verified');
  assert.equal(call.path, '/api/auth/session');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.credentials, 'same-origin');
  assert.equal(call.options.mode, 'same-origin');
  assert.equal(call.options.cache, 'no-store');
  assert.equal(call.options.redirect, 'error');
  assert.equal(call.options.headers.Accept, 'application/json');
  assert.ok(call.options.signal);
  assert.equal(Object.keys(call.options.headers).length, 1);
});

void test('unauthenticated means canonical 401, never any non-200 failure', async () => {
  assert.equal(await probeKindeSession(async () => json(401, { error: 'unauthorized' })), 'signed-out');
  for (const response of [
    json(401, { error: 'expired' }),
    json(403, { error: 'unauthorized' }),
    json(429, { error: 'rate-limited' }),
    json(503, { error: 'unavailable' }),
    new Response('ok', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    new Response(null, { status: 302, headers: { Location: '/auth' } }),
  ]) {
    assert.equal(await probeKindeSession(async () => response), 'unavailable');
  }
});

void test('diagnostic fails closed for false email verification, malformed owner, extra claims or oversized reply', async () => {
  for (const bad of [
    { ...expected, emailVerified: false },
    { ...expected, uid: 'other_account' },
    { ...expected, fenceEpoch: 0 },
    { ...expected, healthConsentRevision: -1 },
    { ...expected, roles: ['admin'] },
    { ...expected, authenticated: 'true' },
  ]) {
    assert.equal(await probeKindeSession(async () => json(200, bad)), 'unavailable');
  }
  assert.equal(await probeKindeSession(async () => json(200, expected, {
    'Content-Length': '999999',
  })), 'unavailable');
  assert.equal(await probeKindeSession(async () => json(200, {
    ...expected, padding: 'x'.repeat(1000),
  })), 'unavailable');
  assert.equal(await probeKindeSession(async () => { throw Error('network offline'); }), 'unavailable');
});
