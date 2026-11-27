import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { probeKindeSession, revokeKindeDiagnosticSession } from '../../public/verifica-accesso.js';

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
  // A native form POST under no-referrer sends Origin: null and is correctly denied by the CSRF gate.
  assert.match(page, /<meta name="referrer" content="same-origin">/);
  assert.match(page, /<form method="post" action="\/api\/auth\/kinde\/start" autocomplete="off">/);
  assert.match(page, /<script type="module" src="\/verifica-accesso\.js"><\/script>/);
  assert.match(page, /id="check-session"/);
  assert.match(page, /id="end-session" hidden/);
  assert.match(script, /logout.addEventListener/);
  assert.match(script, /document.cookie/);
  assert.match(page, /id="session-result" role="status" aria-live="polite"/);
  assert.match(page, /reindirizzato alla pagina iniziale della PWA/);
  assert.match(page, /verificare la sessione senza usare Firebase/);
  assert.match(page, /ospite con dati salvati sul dispositivo/);
  assert.match(page, /le funzioni fitness dell'account Cloudflare\/Kinde restano disabilitate/);
  assert.doesNotMatch(page, /La normale PWA utilizza ancora Firebase/);
  assert.doesNotMatch(script, /La PWA e i dati salute rimangono disabilitati/);
  assert.match(script, /Nessuna sessione applicativa TheLogBook attiva/);
  assert.match(script, /check\.addEventListener\('click', \(\) => \{ void verify\(\); \}\);/);
  assert.match(script, /void verify\(\);/);
  assert.doesNotMatch(script, /identitytoolkit|firebase\/auth|window\.location\s*=/);
  assert.doesNotMatch(page, /<input\b|name="password"|name="email"|autocomplete="current-password"/i);
  assert.doesNotMatch(page, /https?:\/\/(?!thelogbook\.me)|<iframe\b|<script(?! type="module")/i);
  assert.doesNotMatch(script, /localStorage|sessionStorage|\.innerHTML|eval\s*\(/i);
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

void test('diagnostic logout proves server revocation with a separate canonical 401', async () => {
  const csrf = 'A'.repeat(43);
  const calls = [];
  const result = await revokeKindeDiagnosticSession(async (path, options) => {
    calls.push({ path, options });
    return path === '/api/auth/logout' ? json(200, { status: 'signed-out' })
      : json(401, { error: 'unauthorized' });
  }, () => '__Host-logbook_csrf=' + csrf);
  assert.equal(result, 'signed-out');
  assert.deepEqual(calls.map(call => call.path), ['/api/auth/logout', '/api/auth/session']);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.mode, 'same-origin');
  assert.equal(calls[0].options.headers['X-CSRF-Token'], csrf);
  assert.deepEqual(Object.keys(calls[0].options.headers).sort(), ['Accept', 'X-CSRF-Token']);
  assert.equal(calls[1].options.headers['X-CSRF-Token'], undefined);
});

void test('diagnostic logout rejects missing, duplicate and malformed CSRF without sending requests', async () => {
  let calls = 0;
  const send = async () => { calls += 1; return json(200, { status: 'signed-out' }); };
  const cases = [
    '', '__Host-logbook_session=' + 'A'.repeat(43),
    '__Host-logbook_csrf=invalid',
    '__Host-logbook_csrf=' + 'A'.repeat(43) + '; __Host-logbook_csrf=' + 'B'.repeat(43),
    'X'.repeat(4097),
  ];
  for (const cookie of cases) {
    assert.equal(await revokeKindeDiagnosticSession(send, () => cookie), 'unavailable');
  }
  assert.equal(await revokeKindeDiagnosticSession(send, () => { throw Error('cookie unavailable'); }), 'unavailable');
  assert.equal(calls, 0);
});

void test('logout 200 cannot hide a replacement session or an ambiguous response', async () => {
  const cookies = () => '__Host-logbook_csrf=' + 'A'.repeat(43);
  const failureResponses = [
    json(403, { error: 'unauthorized' }), json(503, { error: 'unavailable' }),
    json(200, { status: 'signed-out', extra: true }),
    json(200, { status: 'still-active' }),
    new Response('ok', { status: 200, headers: { 'content-type': 'text/html' } }),
  ];
  for (const response of failureResponses) {
    let calls = 0;
    const state = await revokeKindeDiagnosticSession(async () => {
      calls += 1; return response;
    }, cookies);
    assert.equal(state, 'unavailable');
    assert.equal(calls, 1);
  }
  for (const after of [json(200, expected), json(403, { error: 'unauthorized' })]) {
    let calls = 0;
    assert.equal(await revokeKindeDiagnosticSession(async () =>
      ++calls === 1 ? json(200, { status: 'signed-out' }) : after, cookies), 'unavailable');
    assert.equal(calls, 2);
  }
  assert.equal(await revokeKindeDiagnosticSession(async () => { throw Error('offline'); }, cookies), 'unavailable');
});
