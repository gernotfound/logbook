import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DATABASE = 'thelogbook-cf08-fence-eu-isolated-20261116';
const DATABASE_ID = '19dad53f-0dda-4503-b161-758ac8cb7b21';
const HOST = 'https://api.cloudflare.com/client/v4';
const ACCOUNT_ERASURE_DENIALS = '0005_account_erasure_denials.sql';
const ACCOUNT_ERASURE_DENIALS_SHA256 = 'f80445a586839c477a7cdfe531038845a3c20f92c8e8544cf28280fb0480cd8e';
const MIGRATION_DIR = new URL('../cloudflare/recovery/migrations/', import.meta.url);
export const RECOVERY_MIGRATIONS = Object.freeze([
  '0001_independent_owner_fences.sql',
  '0002_block_replace_bypass.sql',
  '0003_withdraw_pending_health_consent.sql',
  '0004_health_erasure_cutoffs.sql',
  ACCOUNT_ERASURE_DENIALS,
]);

export function verifyRecoveryDenialUpgradeSql(sql) {
  assert.equal(createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex'),
    ACCOUNT_ERASURE_DENIALS_SHA256, 'unreviewed SQL for the sealed recovery D1');
}

export function verifyLocalRecoveryTarget(config, files) {
  assert.deepEqual(files, RECOVERY_MIGRATIONS, 'unexpected recovery migration ordering');
  assert.equal(config.name, 'thelogbook-api-isolated');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.equal(config.route, undefined);
  assert.equal(config.d1_databases?.length, 2);
  const [app, recovery] = config.d1_databases;
  assert.equal(app.binding, 'DB');
  assert.equal(app.database_id, '9aa51833-8adc-495f-bdfc-93b5542e8023');
  assert.equal(recovery.binding, 'RECOVERY_DB');
  assert.equal(recovery.database_name, DATABASE);
  assert.equal(recovery.database_id, DATABASE_ID);
  assert.equal(recovery.migrations_dir, '../recovery/migrations');
  assert.notEqual(app.database_id, recovery.database_id);
}

export function verifyRecoveryLedger(rows, phase) {
  assert.ok(phase === 'before' || phase === 'after');
  assert.ok(Array.isArray(rows), 'missing migration ledger');
  assert.ok(rows.length >= 2 && rows.length <= RECOVERY_MIGRATIONS.length,
    'unexpected recovery schema version');
  for (let i = 0; i < rows.length; i++) {
    assert.equal(rows[i]?.id, i + 1, 'non-contiguous recovery migrations');
    assert.equal(rows[i]?.name, RECOVERY_MIGRATIONS[i], 'unknown applied migration');
  }
  if (phase === 'after') assert.equal(rows.length, RECOVERY_MIGRATIONS.length,
    'recovery migration incomplete');
  return rows.length;
}

export function verifyRecoverySnapshot({ metadata, bookmark, ledger, control, schema, phase }) {
  assert.ok(phase === 'before' || phase === 'after');
  assert.equal(metadata?.uuid, DATABASE_ID, 'wrong recovery D1 UUID');
  assert.equal(metadata?.name, DATABASE, 'wrong recovery D1');
  assert.equal(metadata?.jurisdiction, 'eu', 'unexpected D1 jurisdiction');
  assert.equal(metadata?.read_replication?.mode, 'disabled', 'unapproved replication');
  assert.ok(typeof bookmark === 'string' && bookmark.length > 0,
    'no D1 Time Travel bookmark');
  const applied = verifyRecoveryLedger(ledger, phase);
  assert.ok(Array.isArray(control) && control.length === 1, 'invalid recovery control');
  assert.equal(control[0]?.mode, 'sealed', 'never migrate an opened registry');
  assert.equal(control[0]?.generation, 1, 'unexpected recovery generation');
  assert.equal(control[0]?.owners, 0, 'existing recovery owners: stop');
  if (applied >= 4) assert.equal(control[0]?.cutoffs, 0, 'unexpected cutoff queue');
  if (applied >= 5) assert.equal(control[0]?.account_denials, 0, 'existing account erasure denials: stop');
  if (phase === 'after') {
    assert.ok(Array.isArray(schema), 'missing schema verification');
    const objects = new Map(schema.map(entry => [entry.name, entry]));
    for (const [name, type] of [
      ['recovery_erasure_cutoffs', 'table'],
      ['recovery_erasure_cutoffs_due', 'index'],
      ['recovery_erasure_cutoff_insert_fenced', 'trigger'],
      ['recovery_erasure_cutoff_no_delete', 'trigger'],
      ['recovery_erasure_cutoff_update_fenced', 'trigger'],
      ['recovery_erasure_cutoff_close_with_terminal_floor', 'trigger'],
      ['recovery_owner_monotone', 'trigger'],
      ['recovery_account_erasure_denials', 'table'],
      ['recovery_account_erasure_deny_insert', 'trigger'],
      ['recovery_account_erasure_block_fitness', 'trigger'],
      ['recovery_account_erasure_no_consent_reactivation', 'trigger'],
      ['recovery_account_erasure_deny_no_update', 'trigger'],
      ['recovery_account_erasure_deny_no_delete', 'trigger'],
    ]) assert.equal(objects.get(name)?.type, type, 'missing recovery schema object: ' + name);
    assert.ok(objects.get('recovery_owner_monotone').sql.includes(
      "NEW.status IN ('active', 'blocked')"), 'pending-to-blocked guard absent');
  }
  return { phase, applied, expected: RECOVERY_MIGRATIONS.length, mode: 'sealed' };
}

function unpack(body) {
  assert.equal(body?.success, true);
  assert.ok(Array.isArray(body.result) && body.result.length === 1
    && body.result[0]?.success === true && Array.isArray(body.result[0]?.results),
  'invalid D1 provider query response');
  return body.result[0].results;
}

export async function verifyRemoteRecoveryD1({ phase, account, token, request = fetch }) {
  assert.ok(phase === 'before' || phase === 'after');
  assert.match(account ?? '', /^[a-f0-9]{32}$/, 'invalid account ID');
  assert.ok(typeof token === 'string' && token.length > 0, 'missing D1 token');
  const config = JSON.parse(readFileSync(
    new URL('../cloudflare/api/wrangler.isolated.jsonc', import.meta.url), 'utf8'));
  const names = readdirSync(MIGRATION_DIR)
    .filter(name => name.endsWith('.sql')).sort();
  verifyLocalRecoveryTarget(config, names);
  verifyRecoveryDenialUpgradeSql(readFileSync(new URL(ACCOUNT_ERASURE_DENIALS, MIGRATION_DIR), 'utf8'));
  const root = HOST + '/accounts/' + account + '/d1/database/' + DATABASE_ID;
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
    if (!response.ok) throw Error('D1 recovery read HTTP ' + response.status);
    const data = await response.json();
    assert.equal(data?.success, true, 'D1 recovery read rejected');
    return data;
  }
  const metadata = (await call('')).result;
  const bookmark = (await call('/time_travel/bookmark')).result?.bookmark;
  const ledger = unpack(await call('/query', 'SELECT id, name FROM d1_migrations ORDER BY id'));
  const applied = verifyRecoveryLedger(ledger, phase);
  const sql = [
    'SELECT r.mode, r.generation,',
    '(SELECT COUNT(*) FROM recovery_owner_fences) AS owners,',
    applied >= 4 ? '(SELECT COUNT(*) FROM recovery_erasure_cutoffs) AS cutoffs,' : '0 AS cutoffs,',
    applied >= 5 ? '(SELECT COUNT(*) FROM recovery_account_erasure_denials) AS account_denials' : '0 AS account_denials',
    'FROM recovery_control r WHERE r.singleton = 1',
  ].join(' ');
  const control = unpack(await call('/query', sql));
  const schema = phase === 'after'
    ? unpack(await call('/query', [
      "SELECT name, type, sql FROM sqlite_master WHERE name LIKE 'recovery_erasure_cutoff%'",
      "OR name LIKE 'recovery_account_erasure_%'",
      "OR name IN ('recovery_erasure_cutoffs', 'recovery_erasure_cutoffs_due',",
      "'recovery_owner_monotone') ORDER BY name",
    ].join(' ')))
    : undefined;
  return verifyRecoverySnapshot({ metadata, bookmark, ledger, control, schema, phase });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifyRemoteRecoveryD1({
    phase: process.argv[2], account: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
  }).then(result => console.log(JSON.stringify(result)), () => {
    console.error('Recovery D1 schema verification failed; no success claimed');
    process.exitCode = 1;
  });
}
