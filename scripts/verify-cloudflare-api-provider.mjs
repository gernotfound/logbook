import assert from 'node:assert/strict';

const environment = process.env;
const bearer = environment['CLOUDFLARE_API_TOKEN'];
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const DB_ID = '9aa51833-8adc-495f-bdfc-93b5542e8023';
assert.ok(typeof bearer === 'string' && bearer.length > 0, 'missing Cloudflare token');
assert.match(account ?? '', /^[a-f0-9]{32}$/, 'invalid Cloudflare account id');

async function request(path, body) {
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + account + path;
  const result = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + bearer,
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await result.json();
  assert.ok(result.ok && json.success, 'Cloudflare readback rejected: HTTP ' +
    result.status + ' (' + path.replace(DB_ID, '<db>') + ')');
  return json.result;
}

const db = await request('/d1/database/' + DB_ID);
assert.equal(db.name, 'thelogbook-cf02-eu-isolated-20261113');
assert.equal(db.jurisdiction, 'eu');
assert.equal(db.read_replication?.mode, 'disabled');

const ledger = await request('/d1/database/' + DB_ID + '/query',
  { sql: 'SELECT name FROM d1_migrations ORDER BY id' });
assert.deepEqual(ledger[0]?.results?.map(row => row.name), [
  '0001_encrypted_replica.sql',
  '0002_reject_reused_replica_ids.sql',
  '0003_auth_session_gate.sql', // Keep adjacent filenames separate for Gitleaks generic-key detection.
  '0004_initial_consent.sql',
  '0005_health_withdrawal_queue.sql',
  '0006_health_erasure_progress.sql',
  '0007_cloud_key_custody.sql', // Gitleaks: separate adjacent SQL filenames from generic-key detection.
  '0008_kinde_oauth_attempts.sql',
]);

const privateWorkers = [
  'thelogbook-cf03-auth-gate-isolated', // Prevent generic-key matching across Worker names.
  'thelogbook-api-isolated',
];
for (const name of privateWorkers) {
  const settings = await request('/workers/scripts/' + name + '/settings');
  const bindings = settings.bindings ?? [];
  assert.ok(bindings.some(binding => binding.name === 'DB' &&
    binding.type === 'd1' && (binding.id === DB_ID ||
    binding.database_id === DB_ID)), name + ': D1 binding absent or incorrect');
  if (name === 'thelogbook-api-isolated') {
    assert.ok(bindings.some(binding => binding.name === 'AUTH_GATE' &&
      binding.type === 'service' &&
      binding.service === 'thelogbook-cf03-auth-gate-isolated'),
      'API private authorization binding absent');
  } else {
    assert.ok(bindings.some(binding => binding.name === 'API_RATE_LIMITER' &&
      (binding.type === 'ratelimit' || binding.type === 'rate_limit')),
      'Auth Gate rate limiting binding absent');
  }
  const subdomain = await request('/workers/scripts/' + name + '/subdomain');
  assert.equal(subdomain.enabled, false, name + ': workers.dev exposed');
  assert.equal(subdomain.previews_enabled, false, name + ': preview exposed');
}
console.log('EU D1 migrations 0001-0008, private Auth Gate/API bindings and non-public URLs verified');
