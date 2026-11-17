import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKER = 'thelogbook-cf03-kinde-http-isolated';
const GATE = 'thelogbook-cf03-auth-gate-isolated';
const DB_ID = '9aa51833-8adc-495f-bdfc-93b5542e8023';
const CORE_BINDINGS = ['APP_ORIGIN', 'AUTH_GATE', 'AUTH_RATE_LIMITER', 'DB'];
const OAUTH_SECRETS = [
  'KINDE_ISSUER', 'KINDE_CLIENT_ID', 'KINDE_CLIENT_SECRET',
  'KINDE_API_AUDIENCE', 'KINDE_ID_TOKEN_AUDIENCE',
];

export async function verifyPrivateKindeWorker({ account, bearer, request = fetch, requireConfiguredOAuth = false }) {
  assert.match(account ?? '', /^[a-f0-9]{32}$/, 'invalid Cloudflare account id');
  assert.ok(typeof bearer === 'string' && bearer.length > 0, 'missing Cloudflare token');
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + account +
    '/workers/scripts/' + WORKER;

  async function read(path) {
    const response = await request(base + path, {
      method: 'GET', headers: { Authorization: 'Bearer ' + bearer },
    });
    assert.ok(response.ok, 'Kinde private Worker readback HTTP ' + response.status);
    const body = await response.json();
    assert.ok(body?.success && body.result, 'Kinde private Worker readback failed');
    return body.result;
  }

  const [settings, subdomain] = await Promise.all([
    read('/settings'), read('/subdomain'),
  ]);
  const bindings = settings?.bindings;
  assert.ok(Array.isArray(bindings), 'Kinde private Worker settings missing');
  const secrets = bindings.filter(binding => binding.type === 'secret_text');
  // Never accept an incomplete OAuth configuration or an unexpected secret.
  // Before provisioning, the isolated Worker intentionally has no credentials.
  assert.ok(secrets.length === 0 || secrets.length === OAUTH_SECRETS.length,
    'Kinde private Worker has an incomplete OAuth secret configuration');
  const expected = [...CORE_BINDINGS, ...(secrets.length ? OAUTH_SECRETS : [])].sort();
  assert.deepEqual(bindings.map(binding => binding.name).sort(), expected,
    'Kinde private Worker has a missing or unapproved binding');
  for (const name of OAUTH_SECRETS) {
    if (secrets.length) {
      assert.equal(secrets.find(binding => binding.name === name)?.type, 'secret_text',
        'Kinde OAuth credential must be stored only as a Worker secret');
    }
  }
  if (requireConfiguredOAuth) {
    assert.equal(secrets.length, OAUTH_SECRETS.length,
      'Kinde OAuth not provisioned: refusing to expose browser route');
  }
  const binding = name => bindings.find(item => item.name === name);
  assert.ok(binding('DB')?.type === 'd1' && binding('DB').id === DB_ID
    && (!binding('DB').database_id || binding('DB').database_id === DB_ID),
  'Kinde private Worker D1 UUID does not match isolated schema');
  assert.ok(binding('AUTH_GATE')?.type === 'service'
    && binding('AUTH_GATE').service === GATE,
  'Kinde private Worker Auth Gate service is missing');
  assert.ok(['ratelimit', 'rate_limit'].includes(binding('AUTH_RATE_LIMITER')?.type)
    && binding('AUTH_RATE_LIMITER').namespace_id === '31004',
  'Kinde private Worker OAuth limiter does not match the approved namespace');
  assert.ok(binding('APP_ORIGIN')?.type === 'plain_text'
    && binding('APP_ORIGIN').text === 'https://thelogbook.me',
  'Kinde private Worker origin is incorrect');
  assert.equal(subdomain?.enabled, false, 'Kinde private Worker workers.dev exposed');
  assert.equal(subdomain?.previews_enabled, false, 'Kinde private Worker preview exposed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyPrivateKindeWorker({
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    bearer: process.env.CLOUDFLARE_API_TOKEN,
    requireConfiguredOAuth: process.argv.includes('--require-configured-oauth'),
  });
  console.log('Kinde HTTP Worker verified: private bindings and disabled workers.dev / preview');
}
