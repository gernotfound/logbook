import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DB_ID = '9aa51833-8adc-495f-bdfc-93b5542e8023';
const GATE_NAME = 'thelogbook-cf03-auth-gate-isolated';
const DATA_WORKER_NAME = 'thelogbook-api-isolated';

// The deploy token is scoped to Workers only. D1 schema and jurisdiction
// require an independently authorized provider readback, not a broader
// deployment credential with permission to execute remote SQL.
export async function verifyPrivateWorkerBindings({ account, bearer, request = fetch }) {
  assert.match(account ?? '', /^[a-f0-9]{32}$/, 'invalid Cloudflare account id');
  assert.ok(typeof bearer === 'string' && bearer.length > 0, 'missing Cloudflare token');

  async function read(path) {
    const response = await request('https://api.cloudflare.com/client/v4/accounts/' +
      account + path, { method: 'GET', headers: { Authorization: 'Bearer ' + bearer } });
    assert.ok(response.ok, 'Cloudflare Workers readback HTTP ' + response.status);
    const body = await response.json();
    assert.ok(body.success, 'Cloudflare Workers readback failed');
    return body.result;
  }

  for (const name of [GATE_NAME, DATA_WORKER_NAME]) {
    const settings = await read('/workers/scripts/' + name + '/settings');
    const bindings = settings?.bindings ?? [];
    assert.ok(bindings.some(binding => binding.name === 'DB' &&
      binding.type === 'd1' && binding.id === DB_ID &&
      (!binding.database_id || binding.database_id === DB_ID)),
      name + ': D1 UUID binding absent or incorrect');
    if (name === DATA_WORKER_NAME) {
      assert.ok(bindings.some(binding => binding.name === 'AUTH_GATE' &&
        binding.type === 'service' && binding.service === GATE_NAME),
        'private API authorization binding absent');
    } else {
      assert.ok(bindings.some(binding => binding.name === 'API_RATE_LIMITER' &&
        (binding.type === 'ratelimit' || binding.type === 'rate_limit') &&
        binding.namespace_id === '31003'),
        'Auth Gate limiter absent or incorrect');
    }
    const subdomain = await read('/workers/scripts/' + name + '/subdomain');
    assert.equal(subdomain.enabled, false, name + ': workers.dev exposed');
    assert.equal(subdomain.previews_enabled, false, name + ': preview exposed');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyPrivateWorkerBindings({
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    bearer: process.env['CLOUDFLARE_API_TOKEN'],
  });
  console.log('Cloudflare provider verified private API/Auth Gate, EU D1 UUID bindings and disabled public URLs');
}
