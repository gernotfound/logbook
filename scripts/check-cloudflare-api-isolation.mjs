import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DB_ID = '9aa51833-8adc-495f-bdfc-93b5542e8023';
const DB_NAME = 'thelogbook-cf02-eu-isolated-20261113';
const RECOVERY_DB_ID = '19dad53f-0dda-4503-b161-758ac8cb7b21';
const RECOVERY_DB_NAME = 'thelogbook-cf08-fence-eu-isolated-20261116';
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
    check(cfg.d1_databases?.length === (label === 'api' ? 2 : 1)
      && db?.binding === 'DB' && db?.database_name === DB_NAME
      && db?.database_id === DB_ID && db?.migrations_dir === migrations,
    label + ': unverified D1 target');
    if (label === 'api') {
      const recovery = cfg.d1_databases?.[1];
      check(recovery?.binding === 'RECOVERY_DB'
        && recovery?.database_name === RECOVERY_DB_NAME
        && recovery?.database_id === RECOVERY_DB_ID
        && recovery?.migrations_dir === '../recovery/migrations'
        && recovery.database_id !== db?.database_id,
      'api: independent recovery D1 binding missing or incorrect');
    }
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

// Keep the Kinde Worker privately isolated even when the public frontend
// exposes only four authentication endpoints for controlled OAuth testing.
export function validateIsolatedKindeCandidate(kinde, gate, frontend) {
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  check(kinde?.name === 'thelogbook-cf03-kinde-http-isolated'
    && kinde?.main === './kinde-http-worker.mjs'
    && kinde?.compatibility_date === '2026-11-14', 'kinde: wrong Worker or runtime');
  check(kinde?.workers_dev === false && kinde?.preview_urls === false
    && !['route', 'routes', 'assets', 'triggers', 'unsafe'].some(key => Object.hasOwn(kinde ?? {}, key)),
  'kinde: public exposure');
  const db = kinde?.d1_databases?.[0], gateDb = gate?.d1_databases?.[0];
  check(kinde?.d1_databases?.length === 1 && db?.binding === 'DB'
    && db?.database_name === DB_NAME && db?.database_id === DB_ID
    && db?.migrations_dir === '../api/migrations'
    && gateDb?.database_name === db?.database_name && gateDb?.database_id === db?.database_id,
  'kinde: wrong or inconsistent D1');
  check(kinde?.services?.length === 1
    && kinde?.services[0]?.binding === 'AUTH_GATE'
    && kinde?.services[0]?.service === GATE && gate?.name === GATE,
  'kinde: private authorization service missing');
  check(kinde?.ratelimits?.length === 1
    && kinde.ratelimits[0]?.name === 'AUTH_RATE_LIMITER'
    && kinde.ratelimits[0]?.namespace_id === '31004'
    && kinde.ratelimits[0]?.simple?.limit === 20
    && kinde.ratelimits[0]?.simple?.period === 60, 'kinde: OAuth rate gate changed');
  check(kinde?.vars?.APP_ORIGIN === ORIGIN
    && Object.keys(kinde?.vars ?? {}).join(',') === 'APP_ORIGIN',
  'kinde: origin/provider configuration unexpectedly committed');
  check(Object.keys(kinde ?? {}).sort().join(',') ===
    'compatibility_date,d1_databases,main,name,preview_urls,ratelimits,services,vars,workers_dev',
  'kinde: unreviewed binding');
  check(frontend?.name === 'thelogbook-frontend'
    && frontend?.main === './auth-proxy.mjs'
    && frontend?.assets?.run_worker_first?.join(',') ===
      '/__/auth,/__/auth/*,/api/auth/kinde/start,/api/auth/kinde/callback,/api/auth/session,/api/auth/logout'
    && frontend?.services?.length === 1
    && frontend.services[0]?.binding === 'KINDE_HTTP'
    && frontend.services[0]?.service === 'thelogbook-cf03-kinde-http-isolated'
    && frontend?.vars?.APP_ORIGIN === ORIGIN
    && Object.keys(frontend?.vars ?? {}).join(',') === 'APP_ORIGIN',
  'kinde: frontend OAuth-only route or binding mismatch');
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.deepEqual(validateIsolatedWorkers(
    JSON.parse(readFileSync('cloudflare/api/wrangler.isolated.jsonc', 'utf8')),
    JSON.parse(readFileSync('cloudflare/auth/wrangler.isolated.jsonc', 'utf8')),
  ), []);
  assert.deepEqual(validateIsolatedKindeCandidate(
    JSON.parse(readFileSync('cloudflare/auth/wrangler.kinde.isolated.jsonc', 'utf8')),
    JSON.parse(readFileSync('cloudflare/auth/wrangler.isolated.jsonc', 'utf8')),
    JSON.parse(readFileSync('cloudflare/wrangler.jsonc', 'utf8')),
  ), []);
  console.log('Verified private API/Auth Gate and unrouted Kinde candidate on the EU D1');
}
