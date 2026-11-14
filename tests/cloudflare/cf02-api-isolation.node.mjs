import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateIsolatedWorkers } from '../../scripts/check-cloudflare-api-isolation.mjs';

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
});
void test('rejects missing rate limiter, origin changes and injected vars', () => {
  assert.notDeepEqual(validate(api, { ...gate, ratelimits: [] }), []);
  assert.notDeepEqual(validate({ ...api, vars: { ...api.vars, API_ORIGIN: 'https://candidate.invalid' } }, gate), []);
  assert.notDeepEqual(validate({ ...api, vars: { ...api.vars, EXTRA_SECRET: 'bad' } }, gate), []);
});
