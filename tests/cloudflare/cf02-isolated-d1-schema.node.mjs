import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { verifyExistingTestUpgradeSql, verifyInactivityMigrationSql, verifySchedulerMigrationSql, verifyDispatchMigrationSql, verifyScanMigrationSql, verifyEnqueueMigrationSql, verifyCapacityMigrationSql, verifyRetirementMigrationSql, verifyRetryMigrationSql, verifyLocalMigrationTarget, verifyMigrationLedger,
  verifyRemoteIsolatedD1, MIGRATIONS } from '../../scripts/verify-cloudflare-isolated-d1-schema.mjs';
import { D1_NOW_MS } from '../../cloudflare/sql/d1-time.mjs';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const ID = '9aa51833-8adc-495f-bdfc-93b5542e8023';
const config = JSON.parse(readFileSync(new URL('../../cloudflare/api/wrangler.isolated.jsonc', import.meta.url), 'utf8'));
const names = readdirSync(new URL('../../cloudflare/api/migrations/', import.meta.url))
  .filter(n => n.endsWith('.sql')).sort();
const ledger = (count = 8) => MIGRATIONS.slice(0, count).map((name, i) => ({ id: i + 1, name }));
const retrySql = readFileSync(new URL('../../cloudflare/api/migrations/0020_account_erasure_retry_backoff.sql', import.meta.url), 'utf8');
function retryDefinition(name) {
  const start = retrySql.search(new RegExp('CREATE (?:TABLE|TRIGGER) ' + name + '\\b'));
  assert.ok(start >= 0);
  const end = retrySql.indexOf('\n\n', start);
  return retrySql.slice(start, end < 0 ? undefined : end).trim().replace(/;$/, '');
}
const snapshotTables = {
  auth_principals: 'principals', auth_sessions: 'sessions', sync_subjects: 'subjects',
  sync_state: 'states', sync_documents: 'documents', sync_replicas: 'replicas',
  sync_receipts: 'receipts', sync_replica_mutations: 'replica_mutations',
};
function syntheticSnapshotRow(key, i) {
  const uid = 'synthetic-owner-' + i;
  if (key === 'principals') return { uid, status: 'active', verified_at_ms: null, auth_epoch: 1 };
  if (key === 'sessions') return {
    token_hash: i.toString(16).padStart(64, '0'), uid: 'synthetic-owner-0', auth_epoch: 1,
    csrf_hash: (i + 100).toString(16).padStart(64, '0'), issued_at_ms: 1000,
    idle_expires_at_ms: 2000, absolute_expires_at_ms: 3000, revoked_at_ms: null,
  };
  if (key === 'subjects') return { uid, status: 'active', consent_revision: 1, fence_epoch: 1 };
  if (key === 'states') return { uid, revision: 1 };
  if (key === 'documents') return { uid, path: '', envelope_json: '{"ciphertext":"synthetic"}', revision: 1 };
  if (key === 'replicas') return { uid, slot: 's00', replica_id: 'synthetic-replica', generation: 1,
    lease_until_ms: 9999999999999, checkpoint_at_ms: 1000, checkpoint_clock_json: '{}',
    last_seq: 0, status: 'active' };
  if (key === 'receipts') return { uid, batch_id: 'synthetic-batch-id', request_hash: 'a'.repeat(64),
    expected_revision: 0, committed_revision: 1, consent_revision: 1, fence_epoch: 1,
    slot: 's00', replica_id: 'synthetic-replica', generation: 1, last_seq: 1, document_count: 1 };
  return { uid, mutation_id: 'synthetic-mutation', request_hash: 'a'.repeat(64),
    action: 'register', expected_revision: 0, committed_revision: 1,
    consent_revision: 1, fence_epoch: 1, slot: 's00', replica_id: 'synthetic-replica',
    generation: 1, last_seq: 0, checkpoint_at_ms: 1000, lease_until_ms: 9999999999999,
    checkpoint_clock_json: '{}' };
}
const schema = [
  { name: 'auth_sessions_owner_token', type: 'index' },
  { name: 'cloud_key_first_issuance', type: 'trigger', sql: `accepted_at_ms <= ${D1_NOW_MS}` },
  { name: 'erasure_dispatch_control', type: 'table' },
  { name: 'erasure_dispatch_control_no_delete', type: 'trigger' },
  { name: 'erasure_dispatch_control_no_replace', type: 'trigger' },
  { name: 'erasure_dispatch_control_transition', type: 'trigger' },
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
  { name: 'kinde_account_erasure_retries', type: 'table', sql: retryDefinition('kinde_account_erasure_retries') },
  { name: 'kinde_account_erasure_retry_no_terminal', type: 'trigger', sql: retryDefinition('kinde_account_erasure_retry_no_terminal') },
  { name: 'kinde_account_erasure_retry_terminal_cleanup', type: 'trigger', sql: retryDefinition('kinde_account_erasure_retry_terminal_cleanup') },
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
  { name: 'kinde_inactivity_enqueue_checkpoint', type: 'table' },
  { name: 'kinde_inactivity_enqueue_checkpoint_no_delete', type: 'trigger' },
  { name: 'kinde_inactivity_enqueue_checkpoint_no_replace', type: 'trigger' },
  { name: 'kinde_inactivity_enqueue_checkpoint_transition', type: 'trigger' },
  { name: 'kinde_inactivity_intent_fence', type: 'trigger' },
  { name: 'kinde_inactivity_intent_freeze', type: 'trigger' },
  { name: 'kinde_inactivity_scan_checkpoint', type: 'table' },
  { name: 'kinde_inactivity_scan_checkpoint_no_delete', type: 'trigger' },
  { name: 'kinde_inactivity_scan_checkpoint_no_replace', type: 'trigger' },
  { name: 'kinde_inactivity_scan_checkpoint_transition', type: 'trigger' },
  { name: 'sync_replica_active_capacity_insert', type: 'trigger' },
  { name: 'sync_replica_active_capacity_update', type: 'trigger' },
  { name: 'sync_replica_mutation_fence', type: 'trigger', sql: readFileSync(new URL('../../cloudflare/api/migrations/0019_explicit_replica_retirement.sql', import.meta.url), 'utf8').split('DROP TRIGGER sync_replica_mutation_fence;\n')[1].trim().replace(/;$/, '') },
  { name: 'sync_writable_cloud_key', type: 'view', sql: `accepted_at_ms <= ${D1_NOW_MS}` },
];

function response(result, status = 200) {
  return new Response(JSON.stringify({ success: status === 200, result }), { status });
}
function syntheticProvider({
  migrationCount = 8, principals = 0, sessions = 0, keys = 0, consents = 0, erasureJobs = 0,
  subjects = 0, states = 0, documents = 0, replicas = 0, receipts = 0, replicaMutations = 0,
  accountRequests = 0, activity = 0, retries = 0, inactivityControl = [{ singleton: 1, mode: 'paused', generation: 1 }],
  scheduler = [{ singleton: 1, cursor_uid: null, lease_epoch: 0, lease_token: null, lease_until_ms: 0 }],
  dispatch = [{ singleton: 1, turn: 0 }],
  scan = [{ singleton: 1, policy_generation: 0, recovery_generation: 0,
    cursor_last_recorded_at_ms: null, cursor_uid: null, lease_epoch: 0, lease_token: null, lease_until_ms: 0 }],
  enqueue = [{ singleton: 1, policy_generation: 0, recovery_generation: 0,
    cursor_last_recorded_at_ms: null, cursor_uid: null, lease_epoch: 0, lease_token: null, lease_until_ms: 0 }],
  overCapacity = 0,
  modeColumn = [{ name: 'retirement_mode', type: 'TEXT', required: 1, dflt_value: "'expired'" }],
  objects = schema, jurisdiction = 'eu', replication = 'disabled',
  failedStatus = null, snapshotOverrides = {},
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
      const table = sql.match(/^SELECT (?:\*|uid, mutation_id, .+) FROM ([a-z_]+) LIMIT 65$/)?.[1];
      const snapshotKey = snapshotTables[table];
      const counts = { principals, sessions, subjects, states, documents, replicas,
        receipts, replica_mutations: replicaMutations };
      const rows = sql.includes('FROM d1_migrations') ? ledger(migrationCount)
        : snapshotKey ? (snapshotOverrides[snapshotKey] ?? Array.from(
          { length: counts[snapshotKey] }, (_, i) => syntheticSnapshotRow(snapshotKey, i)))
        : sql.includes('FROM sqlite_master') ? objects
        : sql.includes('FROM kinde_inactivity_control') ? inactivityControl
        : sql.includes('FROM kinde_account_erasure_scheduler') ? scheduler
        : sql.includes('FROM erasure_dispatch_control') ? dispatch
        : sql.includes('FROM kinde_inactivity_scan_checkpoint') ? scan
        : sql.includes('FROM kinde_inactivity_enqueue_checkpoint') ? enqueue
        : sql.includes('AS over_capacity') ? [{ over_capacity: overCapacity }]
        : sql.includes('FROM pragma_table_info') ? modeColumn
        : [{ principals, sessions, keys, consents, erasure_jobs: erasureJobs,
          subjects, states, documents, replicas, receipts, replica_mutations: replicaMutations,
          erasure_targets: 0, deletion_attempts: 0, account_intents: 0, account_requests: accountRequests,
          provider_progress: 0, account_completions: 0, activity, retries }];
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
  assert.throws(() => verifyLocalMigrationTarget(config, [...names, '0016_unknown.sql']));
});

void test('the known contiguous migration prefixes may resume; completion requires 0020', () => {
  assert.equal(verifyMigrationLedger(ledger(8), 'before'), 8);
  assert.equal(verifyMigrationLedger(ledger(9), 'before'), 9);
  assert.equal(verifyMigrationLedger(ledger(10), 'before'), 10);
  assert.equal(verifyMigrationLedger(ledger(11), 'before'), 11);
  assert.equal(verifyMigrationLedger(ledger(12), 'before'), 12);
  assert.equal(verifyMigrationLedger(ledger(13), 'before'), 13);
  assert.equal(verifyMigrationLedger(ledger(14), 'before'), 14);
  assert.equal(verifyMigrationLedger(ledger(15), 'before'), 15);
  assert.equal(verifyMigrationLedger(ledger(16), 'before'), 16);
  assert.equal(verifyMigrationLedger(ledger(17), 'before'), 17);
  assert.equal(verifyMigrationLedger(ledger(18), 'before'), 18);
  assert.equal(verifyMigrationLedger(ledger(19), 'before'), 19);
  assert.equal(verifyMigrationLedger(ledger(20), 'after'), 20);
  for (const entries of [
    ledger(7), [...ledger(11), { id: 12, name: '0012_kinde_account_erasure.sql' }], [...ledger(8), { id: 10, name: MIGRATIONS[8] }],
    [...ledger(8), { id: 9, name: '0009_other.sql' }],
    [...ledger(10), { id: 11, name: '0011_unknown.sql' }],
    ledger(8).map((row, i) => i === 0 ? { ...row, id: 0 } : row),
  ]) assert.throws(() => verifyMigrationLedger(entries, 'before'));
  assert.throws(() => verifyMigrationLedger(ledger(18), 'after'));
  assert.throws(() => verifyMigrationLedger(ledger(19), 'after'));
});

void test('checks account, EU D1, Time Travel, ledger, empty principals and schema readback', async () => {
  const before = syntheticProvider();
  assert.deepEqual(await verifyRemoteIsolatedD1({
    phase: 'before', account: ACCOUNT, token: 'test', request: before.request,
  }), { phase: 'before', applied: 8, expected: 20, jurisdiction: 'eu',
    timeTravelBookmarkVerified: true });
  assertReadOnlyRequests(before.calls);

  const after = syntheticProvider({ migrationCount: 20 });
  assert.equal((await verifyRemoteIsolatedD1({
    phase: 'after', account: ACCOUNT, token: 'test', request: after.request,
  })).applied, 20);
  assert.ok(after.calls.some(c => c.sql?.includes('sqlite_master')));
  assertReadOnlyRequests(after.calls);
});

void test('fails closed on provider, migration and isolation drift without writes', async () => {
  for (const options of [
    { migrationCount: 7 }, { migrationCount: 10 }, { migrationCount: 12 }, { principals: 1 },
    { sessions: 1 }, { keys: 1 }, { erasureJobs: 1 }, { accountRequests: 1 }, { activity: 1 }, { retries: 1 },
    { inactivityControl: [{ singleton: 1, mode: 'enabled', generation: 2 }] }, { jurisdiction: 'us' },
    { replication: 'auto' }, { objects: [] }, { failedStatus: 403 },
    { scheduler: [] }, { scheduler: [{ singleton: 1, cursor_uid: null, lease_epoch: 1, lease_token: 'a'.repeat(64), lease_until_ms: 0 }] },
    { dispatch: [] }, { dispatch: [{ singleton: 1, turn: 2 }] },
    { scan: [] }, { scan: [{ singleton: 1, policy_generation: 2, recovery_generation: 2, cursor_last_recorded_at_ms: null, cursor_uid: null, lease_epoch: 1, lease_token: 'a'.repeat(64), lease_until_ms: 0 }] },
    { enqueue: [] }, { enqueue: [{ singleton: 1, policy_generation: 2, recovery_generation: 2, cursor_last_recorded_at_ms: null, cursor_uid: null, lease_epoch: 1, lease_token: 'a'.repeat(64), lease_until_ms: 0 }] },
    { overCapacity: 1 }, { modeColumn: [] },
    { objects: schema.map(row => row.name === 'sync_replica_mutation_fence' ? { ...row, sql: 'incorrect' } : row) },
    { objects: schema.filter(row => row.name !== 'sync_replica_active_capacity_update') },
    { objects: schema.filter(row => row.name !== 'kinde_inactivity_enqueue_checkpoint_transition') },
    { objects: schema.filter(row => row.name !== 'kinde_inactivity_scan_checkpoint_transition') },
    { objects: schema.filter(row => row.name !== 'erasure_dispatch_control_transition') },
    { objects: schema.filter(row => row.name !== 'kinde_account_erasure_completion_fence') },
    { objects: schema.filter(row => row.name !== 'kinde_account_erasure_retry_terminal_cleanup') },
    { objects: schema.map(row => row.name === 'kinde_account_erasure_retry_no_terminal'
      ? { ...row, sql: 'incorrect' } : row) },
    { objects: schema.map(row => row.name === 'cloud_key_first_issuance'
      ? { ...row, sql: 'accepted_at_ms <= julianday(\'now\')' } : row) },
  ]) {
    const provider = syntheticProvider({ migrationCount: 20, ...options });
    await assert.rejects(verifyRemoteIsolatedD1({
      phase: 'after', account: ACCOUNT, token: 'test', request: provider.request,
    }));
    assertReadOnlyRequests(provider.calls);
  }
});

void test('explicit 0020 test upgrade preserves identities across the 0012–0020 migrations', async () => {
  const existing = { principals: 3, sessions: 29, subjects: 1, states: 1, documents: 1, replicas: 1, receipts: 1 };
  const before = syntheticProvider({ migrationCount: 11, ...existing });
  const after = syntheticProvider({ migrationCount: 20, ...existing });
  const options = { account: ACCOUNT, token: 'test', existingTestDb0020: true };
  const preflight = await verifyRemoteIsolatedD1({ ...options, phase: 'before', request: before.request });
  assert.deepEqual(preflight.inventory.counts, { ...existing, replica_mutations: 0 });
  assert.equal(preflight.inventory.format, 'isolated-d1-snapshot-v1');
  assert.equal(Object.keys(preflight.inventory.digests).length, 8);
  assert.ok(Object.values(preflight.inventory.digests).every(value => /^[a-f0-9]{64}$/.test(value)));
  const verified = await verifyRemoteIsolatedD1({
    ...options, phase: 'after', request: after.request, priorInventory: preflight.inventory,
  });
  assert.equal(verified.applied, 20);
  const alreadyApplied = await verifyRemoteIsolatedD1({ ...options, phase: 'before', request: after.request });
  assert.deepEqual(alreadyApplied.inventory, preflight.inventory);
  assert.ok(after.calls.some(c => c.sql?.includes('sqlite_master')));
  assertReadOnlyRequests([...before.calls, ...after.calls]);
});

void test('upgrade preflight rejects a previously enabled, advanced or missing inactivity control', async () => {
  for (const migrationCount of [13, 14, 15, 16, 17, 18, 19, 20]) {
    for (const inactivityControl of [[], [{ singleton: 1, mode: 'enabled', generation: 2 }],
      [{ singleton: 1, mode: 'paused', generation: 3 }]]) {
      const provider = syntheticProvider({ migrationCount, principals: 3, sessions: 29, inactivityControl });
      await assert.rejects(verifyRemoteIsolatedD1({ phase: 'before', account: ACCOUNT, token: 'test',
        existingTestDb0020: true, request: provider.request }), /new inactivity scanner must remain paused/);
      assertReadOnlyRequests(provider.calls);
    }
    const provider = syntheticProvider({ migrationCount, principals: 3, sessions: 29 });
    assert.equal((await verifyRemoteIsolatedD1({ phase: 'before', account: ACCOUNT, token: 'test',
      existingTestDb0020: true, request: provider.request })).applied, migrationCount);
    assertReadOnlyRequests(provider.calls);
  }
});

void test('0020 test upgrade rejects altered SQL, mismatched ledger, health data and changed identity counts', async () => {
  const sql = readFileSync(new URL('../../cloudflare/api/migrations/0012_kinde_erasure_decisions.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => verifyExistingTestUpgradeSql(sql));
  assert.throws(() => verifyExistingTestUpgradeSql(sql + '\nDELETE FROM auth_sessions;'), /unreviewed SQL/);
  const activitySql = readFileSync(new URL('../../cloudflare/api/migrations/0013_kinde_activity_and_inactivity.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => verifyInactivityMigrationSql(activitySql));
  assert.throws(() => verifyInactivityMigrationSql(activitySql + '\nDELETE FROM auth_sessions;'), /unreviewed inactivity SQL/);
  const schedulerSql = readFileSync(new URL('../../cloudflare/api/migrations/0014_kinde_account_erasure_scheduler.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => verifySchedulerMigrationSql(schedulerSql));
  assert.throws(() => verifySchedulerMigrationSql(schedulerSql + '\nDELETE FROM auth_sessions;'), /unreviewed scheduler SQL/);
  const dispatchSql = readFileSync(new URL('../../cloudflare/api/migrations/0015_erasure_dispatch_control.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => verifyDispatchMigrationSql(dispatchSql));
  assert.throws(() => verifyDispatchMigrationSql(dispatchSql + '\nDELETE FROM auth_sessions;'), /unreviewed dispatch SQL/);
  const scanSql = readFileSync(new URL('../../cloudflare/api/migrations/0016_kinde_inactivity_scan_checkpoint.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => verifyScanMigrationSql(scanSql));
  assert.throws(() => verifyScanMigrationSql(scanSql + '\nDELETE FROM auth_sessions;'), /unreviewed inactivity scan SQL/);
  const enqueueSql = readFileSync(new URL('../../cloudflare/api/migrations/0017_kinde_inactivity_enqueue_checkpoint.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => verifyEnqueueMigrationSql(enqueueSql));
  assert.throws(() => verifyEnqueueMigrationSql(enqueueSql + '\nDELETE FROM auth_sessions;'), /unreviewed inactivity enqueue SQL/);
  const capacitySql = readFileSync(new URL('../../cloudflare/api/migrations/0018_active_replica_capacity.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => verifyCapacityMigrationSql(capacitySql));
  assert.throws(() => verifyCapacityMigrationSql(capacitySql + '\nDELETE FROM auth_sessions;'), /unreviewed replica capacity SQL/);
  const retirementSql = readFileSync(new URL('../../cloudflare/api/migrations/0019_explicit_replica_retirement.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => verifyRetirementMigrationSql(retirementSql));
  assert.throws(() => verifyRetirementMigrationSql(retirementSql + '\nDELETE FROM auth_sessions;'), /unreviewed explicit replica retirement SQL/);
  assert.doesNotThrow(() => verifyRetryMigrationSql(retrySql));
  assert.throws(() => verifyRetryMigrationSql(retrySql + '\nDELETE FROM auth_sessions;'), /unreviewed account retry SQL/);
  const options = { account: ACCOUNT, token: 'test', existingTestDb0020: true };
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
  const before = syntheticProvider({ migrationCount: 11, ...existing });
  const inventory = (await verifyRemoteIsolatedD1({ ...options, phase: 'before', request: before.request })).inventory;
  for (const [override, priorInventory] of [[{}, undefined], [{ sessions: 30 }, inventory], [{ documents: 0 }, inventory]]) {
    const after = syntheticProvider({ migrationCount: 20, ...existing, ...override });
    await assert.rejects(verifyRemoteIsolatedD1({ ...options, phase: 'after', request: after.request, priorInventory }),
      /existing test inventory changed/);
    assertReadOnlyRequests(after.calls);
  }
});

void test('0020 upgrade detects unchanged counts with altered sessions or encrypted document bytes', async () => {
  const existing = { principals: 3, sessions: 29, subjects: 1, states: 1,
    documents: 1, replicas: 1, receipts: 1 };
  const options = { account: ACCOUNT, token: 'test', existingTestDb0020: true };
  const before = syntheticProvider({ migrationCount: 11, ...existing });
  const inventory = (await verifyRemoteIsolatedD1({ ...options, phase: 'before', request: before.request })).inventory;
  for (const snapshotOverrides of [
    { sessions: Array.from({ length: 29 }, (_, i) => ({ ...syntheticSnapshotRow('sessions', i),
      ...(i === 7 ? { revoked_at_ms: 2000 } : {}) })) },
    { documents: [{ ...syntheticSnapshotRow('documents', 0), envelope_json: '{"ciphertext":"changed"}' }] },
  ]) {
    const after = syntheticProvider({ migrationCount: 20, ...existing, snapshotOverrides });
    await assert.rejects(verifyRemoteIsolatedD1({ ...options, phase: 'after', request: after.request,
      priorInventory: inventory }), /existing test inventory changed/);
    assertReadOnlyRequests(after.calls);
  }
});

void test('snapshot digest is order-independent and omits only the reviewed 0019 column extension', async () => {
  const existing = { principals: 3, sessions: 29, subjects: 1, states: 1,
    documents: 1, replicas: 1, receipts: 1, replicaMutations: 1 };
  const options = { account: ACCOUNT, token: 'test', existingTestDb0020: true };
  const before = syntheticProvider({ migrationCount: 11, ...existing });
  const inventory = (await verifyRemoteIsolatedD1({ ...options, phase: 'before', request: before.request })).inventory;
  const after = syntheticProvider({ migrationCount: 20, ...existing, snapshotOverrides: {
    sessions: Array.from({ length: 29 }, (_, i) => syntheticSnapshotRow('sessions', i)).reverse(),
  } });
  const verified = await verifyRemoteIsolatedD1({ ...options, phase: 'after',
    request: after.request, priorInventory: inventory });
  assert.deepEqual(verified.inventory, inventory);
  const mutationQuery = after.calls.find(call => call.sql?.includes('FROM sync_replica_mutations LIMIT 65'));
  assert.ok(mutationQuery, 'existing mutation rows must be fingerprinted');
  assert.doesNotMatch(mutationQuery.sql, /retirement_mode/);
  assert.match(mutationQuery.sql, /checkpoint_clock_json/);
  assertReadOnlyRequests([...before.calls, ...after.calls]);
});

void test('0020 upgrade rejects partial, oversized and malformed row snapshots without writes', async () => {
  const existing = { principals: 3, sessions: 29, subjects: 1, states: 1,
    documents: 1, replicas: 1, receipts: 1 };
  const options = { account: ACCOUNT, token: 'test', existingTestDb0020: true, phase: 'before' };
  for (const override of [
    { snapshotOverrides: { principals: [syntheticSnapshotRow('principals', 0)] } },
    { sessions: 65 },
    { snapshotOverrides: { documents: [{ ...syntheticSnapshotRow('documents', 0),
      envelope_json: 'a'.repeat(4 * 1024 * 1024) }] } },
    { snapshotOverrides: { documents: [null] } },
    { snapshotOverrides: { documents: [{ ...syntheticSnapshotRow('documents', 0), revision: 1.5 }] } },
  ]) {
    const provider = syntheticProvider({ migrationCount: 11, ...existing, ...override });
    await assert.rejects(verifyRemoteIsolatedD1({ ...options, request: provider.request }));
    assertReadOnlyRequests(provider.calls);
  }
});

void test('manual workflow is main-only, version pinned and does not deploy Worker or DNS', () => {
  const yml = readFileSync(new URL('../../.github/workflows/cloudflare-d1-isolated-migrations.yml', import.meta.url), 'utf8');
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /upgrade_existing_test_db_0020:[\s\S]+type: boolean\s+default: false/);
  assert.match(yml, /github\.ref == 'refs\/heads\/main'/);
  assert.match(yml, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.match(yml, /wrangler@4\.159\.0 d1 migrations apply/);
  assert.match(yml, /--remote --config cloudflare\/api\/wrangler\.isolated\.jsonc/);
  assert.match(yml, /scripts\/verify-cloudflare-isolated-d1-schema\.mjs before/);
  assert.match(yml, /scripts\/verify-cloudflare-isolated-d1-schema\.mjs after/);
  assert.doesNotMatch(yml, /wrangler[^\n]* deploy|firebase deploy/);
});
