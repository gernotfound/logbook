import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { verifyLocalMigrationTarget, verifyMigrationLedger,
  verifyRemoteIsolatedD1, MIGRATIONS } from '../../scripts/verify-cloudflare-isolated-d1-schema.mjs';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const ID = '9aa51833-8adc-495f-bdfc-93b5542e8023';
const config = JSON.parse(readFileSync(new URL('../../cloudflare/api/wrangler.isolated.jsonc', import.meta.url), 'utf8'));
const names = readdirSync(new URL('../../cloudflare/api/migrations/', import.meta.url))
  .filter(n => n.endsWith('.sql')).sort();
const ledger = (count = 8) => MIGRATIONS.slice(0, count).map((name, i) => ({ id: i + 1, name }));
const schema = [
  { name: 'health_erasure_finalization_fence', type: 'trigger' },
  { name: 'health_erasure_finalizations', type: 'table' },
  { name: 'sync_writable_cloud_key', type: 'view' },
];

function response(result, status = 200) {
  return new Response(JSON.stringify({ success: status === 200, result }), { status });
}
function syntheticProvider({
  migrationCount = 8, principals = 0, sessions = 0, keys = 0,
  erasureJobs = 0, objects = schema, jurisdiction = 'eu', replication = 'disabled',
  failedStatus = null,
} = {}) {
  const calls = [];
  const request = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, method: options.method,
      sql: options.body ? JSON.parse(options.body).sql : null });
    if (failedStatus !== null) return response(null, failedStatus);
    if (parsed.pathname.endsWith('/time_travel/bookmark')) {
      return response({ bookmark: 'synthetic-checkpoint' });
    }
    if (parsed.pathname.endsWith('/query')) {
      const sql = JSON.parse(options.body).sql;
      const rows = sql.includes('FROM d1_migrations') ? ledger(migrationCount)
        : sql.includes('FROM sqlite_master') ? objects
        : [{ principals, sessions, keys, erasure_jobs: erasureJobs }];
      return response([{ success: true, results: rows }]);
    }
    return response({ uuid: ID, name: 'thelogbook-cf02-eu-isolated-20261113',
      jurisdiction, read_replication: { mode: replication } });
  };
  return { request, calls };
}

function assertReadOnlyRequests(calls) {
  const root = '/client/v4/accounts/' + ACCOUNT + '/d1/database/' + ID;
  assert.ok(calls.length > 0, 'the provider must have been queried');
  for (const { path, method, sql } of calls) {
    if (method === 'GET') {
      assert.ok(path === root || path === root + '/time_travel/bookmark',
        'unexpected metadata endpoint: ' + path);
      assert.equal(sql, null, 'metadata read must have no SQL body');
    } else {
      assert.equal(method, 'POST', 'only read-only SQL queries may be submitted');
      assert.equal(path, root + '/query', 'unexpected provider POST endpoint');
      assert.equal(typeof sql, 'string', 'missing SQL query');
      assert.match(sql, /^\s*SELECT\b/i, 'provider query must be read-only');
      assert.doesNotMatch(sql, /;|--|\/\*/, 'reject additional SQL statements or comments');
    }
  }
}

void test('read-only request oracle rejects destructive SQL and unexpected endpoints', () => {
  const root = '/client/v4/accounts/' + ACCOUNT + '/d1/database/' + ID;
  assert.throws(() => assertReadOnlyRequests([]), /must have been queried/);
  assert.throws(() => assertReadOnlyRequests([
    { path: root + '/query', method: 'POST', sql: 'DELETE FROM auth_sessions' },
  ]), /read-only/);
  assert.throws(() => assertReadOnlyRequests([
    { path: root + '/query', method: 'POST', sql: 'SELECT 1; DELETE FROM auth_sessions' },
  ]), /additional SQL statements/);
  assert.throws(() => assertReadOnlyRequests([
    { path: root, method: 'POST', sql: 'SELECT 1' },
  ]), /unexpected provider POST endpoint/);
});

void test('only approved isolated D1 with exactly reviewed SQL files is eligible', () => {
  assert.doesNotThrow(() => verifyLocalMigrationTarget(config, names));
  assert.throws(() => verifyLocalMigrationTarget({ ...config, routes: ['thelogbook.me'] }, names));
  assert.throws(() => verifyLocalMigrationTarget({ ...config, d1_databases: [
    { ...config.d1_databases[0], database_id: 'unexpected' },
  ] }, names));
  assert.throws(() => verifyLocalMigrationTarget(config, [...names, '0011_unknown.sql']));
});

void test('prefix ledger: 0008 initial, 0009 interrupted, 0010 complete, no gaps or drift', () => {
  assert.equal(verifyMigrationLedger(ledger(8), 'before'), 8);
  assert.equal(verifyMigrationLedger(ledger(9), 'before'), 9);
  assert.equal(verifyMigrationLedger(ledger(10), 'before'), 10);
  assert.equal(verifyMigrationLedger(ledger(10), 'after'), 10);
  for (const entries of [
    ledger(7), [...ledger(8), { id: 10, name: MIGRATIONS[8] }],
    [...ledger(8), { id: 9, name: '0009_other.sql' }],
    [...ledger(10), { id: 11, name: '0011_unknown.sql' }],
    ledger(8).map((row, i) => i === 0 ? { ...row, id: 0 } : row),
  ]) assert.throws(() => verifyMigrationLedger(entries, 'before'));
  assert.throws(() => verifyMigrationLedger(ledger(9), 'after'));
});

void test('checks account, EU D1, Time Travel, ledger, empty principals and schema readback', async () => {
  const before = syntheticProvider();
  assert.deepEqual(await verifyRemoteIsolatedD1({
    phase: 'before', account: ACCOUNT, token: 'test', request: before.request,
  }), { phase: 'before', applied: 8, expected: 10, jurisdiction: 'eu',
    timeTravelBookmarkVerified: true });
  assertReadOnlyRequests(before.calls);

  const after = syntheticProvider({ migrationCount: 10 });
  assert.equal((await verifyRemoteIsolatedD1({
    phase: 'after', account: ACCOUNT, token: 'test', request: after.request,
  })).applied, 10);
  assert.ok(after.calls.some(c => c.sql?.includes('sqlite_master')));
  assertReadOnlyRequests(after.calls);
});

void test('fails closed on provider, migration and isolation drift without writes', async () => {
  for (const options of [
    { migrationCount: 7 }, { migrationCount: 9 }, { principals: 1 },
    { sessions: 1 }, { keys: 1 }, { erasureJobs: 1 },
    { jurisdiction: 'us' }, { replication: 'auto' },
    { objects: [] }, { failedStatus: 403 },
  ]) {
    const provider = syntheticProvider(options);
    await assert.rejects(verifyRemoteIsolatedD1({
      phase: 'after', account: ACCOUNT, token: 'test', request: provider.request,
    }));
    assertReadOnlyRequests(provider.calls);
  }
});

void test('manual workflow is main-only, version pinned and does not deploy Worker or DNS', () => {
  const yml = readFileSync(new URL('../../.github/workflows/cloudflare-d1-isolated-migrations.yml', import.meta.url), 'utf8');
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /github\.ref == 'refs\/heads\/main'/);
  assert.match(yml, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.match(yml, /wrangler@4\.159\.0 d1 migrations apply/);
  assert.match(yml, /--remote --config cloudflare\/api\/wrangler\.isolated\.jsonc/);
  assert.match(yml, /scripts\/verify-cloudflare-isolated-d1-schema\.mjs before/);
  assert.match(yml, /scripts\/verify-cloudflare-isolated-d1-schema\.mjs after/);
  assert.doesNotMatch(yml, /wrangler[^\n]* deploy|firebase deploy/);
});
