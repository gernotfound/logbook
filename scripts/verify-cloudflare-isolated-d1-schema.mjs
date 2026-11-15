import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
`.trim().split('\n'));
const DATABASE = 'thelogbook-cf02-eu-isolated-20261113';
const DATABASE_ID = '9aa51833-8adc-495f-bdfc-93b5542e8023';
const BASE = 'https://api.cloudflare.com/client/v4';

export function verifyLocalMigrationTarget(config, names) {
  assert.deepEqual(names, MIGRATIONS, 'unexpected local migration set or ordering');
  assert.equal(config.name, 'thelogbook-api-isolated');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.equal(config.route, undefined);
  assert.equal(config.d1_databases?.length, 1);
  const binding = config.d1_databases[0];
  assert.equal(binding.binding, 'DB');
  assert.equal(binding.database_name, DATABASE);
  assert.equal(binding.database_id, DATABASE_ID);
  assert.equal(binding.migrations_dir, './migrations');
}

export function verifyMigrationLedger(rows, phase) {
  assert.ok(phase === 'before' || phase === 'after', 'invalid migration phase');
  assert.ok(Array.isArray(rows), 'missing D1 migration ledger');
  // The isolated database has received 0001-0008. An interrupted official
  // migration may have applied 0009; retry must not replay or skip a file.
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
  phase, account, token, request = fetch,
}) {
  assert.ok(phase === 'before' || phase === 'after', 'invalid verification phase');
  assert.match(account ?? '', /^[a-f0-9]{32}$/, 'invalid Cloudflare account');
  assert.ok(typeof token === 'string' && token.length > 0, 'missing D1 access token');

  const config = JSON.parse(readFileSync(
    new URL('../cloudflare/api/wrangler.isolated.jsonc', import.meta.url), 'utf8'));
  const names = readdirSync(new URL('../cloudflare/api/migrations/', import.meta.url))
    .filter(name => name.endsWith('.sql')).sort();
  verifyLocalMigrationTarget(config, names);

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

  // No principal/session/key/erasure job may exist in this isolated sandbox.
  // Read only aggregates; never request identities or ciphertext from D1.
  const counts = unpackQuery(await call('/query', [
    'SELECT',
    '(SELECT COUNT(*) FROM auth_principals) AS principals,',
    '(SELECT COUNT(*) FROM auth_sessions) AS sessions,',
    '(SELECT COUNT(*) FROM cloud_account_keys) AS keys,',
    '(SELECT COUNT(*) FROM health_erasure_jobs) AS erasure_jobs',
  ].join(' ')));
  assert.equal(counts.length, 1, 'invalid isolation count response');
  for (const key of ['principals', 'sessions', 'keys', 'erasure_jobs']) {
    assert.equal(counts[0]?.[key], 0, 'non-empty isolated D1 ' + key);
  }

  if (phase === 'after') {
    const schema = unpackQuery(await call('/query', [
      "SELECT name, type FROM sqlite_master WHERE name IN (",
      "'sync_writable_cloud_key',",
      "'health_erasure_finalizations',",
      "'health_erasure_finalization_fence') ORDER BY name",
    ].join(' ')));
    assert.deepEqual(schema.map(row => [row.name, row.type]), [
      ['health_erasure_finalization_fence', 'trigger'],
      ['health_erasure_finalizations', 'table'],
      ['sync_writable_cloud_key', 'view'],
    ], 'final D1 schema objects missing');
  }

  return { phase, applied, expected: MIGRATIONS.length,
    jurisdiction: 'eu', timeTravelBookmarkVerified: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifyRemoteIsolatedD1({
    phase: process.argv[2],
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
  }).then(result => console.log(JSON.stringify(result)),
    () => {
      console.error('Isolated D1 verification failed (no secrets or data printed)');
      process.exitCode = 1;
    });
}
