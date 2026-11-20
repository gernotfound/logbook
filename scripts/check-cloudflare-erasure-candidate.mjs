import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateIsolatedWorkers } from './check-cloudflare-api-isolation.mjs';

export function validateErasureCandidate(config, api) {
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  check(config?.name === 'thelogbook-cf06-health-erasure-isolated'
    && config?.main === './health-erasure-worker.mjs'
    && config?.compatibility_date === '2026-11-12',
  'erasure: Worker identity or runtime mismatch');
  check(config?.workers_dev === false && config?.preview_urls === false,
  'erasure: public URL exposure');
  // A D1 erasure Worker cannot be implicitly activated by merely adding
  // this candidate manifest. Scheduling and production deployment need GO.
  check(Object.keys(config ?? {}).sort().join(',') ===
    'compatibility_date,d1_databases,main,name,preview_urls,workers_dev',
  'erasure: unapproved route, schedule, binding or capability');
  const actual = config?.d1_databases;
  const expected = api?.d1_databases;
  check(Array.isArray(actual) && actual.length === 2
    && Array.isArray(expected) && expected.length === 2
    && actual[0]?.binding === 'DB'
    && actual[1]?.binding === 'RECOVERY_DB'
    && actual[0]?.database_id !== actual[1]?.database_id
    && actual[0]?.database_name === expected[0]?.database_name
    && actual[0]?.database_id === expected[0]?.database_id
    && actual[1]?.database_name === expected[1]?.database_name
    && actual[1]?.database_id === expected[1]?.database_id
    && actual[0]?.migrations_dir === '../api/migrations'
    && actual[1]?.migrations_dir === '../recovery/migrations'
    && actual.every(db => Object.keys(db).sort().join(',') ===
      'binding,database_id,database_name,migrations_dir'),
  'erasure: primary and independent D1 bindings must match the verified isolated API');
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const api = JSON.parse(readFileSync('cloudflare/api/wrangler.isolated.jsonc', 'utf8'));
  const gate = JSON.parse(readFileSync('cloudflare/auth/wrangler.isolated.jsonc', 'utf8'));
  const candidate = JSON.parse(readFileSync('cloudflare/jobs/wrangler.isolated.jsonc', 'utf8'));
  assert.deepEqual(validateIsolatedWorkers(api, gate), []);
  assert.deepEqual(validateErasureCandidate(candidate, api), []);
  console.log('CF-06 erasure Worker candidate is private, unscheduled and bound to two independent isolated D1 databases');
}
