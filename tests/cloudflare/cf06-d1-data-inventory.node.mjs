import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ACCOUNT_AUTH_CLEANUP_TABLES, HEALTH_CHILD_TABLES, HEALTH_DATA_CLEANUP_TABLES } from '../../cloudflare/jobs/erasure-tables.mjs';
import { applyCurrentD1Schema, applyCurrentD1RecoverySchema } from './current-d1-schema.mjs';

const inventory = JSON.parse(readFileSync(new URL('../../docs/operations/cloudflare-d1-data-inventory.json', import.meta.url), 'utf8'));

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(row => row.name);
}

function verifyClassification(db, entries) {
  assert.deepEqual(tableNames(db), Object.keys(entries).sort(), 'every D1 table needs an explicit classification');
  for (const [name, [owner, dataClass, health, account, purpose, restore]] of Object.entries(entries)) {
    assert.ok([dataClass, health, account, purpose, restore].every(field => typeof field === 'string' && field.length > 0), name);
    const columns = db.prepare('SELECT name FROM pragma_table_info(?)').all(name).map(row => row.name);
    if (owner === 'none') assert.ok(!columns.includes('uid') && !columns.includes('cursor_uid'), name);
    else assert.ok(columns.includes(owner), name + ' owner column missing');
    if (owner === 'uid') assert.ok(columns.includes('uid'), name);
    if (owner === 'cursor_uid') assert.equal(account, 'control', name);
  }
}

void test('the full actual application and recovery schemas have classified tables', (t) => {
  const app = new DatabaseSync(':memory:');
  const recovery = new DatabaseSync(':memory:');
  t.after(() => { app.close(); recovery.close(); });
  app.exec('PRAGMA foreign_keys = ON');
  recovery.exec('PRAGMA foreign_keys = ON');
  applyCurrentD1Schema(app);
  applyCurrentD1RecoverySchema(recovery);
  assert.equal(inventory.schemaVersion, 1);
  verifyClassification(app, inventory.application);
  verifyClassification(recovery, inventory.recovery);
  // A new table cannot silently inherit a policy or authorize a deletion.
  app.exec('CREATE TABLE unclassified_example (uid TEXT)');
  assert.throws(() => verifyClassification(app, inventory.application), /explicit classification/);
});

void test('explicit runtime cleanup allowlists and orphan-health proof agree with the inventory', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = ON');
  applyCurrentD1Schema(db);
  const policy = Object.entries(inventory.application);
  const byAccount = action => policy.filter(([, entry]) => entry[3] === action).map(([name]) => name).sort();
  const names = tables => tables.map(row => row.name).sort();
  assert.deepEqual(names(ACCOUNT_AUTH_CLEANUP_TABLES), byAccount('account-chunk'));
  assert.deepEqual(names(HEALTH_DATA_CLEANUP_TABLES), byAccount('health-chunk'));
  assert.deepEqual(names(HEALTH_DATA_CLEANUP_TABLES),
    policy.filter(([, entry]) => entry[2] === 'health-chunk').map(([name]) => name).sort());
  assert.deepEqual(byAccount('health-terminal'), ['cloud_account_keys']);
  assert.deepEqual(byAccount('account-terminal'), ['kinde_erasure_targets']);
  for (const { name, key } of [...ACCOUNT_AUTH_CLEANUP_TABLES, ...HEALTH_DATA_CLEANUP_TABLES]) {
    const keyColumns = db.prepare('SELECT name FROM pragma_table_info(?) WHERE pk > 0').all(name).map(row => row.name);
    assert.ok(keyColumns.includes(key), name + ' bounded deletion key must be a primary key column');
  }
  // Derive the independent expectation from actual FK edges, not from the
  // runner's list of names. A newly added health child must be reviewed.
  const healthChildren = tableNames(db).filter(name =>
    db.prepare('SELECT "table" AS parent FROM pragma_foreign_key_list(?)').all(name)
      .some(row => row.parent === 'sync_subjects'));
  assert.deepEqual([...HEALTH_CHILD_TABLES].sort(), healthChildren);
});
