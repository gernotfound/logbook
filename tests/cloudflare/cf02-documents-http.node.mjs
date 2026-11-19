import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import worker from '../../cloudflare/api/worker.mjs';
import { migration, identityMigration, rollback, origin, replica, withFixture, attempt, makeEnv, call, claim, retire } from './cf02-documents-fixture.mjs';

void test('simultaneous stale revisions have one winner and no phantom receipt', () => withFixture(async (db, other) => {
  const [a, b] = await Promise.all([
    call(db, 'commit', attempt('batch000000000006', 1, 0)),
    call(other, 'commit', attempt('batch000000000007', 1, 0)),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) as n FROM sync_receipts').get().n, 1);
}));

void test('cheap HTTP preflight rejects bad media types and declared overflow before private AuthGate', () => withFixture(async db => {
  let authCalls = 0;
  const env = makeEnv(db);
  env.AUTH_GATE = {
    async fetch() {
      authCalls += 1;
      throw new Error('synthetic AuthGate should not be called for rejected headers');
    },
  };
  for (const input of [
    { body: '{}', type: 'text/plain', expected: 415 },
    { body: '{}'.padEnd(129, ' '), type: 'application/json', expected: 413 },
  ]) {
    const response = await worker.fetch(new Request(origin + '/v1/sync/control', {
      method: 'POST',
      headers: {
        Origin: origin, 'Content-Type': input.type,
        'Content-Length': String(Buffer.byteLength(input.body)),
      },
      body: input.body,
    }), env);
    assert.equal(response.status, input.expected);
  }
  assert.equal(authCalls, 0);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);

  const valid = await worker.fetch(new Request(origin + '/v1/sync/control', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  }), env);
  assert.equal(valid.status, 503);
  assert.equal(authCalls, 1);
}));

void test('each sync route rejects oversized JSON before D1 work without shrinking the commit budget', () => withFixture(async db => {
  // All bodies below are syntactically valid JSON: padding with whitespace
  // proves the request budget, not Zod shape rejection, caused the 413.
  const cases = [
    ['control', {}, 128],
    ['read', { paths: [''] }, 512],
    ['scan', { after: null, expectedRevision: null }, 256],
    ['receipt', { batchId: 'batch000000000001' }, 256],
    ['commit/status', { batchId: 'batch000000000001', expectedRevision: 0, expectedFenceEpoch: 5,
      consentRevision: 1, requestHash: 'a'.repeat(64) }, 512],
    ['replica/claim', claim('mutation0000000901'), 4096],
    ['replica/retire', retire('mutation0000000902', 0), 4096],
    ['replica/status', claim('mutation0000000903'), 4096],
  ];
  for (const [route, body, max] of cases) {
    const padded = JSON.stringify(body).padEnd(max + 1, ' ');
    const response = await worker.fetch(new Request(origin + '/v1/sync/' + route, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: padded,
    }), makeEnv(db));
    assert.equal(response.status, 413, route);
    assert.deepEqual(await response.json(), { error: 'payload-too-large' }, route);
  }

  // A legitimate request at the limit still parses, and query-string aliases
  // cannot address the same authenticated operation with different URLs.
  const boundary = await worker.fetch(new Request(origin + '/v1/sync/control', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}'.padEnd(128, ' '),
  }), makeEnv(db));
  assert.equal(boundary.status, 200);
  const alias = await worker.fetch(new Request(origin + '/v1/sync/control?shadow=1', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  }), makeEnv(db));
  assert.equal(alias.status, 404);

  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_replica_mutations').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
}));

void test('oversized streamed bodies fail with 413 before any D1 mutation', () => withFixture(async db => {
  const largeBody = JSON.stringify({ data: 'X'.repeat(8 * 950000 + 8193) });
  const response = await worker.fetch(new Request(origin + '/v1/sync/commit', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: largeBody,
  }), makeEnv(db));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'payload-too-large');
  assert.equal(db.sqlite.prepare('SELECT count(*) as n FROM sync_receipts').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT revision FROM sync_state').get().revision, 0);
}));

void test('isolated migration rollback only targets its original disposable schema', () => {
  // The historical 0001/0002 rollback does not remove newer Auth/consent
  // tables. Verify its own contract against a dedicated disposable database.
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys=ON');
    sqlite.exec(migration);
    sqlite.exec(identityMigration);
    sqlite.exec(rollback);
    const existing = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_subjects'").get();
    assert.equal(existing, undefined);
  } finally {
    sqlite.close();
  }
});

