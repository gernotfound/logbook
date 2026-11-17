import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import frontend from '../../cloudflare/auth-proxy.mjs';

const ORIGIN = 'https://thelogbook.me';
const paths = [
  '/api/auth/kinde/start', '/api/auth/kinde/callback',
  '/api/auth/session', '/api/auth/logout',
];

function harness(reply = async () => new Response(null, {
  status: 303, headers: {
    Location: 'https://thelogbook.kinde.com/oauth2/auth',
    'Cache-Control': 'no-store',
    'Set-Cookie': '__Host-logbook_oauth=synthetic; Secure; HttpOnly; SameSite=Lax',
  },
})) {
  const requests = [];
  const env = {
    APP_ORIGIN: ORIGIN,
    KINDE_HTTP: {
      fetch: async request => {
        requests.push(request);
        return reply(request);
      },
    },
  };
  return { env, requests };
}
function post(path, headers = {}) {
  return new Request(ORIGIN + path, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', ...headers },
  });
}
function get(path, headers = {}) {
  return new Request(ORIGIN + path, { headers });
}

void test('frontend mounts only four exact Kinde routes, never a wildcard or D1 health API', () => {
  const config = JSON.parse(readFileSync(
    new URL('../../cloudflare/wrangler.jsonc', import.meta.url), 'utf8',
  ));
  assert.deepEqual(config.assets.run_worker_first, [
    '/__/auth', '/__/auth/*', ...paths,
  ]);
  assert.deepEqual(config.services, [{
    binding: 'KINDE_HTTP', service: 'thelogbook-cf03-kinde-http-isolated',
  }]);
  assert.deepEqual(config.vars, { APP_ORIGIN: ORIGIN });
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes.length, 1);
  assert.equal(config.routes[0].pattern, 'thelogbook.me');
});

void test('OAuth start passes only first-party headers and preserves browser 303 and host-only cookie', async () => {
  const { env, requests } = harness();
  const request = post(paths[0], {
    Cookie: '__Host-logbook_oauth=synthetic',
    Authorization: 'Bearer should-not-forward',
    'x-original-route': '/v1/consent/withdraw',
    'cf-connecting-ip': '127.0.0.1',
  });
  const response = await frontend.fetch(request, env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://thelogbook.kinde.com/oauth2/auth');
  assert.match(response.headers.get('set-cookie') ?? '', /__Host-logbook_oauth=/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, ORIGIN + paths[0]);
  assert.equal(requests[0].method, 'POST');
  for (const field of ['authorization', 'x-original-route', 'cf-connecting-ip']) {
    assert.equal(requests[0].headers.has(field), false);
  }
  assert.equal(requests[0].headers.get('origin'), ORIGIN);
  assert.equal(requests[0].redirect, 'manual');
});

void test('OAuth callback accepts cross-site navigation while preserving state and original cookies', async () => {
  const { env, requests } = harness();
  const query = '?code=synthetic&scope=openid%20email%20profile&state=' + 'A'.repeat(43);
  const response = await frontend.fetch(get(paths[1] + query, {
    'Sec-Fetch-Site': 'cross-site',
    Cookie: '__Host-logbook_oauth=synthetic',
  }), env);
  assert.equal(response.status, 303);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, ORIGIN + paths[1] + query);
  assert.equal(requests[0].headers.get('cookie'), '__Host-logbook_oauth=synthetic');
  assert.equal(requests[0].headers.get('sec-fetch-site'), 'cross-site');
});

void test('all session/health/API boundaries fail closed when not explicitly mounted', async () => {
  const { env, requests } = harness(async () => new Response('denied', {
    status: 401, headers: { 'Cache-Control': 'no-store' },
  }));
  for (const bad of [
    '/v1/sync/commit', '/v1/consent/status', '/v1/cloud-key/sync',
    '/api/auth/kinde/unapproved', '/api/auth/kinde/start/extra',
    '/api/auth/provider', '/api/session',
  ]) {
    assert.equal((await frontend.fetch(post(bad), env)).status, 404, bad);
  }
  assert.equal(requests.length, 0);
  const auth = await frontend.fetch(post('/api/auth/session'), env);
  assert.equal(auth.status, 401);
  assert.equal(auth.headers.get('cache-control'), 'no-store');
  assert.equal(requests.length, 1);
});

void test('missing service, wrong site, denied origins and unsupported methods never create OAuth state', async () => {
  const { env, requests } = harness();
  assert.equal((await frontend.fetch(post(paths[0]), {
    APP_ORIGIN: ORIGIN,
  })).status, 503);
  assert.equal((await frontend.fetch(post(paths[0]), {
    ...env, APP_ORIGIN: 'https://attacker.invalid',
  })).status, 503);
  assert.equal((await frontend.fetch(post(paths[0], {
    Origin: 'https://attacker.invalid',
  }), env)).status, 403);
  assert.equal((await frontend.fetch(post(paths[0], {
    'Sec-Fetch-Site': 'cross-site',
  }), env)).status, 403);
  assert.equal((await frontend.fetch(get(paths[0]), env)).status, 405);
  assert.equal((await frontend.fetch(post(paths[0] + '?next=/'), env)).status, 400);
  assert.equal((await frontend.fetch(get(paths[1], { 'Sec-Fetch-Site': 'cross-site' }), env)).status, 303);
  assert.equal(requests.length, 1);
});

void test('backend error or missing no-store cannot be promoted to frontend success', async () => {
  const bad = harness(async () => new Response('danger', {
    status: 200, headers: { 'Cache-Control': 'public, max-age=60' },
  }));
  assert.equal((await frontend.fetch(post(paths[0]), bad.env)).status, 502);
  const unavailable = harness(async () => { throw Error('backend unavailable'); });
  assert.equal((await frontend.fetch(post(paths[0]), unavailable.env)).status, 503);
});

void test('frontend preserves only non-sensitive callback phase after a private verified-state failure', async () => {
  const { env } = harness(async () => Response.json({
    error: 'authentication-unavailable', phase: 'id-claims',
  }, { status: 503, headers: { 'Cache-Control': 'no-store' } }));
  const response = await frontend.fetch(get(paths[1] +
    '?code=synthetic-opaque-code&scope=openid%20email%20profile&state=' + 'A'.repeat(43), {
    Cookie: '__Host-logbook_oauth=synthetic-browser',
    'Sec-Fetch-Site': 'cross-site',
  }), env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'authentication-unavailable', phase: 'id-claims',
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.has('set-cookie'), false);
});

void test('OAuth publication is gated by complete private Worker readback before edge deployment', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/cloudflare-candidate.yml', import.meta.url),
    'utf8',
  );
  const gate = workflow.indexOf(
    'node scripts/verify-cloudflare-kinde-private-provider.mjs --require-configured-oauth',
  );
  const deploy = workflow.indexOf('command: deploy --config cloudflare/wrangler.jsonc');
  assert.ok(gate > 0 && deploy > gate, 'OAuth provider gate must precede public deploy');
  assert.match(workflow, /for path in \/api\/auth\/kinde\/start \/api\/auth\/session \/api\/auth\/logout; do/);
  assert.match(workflow, /for path in \/api\/auth\/kinde\/unapproved \/v1\/cloud-key\/sync \/v1\/consent\/status; do/);
});

void test('CSP permits only the Kinde hosted form redirect, never a wildcard destination', () => {
  const headers = readFileSync(new URL('../../cloudflare/_headers', import.meta.url), 'utf8');
  const csp = headers.split('\n').find(line => line.startsWith('  Content-Security-Policy:'));
  assert.ok(csp);
  assert.ok(csp.includes("form-action 'self' https://thelogbook.kinde.com;"));
  assert.ok(csp.includes("frame-ancestors 'none';"));
  assert.ok(csp.includes("base-uri 'self';"));
  assert.doesNotMatch(csp, /form-action [^;]*\*/);
});
