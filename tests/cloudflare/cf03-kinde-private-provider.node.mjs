import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { privateDeploymentPaths } from '../../scripts/cloudflare-private-deploy-plan.mjs';
import { verifyPrivateKindeWorker } from '../../scripts/verify-cloudflare-kinde-private-provider.mjs';

const account = '0123456789abcdef0123456789abcdef';
const worker = 'thelogbook-cf03-kinde-http-isolated';
const prefix = '/client/v4/accounts/' + account + '/workers/scripts/' + worker;
const domainsPath = '/client/v4/accounts/' + account + '/workers/domains';
const id = '9aa51833-8adc-495f-bdfc-93b5542e8023';
const bindings = [
  { name: 'DB', type: 'd1', id, database_id: id },
  { name: 'AUTH_GATE', type: 'service', service: 'thelogbook-cf03-auth-gate-isolated' },
  { name: 'AUTH_RATE_LIMITER', type: 'ratelimit', namespace_id: '31004' },
  { name: 'APP_ORIGIN', type: 'plain_text', text: 'https://thelogbook.me' },
];

function fakeClient(changes = {}) {
  const calls = [];
  const request = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    const item = changes[path] ?? { success: true, result: path === domainsPath
      ? [{ service: 'thelogbook-frontend', hostname: 'thelogbook.me' }]
      : path.endsWith('/settings') ? { bindings }
        : path.endsWith('/schedules') ? { schedules: [] }
          : { enabled: false, previews_enabled: false } };
    return { ok: (item.status ?? 200) < 400, status: item.status ?? 200,
      json: async () => item };
  };
  return { request, calls };
}

const args = client => ({ account, bearer: 'synthetic-bearer', request: client.request });

void test('reads exact private binding set and URL isolation, without SQL writes', async () => {
  const client = fakeClient();
  await verifyPrivateKindeWorker(args(client));
  assert.deepEqual(client.calls.map(c => c.path).sort(),
    [prefix + '/settings', prefix + '/subdomain', prefix + '/schedules', domainsPath].sort());
  assert.ok(client.calls.every(c => c.init.method === 'GET'
    && c.init.headers.Authorization === 'Bearer synthetic-bearer'));
});

void test('refuses every absent or altered binding, including malicious secret injection', async () => {
  for (const name of ['DB', 'AUTH_GATE', 'AUTH_RATE_LIMITER', 'APP_ORIGIN']) {
    const client = fakeClient({ [prefix + '/settings']: {
      success: true, result: { bindings: bindings.filter(b => b.name !== name) },
    } });
    await assert.rejects(verifyPrivateKindeWorker(args(client)), /missing or unapproved/);
  }
  for (const altered of [
    bindings.map(b => b.name === 'DB' ? { ...b, id: 'wrong' } : b),
    bindings.map(b => b.name === 'AUTH_GATE' ? { ...b, service: 'wrong' } : b),
    bindings.map(b => b.name === 'AUTH_RATE_LIMITER' ? { ...b, namespace_id: 'wrong' } : b),
    bindings.map(b => b.name === 'APP_ORIGIN' ? { ...b, text: 'https://wrong.invalid' } : b),
    [...bindings, { name: 'PRODUCTION_SECRET', type: 'secret_text' }],
  ]) {
    const client = fakeClient({ [prefix + '/settings']: {
      success: true, result: { bindings: altered },
    } });
    await assert.rejects(verifyPrivateKindeWorker(args(client)));
  }
});

void test('fails closed on public workers.dev, preview and unverified provider responses', async () => {
  for (const result of [
    { enabled: true, previews_enabled: false },
    { enabled: false, previews_enabled: true },
    {},
  ]) {
    const client = fakeClient({ [prefix + '/subdomain']: { success: true, result } });
    await assert.rejects(verifyPrivateKindeWorker(args(client)));
  }
  const missing = fakeClient({ [prefix + '/settings']: {
    success: false, status: 404, result: null,
  } });
  await assert.rejects(verifyPrivateKindeWorker(args(missing)), /HTTP 404/);
  const denied = fakeClient({ [prefix + '/settings']: {
    success: false, status: 403, result: null,
  } });
  await assert.rejects(verifyPrivateKindeWorker(args(denied)), /HTTP 403/);
  const malformed = fakeClient({ [prefix + '/settings']: {
    success: false, result: { bindings },
  } });
  await assert.rejects(verifyPrivateKindeWorker(args(malformed)), /readback failed/);
});

void test('fails closed on an attached domain, scheduled trigger or missing provider inventories', async () => {
  for (const result of [
    [{ service: worker, hostname: 'unapproved.example' }],
    null, {}, [{ hostname: 'unknown.example' }],
  ]) {
    const client = fakeClient({ [domainsPath]: { success: true, result } });
    await assert.rejects(verifyPrivateKindeWorker(args(client)), /domain|readback failed/);
  }
  for (const result of [{ schedules: [{ cron: '0 0 * * *' }] }, {}, null]) {
    const client = fakeClient({ [prefix + '/schedules']: { success: true, result } });
    await assert.rejects(verifyPrivateKindeWorker(args(client)), /scheduled trigger|readback failed/);
  }
  const denied = fakeClient({ [domainsPath]: { status: 403, success: false } });
  await assert.rejects(verifyPrivateKindeWorker(args(denied)), /HTTP 403/);
});

void test('deployment changes only Kinde Worker after exact-main verification and no public route', () => {
  const yml = readFileSync(
    new URL('../../.github/workflows/cloudflare-kinde-private.yml', import.meta.url),
    'utf8',
  );
  assert.match(yml, /^    branches:\n      - main$/m);
  // A change to the OAuth implementation must update the *private* live Worker,
  // not just the Static Assets frontend, after the exact-main release gate.
  const watch = privateDeploymentPaths('.github/workflows/cloudflare-kinde-private.yml');
  assert.ok(watch.includes('cloudflare/auth/**'));
  assert.ok(watch.includes('cloudflare/api/logout-worker.mjs'));
  assert.ok(watch.includes('.github/workflows/cloudflare-kinde-private.yml'));

  assert.match(yml, /github.ref == 'refs\/heads\/main'/);
  assert.match(yml, /Verify completed exact-main release and decide deployment relevance/);
  assert.match(yml, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(yml, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.match(yml, /npx --yes wrangler@4\.159\.0 deploy --dry-run --config cloudflare\/auth\/wrangler\.kinde\.isolated\.jsonc/);
  assert.match(yml, /command: deploy --config cloudflare\/auth\/wrangler\.kinde\.isolated\.jsonc/);
  assert.match(yml, /node scripts\/verify-cloudflare-kinde-private-provider\.mjs/);
  assert.equal(
    yml.split('node scripts/verify-cloudflare-kinde-private-provider.mjs --require-configured-oauth').length - 1,
    2,
    'Both preflight and post-deploy readbacks must attest all five Kinde secrets',
  );
  assert.doesNotMatch(yml, /command: deploy --config cloudflare\/(?:api\/wrangler|auth\/wrangler\.isolated|wrangler\.jsonc)/);
  const preflight = yml.indexOf('name: Read back complete private OAuth bindings before deployment');
  const lease = yml.indexOf('name: Confirm exact-main lease immediately before provider write');
  const deploy = yml.indexOf('name: Deploy only the unrouted Kinde HTTP Worker');
  assert.ok(preflight > 0 && preflight < lease && lease < deploy);
  assert.doesNotMatch(yml, /route:|routes:|workers_dev: true|preview_urls: true|secret put/);
});

void test('OAuth secrets are accepted only when all five names exist as server-only secrets', async () => {
  const secretNames = [
    'KINDE_ISSUER', 'KINDE_CLIENT_ID', 'KINDE_CLIENT_SECRET',
    'KINDE_API_AUDIENCE', 'KINDE_ID_TOKEN_AUDIENCE',
  ];
  const complete = [...bindings, ...secretNames.map(name => ({ name, type: 'secret_text' }))];
  const valid = fakeClient({
    [prefix + '/settings']: { success: true, result: { bindings: complete } },
  });
  await verifyPrivateKindeWorker({ ...args(valid), requireConfiguredOAuth: true });
  await assert.rejects(verifyPrivateKindeWorker({
    ...args(fakeClient()), requireConfiguredOAuth: true,
  }), /not provisioned/);
  for (const omitted of secretNames) {
    const client = fakeClient({ [prefix + '/settings']: {
      success: true,
      result: { bindings: complete.filter(item => item.name !== omitted) },
    } });
    await assert.rejects(verifyPrivateKindeWorker(args(client)), /incomplete/);
  }
  const plaintext = fakeClient({ [prefix + '/settings']: {
    success: true,
    result: { bindings: complete.map(item => item.name === 'KINDE_CLIENT_SECRET'
      ? { ...item, type: 'plain_text' } : item) },
  } });
  await assert.rejects(verifyPrivateKindeWorker(args(plaintext)));
});
