import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { verifyExistingTestUpgradeSql, verifyInactivityMigrationSql, verifySchedulerMigrationSql, verifyLocalMigrationTarget, verifyMigrationLedger,
  verifyRemoteIsolatedD1, MIGRATIONS } from '../../scripts/verify-cloudflare-isolated-d1-schema.mjs';
import { D1_NOW_MS } from '../../cloudflare/sql/d1-time.mjs';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const ID = '9aa51833-8adc-495f-bdfc-93b5542e8023';
const config = JSON.parse(readFileSync(new URL('../../cloudflare/api/wrangler.isolated.jsonc', import.meta.url), 'utf8'));
const names = readdirSync(new URL('../../cloudflare/api/migrations/', import.meta.url))
  .filter(n => n.endsWith('.sql')).sort();
const ledger = (count = 8) => MIGRATIONS.slice(0, count).map((name, i) => ({ id: i + 1, name }));
const schema = [
  { name: 'auth_sessions_owner_token', type: 'index' },
  { name: 'cloud_key_first_issuance', type: 'trigger', sql: `accepted_at_ms <= ${D1_NOW_MS}` },
  { name: 'health_erasure_finalization_fence', type: 'trigger' },
  { name: 'health_erasure_finalizations', type: 'table' },
  { name: 'kinde_account_activity', type: 'table' },
  { name: 'kinde_account_activity_by_last_seen', type: 'index' },
  { name: 'kinde_account_activity_insert_fence', type: 'trigger' },
  { name: 'kinde_account_activity_update_fence', type: 'trigger' },
  { name: 'kinde_account_erasure_activity_terminal_fence', type: 'trigger' },
  { name: 'kinde_account_erasure_completion_fence', type: 'trigger' },
  { name: 'kinde_account_erasure_completions', type: 'table' },
  { name: 'kinde_account_erasure_freeze', type: 'trigger' },
  { name: 'kinde_account_erasure_intents', type: 'table' },
  { name: 'kinde_account_erasure_provider_progress', type: 'table' },
  { name: 'kinde_account_erasure_requests', type: 'table' },
  { name: 'kinde_account_erasure_scheduler', type: 'table' },
  { name: 'kinde_account_erasure_scheduler_no_delete', type: 'trigger' },
  { name: 'kinde_account_erasure_scheduler_no_replace', type: 'trigger' },
  { name: 'kinde_account_erasure_scheduler_transition', type: 'trigger' },
  { name: 'kinde_deletion_oauth_attempts', type: 'table' },
  { name: 'kinde_erasure_targets', type: 'table' },
  { name: 'kinde_inactivity_control', type: 'table' },
  { name: 'kinde_inactivity_control_generation', type: 'trigger' },
  { name: 'kinde_inactivity_control_no_delete', type: 'trigger' },
  { name: 'kinde_inactivity_control_no_replace', type: 'trigger' },
  { name: 'kinde_inactivity_intent_fence', type: 'trigger' },
  { name: 'kinde_inactivity_intent_freeze', type: 'trigger' },
  { name: 'sync_writable_cloud_key', type: 'view', sql: `accepted_at_ms <= ${D1_NOW_MS}` },
];

function response(result, status = 200) {
  return new Response(JSON.stringify({ success: status === 200, result }), { status });
}
function syntheticProvider({
  migrationCount = 8, principals = 0, sessions = 0, keys = 0, consents = 0, erasureJobs = 0,
  subjects = 0, states = 0, documents = 0, replicas = 0, receipts = 0, replicaMutations = 0,
  accountRequests = 0, activity = 0, inactivityControl = [{ singleton: 1, mode: 'paused', generation: 1 }],
  scheduler = [{ singleton: 1, cursor_uid: null, lease_epoch: 0, lease_token: null, lease_until_ms: 0 }],
  objects = schema, jurisdiction = 'eu', replication = 'disabled',
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
        : sql.includes('FROM kinde_inactivity_control') ? inactivityControl
        : sql.includes('FROM kinde_account_erasure_scheduler') ? scheduler
        : [{ principals, sessions, keys, consents, erasure_jobs: erasureJobs,
          subjects, states, documents, replicas, receipts, replica_mutations: replicaMutations,
          erasure_targets: 0, deletion_attempts: 0, account_intents: 0, account_requests: accountRequests,
          provider_progress: 0, account_completions: 0, activity }];
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
  assert.throws(() => verifyLocalMigrationTarget(config, [...names, '0015_unknown.sql']));
});

void test('the known contiguous migration prefixes may resume; completion requires 0014', () => {
  assert.equal(verifyMigrationLedger(ledger(8), 'before'), 8);
  assert.equal(verifyMigrationLedger(ledger(9), 'before'), 9);
  assert.equal(verifyMigrationLedger(ledger(10), 'before'), 10);
  assert.equal(verifyMigrationLedger(ledger(11), 'before'), 11);
  assert.equal(verifyMigrationLedger(ledger(12), 'before'), 12);
  assert.equal(verifyMigrationLedger(ledger(13), 'before'), 13);
  assert.equal(verifyMigrationLedger(ledger(14), 'after'), 14);
  for (const entries of [
    ledger(7), [...ledger(11), { id: 12, name: '0012_kinde_account_erasure.sql' }], [...ledger(8), { id: 10, name: MIGRATIONS[8] }],
    [...ledger(8), { id: 9, name: '0009_other.sql' }],
    [...ledger(10), { id: 11, name: '0011_unknown.sql' }],
    ledger(8).map((row, i) => i === 0 ? { ...row, id: 0 } : row),
  ]) assert.throws(() => verifyMigrationLedger(entries, 'before'));
  assert.throws(() => verifyMigrationLedger(ledger(13), 'after'));
});

void test('checks account, EU D1, Time Travel, ledger, empty principals and schema readback', async () => {
  const before = syntheticProvider();
  assert.deepEqual(await verifyRemoteIsolatedD1({
    phase: 'before', account: ACCOUNT, token: 'test', request: before.request,
  }), { phase: 'before', applied: 8, expected: 14, jurisdiction: 'eu',
    timeTravelBookmarkVerified: true });
  assertReadOnlyRequests(before.calls);

  const after = syntheticProvider({ migrationCount: 14 });
  assert.equal((await verifyRemoteIsolatedD1({
    phase: 'after', account: ACCOUNT, token: 'test', request: after.request,
  })).applied, 14);
  assert.ok(after.calls.some(c => c.sql?.includes('sqlite_master')));
  assertReadOnlyRequests(after.calls);
});

void test('fails closed on provider, migration and isolation drift without writes', async () => {
  for (const options of [
    { migrationCount: 7 }, { migrationCount: 10 }, { migrationCount: 12 }, { principals: 1 },
    { sessions: 1 }, { keys: 1 }, { erasureJobs: 1 }, { accountRequests: 1 }, { activity: 1 },
    { inactivityControl: [{ singleton: 1, mode: 'enabled', generation: 2 }] }, { jurisdiction: 'us' },
    { replication: 'auto' }, { objects: [] }, { failedStatus: 403 },
    { scheduler: [] }, { scheduler: [{ singleton: 1, cursor_uid: null, lease_epoch: 1, lease_token: 'a'.repeat(64), lease_until_ms: 0 }] },
    { objects: schema.filter(row => row.name !== 'kinde_account_erasure_completion_fence') },
    { objects: schema.map(row => row.name === 'cloud_key_first_issuance'
      ? { ...row, sql: 'accepted_at_ms <= julianday(\'now\')' } : row) },
  ]) {
    const provider = syntheticProvider({ migrationCount: 14, ...options });
    await assert.rejects(verifyRemoteIsolatedD1({
      phase: 'after', account: ACCOUNT, token: 'test', request: provider.request,
    }));
    assertReadOnlyRequests(provider.calls);
  }
});

void test('explicit 0014 test upgrade preserves identities across the 0012–0014 migrations', async () => {
  const existing = { principals: 3, sessions: 29, subjects: 1, states: 1, documents: 1, replicas: 1, receipts: 1 };
  const before = syntheticProvider({ migrationCount: 11, ...existing });
  const after = syntheticProvider({ migrationCount: 14, ...existing });
  const options = { account: ACCOUNT, token: 'test', existingTestDb0014: true };
  const preflight = await verifyRemoteIsolatedD1({ ...options, phase: 'before', request: before.request });
  assert.deepEqual(preflight.inventory, { ...existing, replica_mutations: 0 });
  const verified = await verifyRemoteIsolatedD1({
    ...options, phase: 'after', request: after.request, priorInventory: preflight.inventory,
  });
  assert.equal(verified.applied, 14);
  const alreadyApplied = await verifyRemoteIsolatedD1({ ...options, phase: 'before', request: after.request });
  assert.deepEqual(alreadyApplied.inventory, preflight.inventory);
  assert.ok(after.calls.some(c => c.sql?.includes('sqlite_master')));
  assertReadOnlyRequests([...before.calls, ...after.calls]);
});

void test('0014 test upgrade rejects altered SQL, mismatched ledger, health data and changed identity counts', async () => {
  const sql = readFileSync(new URL('../../cloudflare/api/migrations/0012_kinde_erasure_decisions.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => verifyExistingTestUpgradeSql(sql));
  assert.throws(() => verifyExistingTestUpgradeSql(sql + '\nDELETE FROM auth_sessions;'), /unreviewed SQL/);
  const activitySql = readFileSync(new URL('../../cloudflare/api/migrations/0013_kinde_activity_and_inactivity.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => verifyInactivityMigrationSql(activitySql));
  assert.throws(() => verifyInactivityMigrationSql(activitySql + '\nDELETE FROM auth_sessions;'), /unreviewed inactivity SQL/);
  const schedulerSql = readFileSync(new URL('../../cloudflare/api/migrations/0014_kinde_account_erasure_scheduler.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => verifySchedulerMigrationSql(schedulerSql));
  assert.throws(() => verifySchedulerMigrationSql(schedulerSql + '\nDELETE FROM auth_sessions;'), /unreviewed scheduler SQL/);
  const options = { account: ACCOUNT, token: 'test', existingTestDb0014: true };
  for (const override of [
    { migrationCount: 9 }, { migrationCount: 10 }, { keys: 1 }, { consents: 1 },
    { migrationCount: 12, accountRequests: 1 },
    { erasureJobs: 1 }, { sessions: null }, { replicas: -1 },
  ]) {
    const before = syntheticProvider({ migrationCount: 11, principals: 3, sessions: 29, ...override });
    await assert.rejects(verifyRemoteIsolatedD1({ ...options, phase: 'before', request: before.request }));
    assertReadOnlyRequests(before.calls);
  }
  const existing = { principals: 3, sessions: 29, subjects: 1, states: 1, documents: 1, replicas: 1, receipts: 1 };
  const inventory = { ...existing, replica_mutations: 0 };
  for (const [override, priorInventory] of [[{}, undefined], [{ sessions: 30 }, inventory], [{ documents: 0 }, inventory]]) {
    const after = syntheticProvider({ migrationCount: 14, ...existing, ...override });
    await assert.rejects(verifyRemoteIsolatedD1({ ...options, phase: 'after', request: after.request, priorInventory }),
      /existing test inventory changed/);
    assertReadOnlyRequests(after.calls);
  }
});

void test('manual workflow is main-only, version pinned and does not deploy Worker or DNS', () => {
  const yml = readFileSync(new URL('../../.github/workflows/cloudflare-d1-isolated-migrations.yml', import.meta.url), 'utf8');
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /upgrade_existing_test_db_0014:[\s\S]+type: boolean\s+default: false/);
  assert.match(yml, /github\.ref == 'refs\/heads\/main'/);
  assert.match(yml, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.match(yml, /wrangler@4\.159\.0 d1 migrations apply/);
  assert.match(yml, /--remote --config cloudflare\/api\/wrangler\.isolated\.jsonc/);
  assert.match(yml, /scripts\/verify-cloudflare-isolated-d1-schema\.mjs before/);
  assert.match(yml, /scripts\/verify-cloudflare-isolated-d1-schema\.mjs after/);
  assert.doesNotMatch(yml, /wrangler[^\n]* deploy|firebase deploy/);
});
