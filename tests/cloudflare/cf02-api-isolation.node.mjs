import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateIsolatedWorkers, validateIsolatedKindeCandidate } from '../../scripts/check-cloudflare-api-isolation.mjs';

const api = JSON.parse(readFileSync('cloudflare/api/wrangler.isolated.jsonc', 'utf8'));
const gate = JSON.parse(readFileSync('cloudflare/auth/wrangler.isolated.jsonc', 'utf8'));
const validate = (a, g) => validateIsolatedWorkers(a, g);

void test('isolated Workers share the EU D1 and gate via private service binding', () => {
  assert.deepEqual(validate(api, gate), []);
});
void test('rejects accidental Worker public exposure', () => {
  for (const change of [
    { workers_dev: true }, { preview_urls: true },
    { routes: [{ pattern: 'thelogbook.me/api/*' }] },
    { assets: { directory: '../dist' } },
  ]) assert.notDeepEqual(validate({ ...api, ...change }, gate), []);
});
void test('rejects database substitutions and missing private authorization', () => {
  assert.notDeepEqual(validate({ ...api, d1_databases: [{ ...api.d1_databases[0], database_id: 'different' }] }, gate), []);
  assert.notDeepEqual(validate({ ...api, services: [] }, gate), []);
  assert.notDeepEqual(validate(api, { ...gate, d1_databases: [] }), []);
  for (const altered of [
    api.d1_databases.slice(0, 1),
    [{ ...api.d1_databases[0] }, { ...api.d1_databases[1], database_id: 'untrusted' }],
    [{ ...api.d1_databases[0] }, { ...api.d1_databases[1], database_id: api.d1_databases[0].database_id }],
    [{ ...api.d1_databases[0] }, { ...api.d1_databases[1], binding: 'DB' }],
  ]) assert.notDeepEqual(validate({ ...api, d1_databases: altered }, gate), []);

});
void test('rejects missing rate limiter, origin changes and injected vars', () => {
  assert.notDeepEqual(validate(api, { ...gate, ratelimits: [] }), []);
  assert.notDeepEqual(validate({ ...api, vars: { ...api.vars, API_ORIGIN: 'https://candidate.invalid' } }, gate), []);
  assert.notDeepEqual(validate({ ...api, vars: { ...api.vars, EXTRA_SECRET: 'bad' } }, gate), []);
});

const kinde = JSON.parse(readFileSync('cloudflare/auth/wrangler.kinde.isolated.jsonc', 'utf8'));
const frontend = JSON.parse(readFileSync('cloudflare/wrangler.jsonc', 'utf8'));

void test('pre-activation Kinde Worker shares only the isolated EU D1 and private Auth Gate', () => {
  assert.deepEqual(validateIsolatedKindeCandidate(kinde, gate, frontend), []);
});
void test('pre-activation Kinde rejects public routes, wrong storage, no rate limiter or checked-in secrets', () => {
  for (const wrong of [
    { ...kinde, workers_dev: true },
    { ...kinde, preview_urls: true },
    { ...kinde, routes: [{ pattern: 'thelogbook.me/api/*' }] },
    { ...kinde, assets: { directory: '../dist' } },
    { ...kinde, services: [] },
    { ...kinde, d1_databases: [{ ...kinde.d1_databases[0], database_id: 'wrong' }] },
    { ...kinde, ratelimits: [] },
    { ...kinde, vars: { APP_ORIGIN: 'https://wrong.example' } },
    { ...kinde, vars: { ...kinde.vars, KINDE_CLIENT_SECRET: 'synthetic-do-not-use' } },
    { ...kinde, observability: { enabled: true } },
  ]) assert.notDeepEqual(validateIsolatedKindeCandidate(wrong, gate, frontend), []);
  assert.notDeepEqual(validateIsolatedKindeCandidate(kinde, { ...gate, name: 'wrong-gate' }, frontend), []);
  assert.notDeepEqual(validateIsolatedKindeCandidate(kinde, gate, {
    ...frontend, assets: { ...frontend.assets, run_worker_first: ['/__/auth', '/__/auth/*', '/api/auth/*'] },
  }), []);
});

void test('OAuth-only frontend rejects extra D1 routes and unapproved service or secret bindings', () => {
  for (const wrong of [
    { ...frontend, services: [] },
    { ...frontend, services: [{ binding: 'KINDE_HTTP', service: 'untrusted' }] },
    { ...frontend, services: [...frontend.services, { binding: 'D1_API', service: 'thelogbook-api-isolated' }] },
    { ...frontend, vars: { ...frontend.vars, KINDE_CLIENT_SECRET: 'forbidden' } },
    { ...frontend, assets: { ...frontend.assets, run_worker_first: [
      ...frontend.assets.run_worker_first, '/v1/consent/*',
    ] } },
    { ...frontend, assets: { ...frontend.assets, run_worker_first: [
      '/__/auth', '/__/auth/*', '/api/auth/*',
    ] } },
  ]) {
    assert.notDeepEqual(validateIsolatedKindeCandidate(kinde, gate, wrong), []);
  }
});
