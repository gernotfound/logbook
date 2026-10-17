import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const prod = JSON.parse(readFileSync('vercel.json', 'utf8'));
const test = JSON.parse(readFileSync('vercel.test.json', 'utf8'));

assert.deepEqual(test.git?.deploymentEnabled, { main: false, '**': false },
  'Test Vercel must never deploy automatically from main or any branch');
assert.equal(test.framework, null);
assert.equal(test.buildCommand, 'node scripts/prepare-vercel-backend-static.mjs');
assert.equal(test.outputDirectory, 'vercel-backend-static');
assert.equal(test.fluid, true);
assert.ok(Array.isArray(test.crons) === false || test.crons.length === 0,
  'Test cron must be driven manually to avoid unexpected deletion jobs');
assert.ok(!test.redirects?.some(route => route.destination?.includes('thelogbook.web.app')),
  'Test backend must never redirect users to Production');
assert.ok(!test.rewrites?.some(route => route.source === '/sw.js'),
  'Test backend must not install the retired Production service worker');
assert.ok(test.functions?.['api/account-deletion.ts']);
assert.ok(test.functions?.['api/account-deletion-cron.ts']);
assert.equal(test.functions['api/account-deletion-cron.ts'].maxDuration, 300);
assert.ok(prod.git?.deploymentEnabled?.main === true, 'Production branch contract must remain in canonical config');
assert.ok(prod.redirects?.some(route => route.destination === 'https://thelogbook.web.app/'),
  'Production canonical root redirect must remain unchanged');

// Enforce the repository policy: the alternate file is used with
// vercel deploy --local-config vercel.test.json --project <exact-test-project>.
// It is NEVER a reason to alter the Production vercel.json.
console.log('Vercel Test uses a manual-only backend config isolated from Production.');
