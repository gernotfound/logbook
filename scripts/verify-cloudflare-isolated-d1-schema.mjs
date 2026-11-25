import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { D1_NOW_MS } from '../cloudflare/sql/d1-time.mjs';

// Explicitly reviewed migration set: new SQL requires another review before
// this on-demand operational workflow can apply it to the isolated D1.
export const MIGRATIONS = Object.freeze(`
0001_encrypted_replica.sql
0002_reject_reused_replica_ids.sql
0003_auth_session_gate.sql
0004_initial_consent.sql
0005_health_withdrawal_queue.sql
0006_health_erasure_progress.sql
0007_cloud_key_custody.sql
0008_kinde_oauth_attempts.sql
0009_require_cloud_key_for_replica_writes.sql
0010_atomic_health_erasure_finalization.sql
0011_integer_cloud_key_clock.sql
0012_kinde_erasure_decisions.sql
0013_kinde_activity_and_inactivity.sql
0014_kinde_account_erasure_scheduler.sql
`.trim().split('\n'));
const DATABASE = 'thelogbook-cf02-eu-isolated-20261113';
const DATABASE_ID = '9aa51833-8adc-495f-bdfc-93b5542e8023';
const BASE = 'https://api.cloudflare.com/client/v4';
const ACCOUNT_ERASURE_MIGRATION = '0012_kinde_erasure_decisions.sql';
const ACCOUNT_ERASURE_MIGRATION_SHA256 = 'adb6a52afbdc62bd7c35afcf38e18f5e434d1c86eb75726ea07a4680914643a4';
const ACTIVITY_MIGRATION = '0013_kinde_activity_and_inactivity.sql';
const ACTIVITY_MIGRATION_SHA256 = '23b2f31acbd65eaad3d24f6a6fe0ffb68e754341d570d3fe34c2dea8b23913b7';
const SCHEDULER_MIGRATION = '0014_kinde_account_erasure_scheduler.sql';
const SCHEDULER_MIGRATION_SHA256 = '5f6a1a906794a0df57dc6877a6819546e410aeea2f42b6e9b7dd9e3fa766ccfd';
const MIGRATION_DIR = new URL('../cloudflare/api/migrations/', import.meta.url);
const EXISTING_TEST_TABLES = Object.freeze({
  subjects: 'sync_subjects',
  states: 'sync_state',
  documents: 'sync_documents',
  replicas: 'sync_replicas',
  receipts: 'sync_receipts',
  replica_mutations: 'sync_replica_mutations',
});
const ACCOUNT_ERASURE_TABLES = Object.freeze({
  erasure_targets: 'kinde_erasure_targets',
  deletion_attempts: 'kinde_deletion_oauth_attempts',
  account_intents: 'kinde_account_erasure_intents',
  account_requests: 'kinde_account_erasure_requests',
  provider_progress: 'kinde_account_erasure_provider_progress',
  account_completions: 'kinde_account_erasure_completions',
});

export function verifyExistingTestUpgradeSql(sql) {
  // Pin the additive schema before applying it to any test database.
  assert.equal(createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex'),
    ACCOUNT_ERASURE_MIGRATION_SHA256, 'unreviewed SQL for test D1');
}

export function verifyInactivityMigrationSql(sql) {
  assert.equal(createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex'),
    ACTIVITY_MIGRATION_SHA256, 'unreviewed inactivity SQL for test D1');
}

export function verifySchedulerMigrationSql(sql) {
  assert.equal(createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex'),
    SCHEDULER_MIGRATION_SHA256, 'unreviewed scheduler SQL for test D1');
}

export function verifyLocalMigrationTarget(config, names) {
  assert.deepEqual(names, MIGRATIONS, 'unexpected local migration set or ordering');
  assert.equal(config.name, 'thelogbook-api-isolated');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.equal(config.route, undefined);
  // The API Worker now binds a second D1 for independent revocation floors.
  // This operator workflow still migrates ONLY the first application DB.
  assert.equal(config.d1_databases?.length, 2);
  const [binding, recovery] = config.d1_databases;
  assert.equal(binding.binding, 'DB');
  assert.equal(binding.database_name, DATABASE);
  assert.equal(binding.database_id, DATABASE_ID);
  assert.equal(binding.migrations_dir, './migrations');
  assert.equal(recovery.binding, 'RECOVERY_DB');
  assert.equal(recovery.database_name, 'thelogbook-cf08-fence-eu-isolated-20261116');
  assert.equal(recovery.database_id, '19dad53f-0dda-4503-b161-758ac8cb7b21');
  assert.equal(recovery.migrations_dir, '../recovery/migrations');
  assert.notEqual(binding.database_id, recovery.database_id);
}

export function verifyMigrationLedger(rows, phase) {
  assert.ok(phase === 'before' || phase === 'after', 'invalid migration phase');
  assert.ok(Array.isArray(rows), 'missing D1 migration ledger');
  // The minimum supported isolated checkpoint is 0008. Resume only from
  // a contiguous known prefix so retry cannot replay or skip files.
  assert.ok(rows.length >= 8 && rows.length <= MIGRATIONS.length,
    'unexpected remote migration count');
  for (let i = 0; i < rows.length; i += 1) {
    assert.equal(rows[i]?.id, i + 1, 'non-contiguous remote migration IDs');
    assert.equal(rows[i]?.name, MIGRATIONS[i], 'remote migration differs from source');
  }
  if (phase === 'after') assert.equal(rows.length, MIGRATIONS.length,
    'remote migrations are not complete');
  return rows.length;
}

function unpackQuery(body) {
  assert.equal(body?.success, true, 'D1 query was not successful');
  assert.ok(Array.isArray(body.result) && body.result.length === 1
    && body.result[0]?.success === true
    && Array.isArray(body.result[0]?.results), 'invalid D1 query response');
  return body.result[0].results;
}

export async function verifyRemoteIsolatedD1({
  phase,
  account,
  existingTestDb0014 = false,
  priorInventory,
  request = fetch,
  token,
}) {
  assert.ok(phase === 'before' || phase === 'after', 'invalid verification phase');
  assert.match(account ?? '', /^[a-f0-9]{32}$/, 'invalid Cloudflare account');
  assert.ok(typeof token === 'string' && token.length > 0, 'missing D1 access token');

  const config = JSON.parse(readFileSync(
    new URL('../cloudflare/api/wrangler.isolated.jsonc', import.meta.url), 'utf8'));
  const names = readdirSync(MIGRATION_DIR)
    .filter(name => name.endsWith('.sql')).sort();
  verifyLocalMigrationTarget(config, names);
  verifyExistingTestUpgradeSql(readFileSync(new URL(ACCOUNT_ERASURE_MIGRATION, MIGRATION_DIR), 'utf8'));
  verifyInactivityMigrationSql(readFileSync(new URL(ACTIVITY_MIGRATION, MIGRATION_DIR), 'utf8'));
  verifySchedulerMigrationSql(readFileSync(new URL(SCHEDULER_MIGRATION, MIGRATION_DIR), 'utf8'));
  if (existingTestDb0014) assert.equal(names.length, 14, 'populated test D1 mode permits only reviewed migrations through 0014');

  const root = BASE + '/accounts/' + account + '/d1/database/' + DATABASE_ID;
  async function call(path, sql) {
    const response = await request(root + path, {
      method: sql ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        ...(sql ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(sql ? { body: JSON.stringify({ sql }) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('D1 provider read failed: HTTP ' + response.status);
    const body = await response.json();
    assert.equal(body?.success, true, 'D1 provider read was unsuccessful');
    return body;
  }

  const metadata = (await call('')).result;
  assert.equal(metadata?.uuid, DATABASE_ID, 'wrong D1 UUID');
  assert.equal(metadata?.name, DATABASE, 'wrong D1 database');
  assert.equal(metadata?.jurisdiction, 'eu', 'unexpected D1 jurisdiction');
  assert.equal(metadata?.read_replication?.mode, 'disabled', 'unexpected D1 read replication');

  const bookmark = (await call('/time_travel/bookmark')).result?.bookmark;
  assert.ok(typeof bookmark === 'string' && bookmark.length > 0,
    'missing D1 Time Travel checkpoint');

  const ledger = unpackQuery(await call('/query',
    'SELECT id, name FROM d1_migrations ORDER BY id'));
  const applied = verifyMigrationLedger(ledger, phase);
  if (existingTestDb0014 && phase === 'before') {
    assert.ok(applied >= 11 && applied <= 14,
      'populated test D1 requires a contiguous 0011–0014 prefix');
  }

  // Read only aggregates. The application DB already holds identity sessions
  // and older replica test records from before consent/ADK became required.
  const tables = {
    principals: 'auth_principals',
    sessions: 'auth_sessions',
    keys: 'cloud_account_keys',
    erasure_jobs: 'health_erasure_jobs',
    ...(existingTestDb0014 ? { consents: 'health_consent_acceptances', ...EXISTING_TEST_TABLES } : {}),
    ...(applied >= 12 ? ACCOUNT_ERASURE_TABLES : {}),
    ...(applied >= 13 ? { activity: 'kinde_account_activity' } : {}),
  };
  const countSql = Object.entries(tables).map(([key, table]) => `(SELECT COUNT(*) FROM ${table}) AS ${key}`).join(', ');
  const counts = unpackQuery(await call('/query', 'SELECT ' + countSql));
  assert.equal(counts.length, 1, 'invalid isolation count response');
  const emptyTables = existingTestDb0014 ? ['keys', 'erasure_jobs', 'consents'] : ['principals', 'sessions', 'keys', 'erasure_jobs'];
  if (applied >= 12) emptyTables.push(...Object.keys(ACCOUNT_ERASURE_TABLES));
  if (applied >= 13) emptyTables.push('activity');
  for (const key of emptyTables) {
    assert.equal(counts[0]?.[key], 0, 'non-empty isolated D1 ' + key);
  }
  let inventory;
  if (existingTestDb0014) {
    inventory = Object.fromEntries(['principals', 'sessions', ...Object.keys(EXISTING_TEST_TABLES)]
      .map(key => [key, counts[0]?.[key]]));
    assert.ok(Object.values(inventory).every(count => Number.isSafeInteger(count) && count >= 0),
      'invalid existing test inventory');
    assert.ok(inventory.principals > 0, 'existing test identities missing');
    if (phase === 'after') assert.deepEqual(inventory, priorInventory, 'existing test inventory changed');
  }

  if (applied >= 14) {
    const checkpoint = unpackQuery(await call('/query',
      'SELECT singleton, cursor_uid, lease_epoch, lease_token, lease_until_ms FROM kinde_account_erasure_scheduler ORDER BY singleton LIMIT 2'));
    assert.deepEqual(checkpoint, [{ singleton: 1, cursor_uid: null, lease_epoch: 0, lease_token: null, lease_until_ms: 0 }],
      'new account erasure scheduler must remain unused');
  }

  if (phase === 'after') {
    const schema = unpackQuery(await call('/query', [
      "SELECT name, type, sql FROM sqlite_master WHERE name IN (",
      "'cloud_key_first_issuance',",
      "'sync_writable_cloud_key',",
      "'health_erasure_finalizations',",
      "'health_erasure_finalization_fence',",
      "'kinde_account_erasure_activity_terminal_fence', 'kinde_account_erasure_completion_fence',",
      "'kinde_account_erasure_freeze',",
      ...Object.values(ACCOUNT_ERASURE_TABLES).map(name => "'" + name + "',"),
      "'kinde_account_activity', 'kinde_account_activity_by_last_seen',",
      "'kinde_account_activity_insert_fence', 'kinde_account_activity_update_fence',",
      "'kinde_inactivity_control', 'kinde_inactivity_control_generation',",
      "'kinde_inactivity_control_no_delete', 'kinde_inactivity_control_no_replace',
      'kinde_inactivity_intent_fence', 'kinde_inactivity_intent_freeze',",
      "'kinde_account_erasure_scheduler', 'kinde_account_erasure_scheduler_no_delete',",
      "'kinde_account_erasure_scheduler_no_replace', 'kinde_account_erasure_scheduler_transition',",
      "'auth_sessions_owner_token') ORDER BY name",
    ].join(' ')));
    assert.deepEqual(schema.map(row => [row.name, row.type]), [
      ['auth_sessions_owner_token', 'index'],
      ['cloud_key_first_issuance', 'trigger'],
      ['health_erasure_finalization_fence', 'trigger'],
      ['health_erasure_finalizations', 'table'],
      ['kinde_account_activity', 'table'],
      ['kinde_account_activity_by_last_seen', 'index'],
      ['kinde_account_activity_insert_fence', 'trigger'],
      ['kinde_account_activity_update_fence', 'trigger'],
      ['kinde_account_erasure_activity_terminal_fence', 'trigger'],
      ['kinde_account_erasure_completion_fence', 'trigger'],
      ['kinde_account_erasure_completions', 'table'],
      ['kinde_account_erasure_freeze', 'trigger'],
      ['kinde_account_erasure_intents', 'table'],
      ['kinde_account_erasure_provider_progress', 'table'],
      ['kinde_account_erasure_requests', 'table'],
      ['kinde_account_erasure_scheduler', 'table'],
      ['kinde_account_erasure_scheduler_no_delete', 'trigger'],
      ['kinde_account_erasure_scheduler_no_replace', 'trigger'],
      ['kinde_account_erasure_scheduler_transition', 'trigger'],
      ['kinde_deletion_oauth_attempts', 'table'],
      ['kinde_erasure_targets', 'table'],
      ['kinde_inactivity_control', 'table'],
      ['kinde_inactivity_control_generation', 'trigger'],
      ['kinde_inactivity_control_no_delete', 'trigger'],
      ['kinde_inactivity_control_no_replace', 'trigger'],
      ['kinde_inactivity_intent_fence', 'trigger'],
      ['kinde_inactivity_intent_freeze', 'trigger'],
      ['sync_writable_cloud_key', 'view'],
    ], 'final D1 schema objects missing');
    const controls = unpackQuery(await call('/query',
      'SELECT singleton, mode, generation FROM kinde_inactivity_control ORDER BY singleton LIMIT 2'));
    assert.deepEqual(controls, [{ singleton: 1, mode: 'paused', generation: 1 }],
      'new inactivity scanner must remain paused');
    for (const row of schema.filter(({ name }) => name === 'cloud_key_first_issuance' || name === 'sync_writable_cloud_key')) {
      assert.ok(typeof row.sql === 'string' && row.sql.includes(D1_NOW_MS), 'missing integer consent clock in ' + row.name);
      assert.doesNotMatch(row.sql, /julianday/i, 'legacy consent clock in ' + row.name);
    }
  }

  return { phase, applied, expected: MIGRATIONS.length,
    jurisdiction: 'eu', timeTravelBookmarkVerified: true,
    ...(inventory ? { inventory } : {}) };
}

async function verifyFromCli() {
  const [, , phase, flag = 'false', inventoryPath] = process.argv;
  assert.ok(flag === 'true' || flag === 'false', 'invalid populated test DB mode');
  const existingTestDb0014 = flag === 'true';
  if (existingTestDb0014) assert.ok(inventoryPath, 'missing private run inventory path');
  const priorInventory = existingTestDb0014 && phase === 'after'
    ? JSON.parse(readFileSync(inventoryPath, 'utf8')) : undefined;
  const { inventory, ...result } = await verifyRemoteIsolatedD1({
    phase, existingTestDb0014, priorInventory,
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
  });
  if (existingTestDb0014 && phase === 'before') {
    writeFileSync(inventoryPath, JSON.stringify(inventory), { flag: 'wx', mode: 0o600 });
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifyFromCli().then(result => console.log(JSON.stringify(result)),
    () => {
      console.error('Isolated D1 verification failed (no secrets or data printed)');
      process.exitCode = 1;
    });
}
