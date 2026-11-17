import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { D1_NOW_MS } from '../../cloudflare/sql/d1-time.mjs';
import { activeSessionPredicateSql } from '../../cloudflare/auth/session-write-fence.mjs';

void test('D1 clock uses integer milliseconds, including fixed second boundaries', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const [date, expected] of [
      ['1970-01-01 00:00:00.000', 0],
      ['1970-01-01 00:00:01.999', 1999],
      ['2026-11-14 18:50:59.999', 1794682259999],
    ]) {
      const expression = D1_NOW_MS.replaceAll("'now'", "'" + date + "'");
      const result = db.prepare('SELECT ' + expression + ' AS ms').get();
      assert.equal(result.ms, expected);
    }
    assert.equal(activeSessionPredicateSql.includes(D1_NOW_MS), true);
    assert.doesNotMatch(activeSessionPredicateSql, /julianday/);
  } finally { db.close(); }
});

void test('a just-issued Worker timestamp is not spuriously in the SQL future', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const stmt = db.prepare('SELECT ? <= ' + D1_NOW_MS + ' AS accepted, ' + D1_NOW_MS + ' AS server_ms');
    for (let i = 0; i < 150; i += 1) {
      const issuedAtMs = Date.now();
      const row = stmt.get(issuedAtMs);
      const after = Date.now();
      assert.equal(row.accepted, 1, 'SQL must not reject a fresh same-millisecond session');
      assert.ok(row.server_ms >= issuedAtMs && row.server_ms <= after);
    }
  } finally { db.close(); }
});
