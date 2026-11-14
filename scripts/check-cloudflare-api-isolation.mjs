import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DB_ID = '9aa51833-8adc-495f-bdfc-93b5542e8023';
const DB_NAME = 'thelogbook-cf02-eu-isolated-20261113';
const GATE = 'thelogbook-cf03-auth-gate-isolated';
const WORKER_NAME = 'thelogbook-api-isolated';
const ORIGIN = 'https://thelogbook.me';

export function validateIsolatedWorkers(api, gate) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  for (const [label, cfg, name, main, migrations] of [
    ['api', api, WORKER_NAME, './worker.mjs', './migrations'],
    ['auth-gate', gate, GATE, './session-gate.mjs', '../api/migrations'],
  ]) {
    check(cfg.name === name && cfg.main === main, label + ': wrong Worker');
    check(cfg.compatibility_date === '2026-11-12', label + ': runtime mismatch');
    check(cfg.workers_dev === false && cfg.preview_urls === false, label + ': URL exposure');
    check(!['route', 'routes', 'assets', 'triggers', 'unsafe'].some(key => Object.hasOwn(cfg, key)),
      label + ': unexpected external surface');
    const db = cfg.d1_databases?.[0];
    check(cfg.d1_databases?.length === 1 && db?.binding === 'DB' &&
      db?.database_name === DB_NAME && db?.database_id === DB_ID &&
      db?.migrations_dir === migrations, label + ': unverified D1 target');
    check(cfg.vars?.API_ORIGIN === ORIGIN &&
      cfg.vars?.CONSENT_PRIVACY_VERSION === '1.3.9' &&
      cfg.vars?.CONSENT_TERMS_VERSION === '1.2.5' &&
      Object.keys(cfg.vars ?? {}).sort().join(',') ===
        'API_ORIGIN,CONSENT_PRIVACY_VERSION,CONSENT_TERMS_VERSION',
      label + ': origin/legal/secret mismatch');
  }
  check(api.services?.length === 1 && api.services[0]?.binding === 'AUTH_GATE' &&
    api.services[0]?.service === GATE, 'api: private Auth Gate missing');
  check(!Object.hasOwn(api, 'ratelimits') &&
    Object.keys(api).sort().join(',') ===
      'compatibility_date,d1_databases,main,name,preview_urls,services,vars,workers_dev',
    'api: unapproved binding');
  check(gate.ratelimits?.length === 1 &&
    gate.ratelimits[0]?.name === 'API_RATE_LIMITER' &&
    gate.ratelimits[0]?.namespace_id === '31003' &&
    gate.ratelimits[0]?.simple?.limit === 60 &&
    gate.ratelimits[0]?.simple?.period === 60 &&
    Object.keys(gate).sort().join(',') ===
      'compatibility_date,d1_databases,main,name,preview_urls,ratelimits,vars,workers_dev',
    'auth-gate: limiter missing or unapproved binding');
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.deepEqual(validateIsolatedWorkers(
    JSON.parse(readFileSync('cloudflare/api/wrangler.isolated.jsonc', 'utf8')),
    JSON.parse(readFileSync('cloudflare/auth/wrangler.isolated.jsonc', 'utf8')),
  ), []);
  console.log('Verified isolated API/Auth Gate config, private binding and EU D1 identity');
}
