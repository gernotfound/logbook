import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const directory = new URL('../../cloudflare/api/migrations/', import.meta.url);
const migrations = readdirSync(directory)
  .filter(name => /^[0-9]{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
assert.ok(migrations.length >= 10, 'D1 runtime fixtures require the current complete schema');
assert.deepEqual(migrations.map(name => name.slice(0, 4)),
  Array.from({ length: migrations.length }, (_, index) => String(index + 1).padStart(4, '0')));

// Runtime tests must acquire new SQL fences when the schema advances. Only
// tests of a specific historical migration/rollback should apply a prefix.
export function applyCurrentD1Schema(sqlite) {
  for (const name of migrations) sqlite.exec(readFileSync(new URL(name, directory), 'utf8'));
}

const recoveryDirectory = new URL('../../cloudflare/recovery/migrations/', import.meta.url);
const recoveryMigrations = readdirSync(recoveryDirectory)
  .filter(name => /^[0-9]{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
assert.deepEqual(recoveryMigrations.map(name => name.slice(0, 4)),
  Array.from({ length: recoveryMigrations.length }, (_, index) => String(index + 1).padStart(4, '0')));

export function applyCurrentD1RecoverySchema(sqlite) {
  assert.ok(recoveryMigrations.length >= 4, 'runtime fixtures require the full independent recovery schema');
  for (const name of recoveryMigrations) sqlite.exec(readFileSync(new URL(name, recoveryDirectory), 'utf8'));
}
