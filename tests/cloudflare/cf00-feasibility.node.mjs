import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { commitSyntheticBatch, prepareFixture, readReceipt, readSyntheticState } from '../../cloudflare/cf00/contract.mjs';
import worker, { PasswordProbe } from '../../cloudflare/cf00/probe-worker.mjs';

class LocalD1Statement {
  constructor(db, sql, bindings = []) { this.db = db; this.sql = sql; this.bindings = bindings; }
  bind(...values) { return new LocalD1Statement(this.db, this.sql, values); }
  run() { return this.db.prepare(this.sql).run(...this.bindings); }
  async first() { return this.db.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.bindings) }; }
}

class LocalD1ContractAdapter {
  constructor(file) { this.sqlite = new DatabaseSync(file); this.sqlite.exec('PRAGMA busy_timeout=3000;'); }
  prepare(sql) { return new LocalD1Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const outcomes = statements.map(s => s.run());
      this.sqlite.exec('COMMIT');
      return outcomes;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'thelogbook-cf00-'));
  const file = join(dir, 'only-synthetic.sqlite3');
  const a = new LocalD1ContractAdapter(file);
  const b = new LocalD1ContractAdapter(file);
  return Promise.resolve().then(() => fn(a, b)).finally(() => {
    a.close(); b.close(); rmSync(dir, { recursive: true, force: true });
  });
}

const attempt = (writer, batchId, expectedRev = 0, consentEpoch = 7) => ({
  writer, batchId, expectedRev, consentEpoch,
});

test('one of two writers with identical revision succeeds and the other rolls back', () => withDb(async (a, b) => {
  await prepareFixture(a);
  const outcomes = await Promise.allSettled([
    commitSyntheticBatch(a, attempt('writer-a', 'batch000000000001-a')),
    commitSyntheticBatch(b, attempt('writer-b', 'batch000000000001-b')),
  ]);
  assert.deepEqual(outcomes.map(x => x.status).sort(), ['fulfilled', 'rejected']);
  const state = await readSyntheticState(a);
  assert.equal(state.control.revision, 1);
  assert.equal(state.control.consent_epoch, 7);
  assert.equal(state.docs.length, 1);
  const winner = outcomes[0].status === 'fulfilled' ? 'a' : 'b';
  const receipt = await readReceipt(a, `batch000000000001-${winner}`);
  assert.equal(receipt.committed_rev, 1);
  assert.equal(await readReceipt(a, `batch000000000001-${winner === 'a' ? 'b' : 'a'}`), null);
}));

test('stale consent and failed late statement never persist receipt or document', () => withDb(async (a) => {
  await prepareFixture(a);
  await assert.rejects(commitSyntheticBatch(a, attempt('writer-a', 'batch000000000002-a', 0, 6)), /stale/i);
  assert.equal((await readSyntheticState(a)).control.revision, 0);
  await assert.rejects(a.batch([
    a.prepare('INSERT INTO cf00_receipt VALUES (?, ?, ?, ?, ?)').bind('cf00-synthetic-owner', 'batch000000000002-b', 0, 7, 1),
    a.prepare('INSERT INTO cf00_document VALUES (?, ?, ?, ?)').bind('cf00-synthetic-owner', 'writer-a', 'synthetic', 1),
    a.prepare('INSERT INTO cf00_receipt VALUES (?, ?, ?, ?, ?)').bind('cf00-synthetic-owner', 'batch000000000002-b', 0, 7, 1),
  ]), /UNIQUE/i);
  assert.equal((await readSyntheticState(a)).docs.length, 0);
  assert.equal(await readReceipt(a, 'batch000000000002-b'), null);
}));

test('duplicate batch cannot produce a second commit; receipt permits lost-ACK recovery', () => withDb(async (a) => {
  await prepareFixture(a);
  const write = attempt('writer-a', 'batch000000000003-a');
  await commitSyntheticBatch(a, write);
  await assert.rejects(commitSyntheticBatch(a, write));
  assert.equal((await readSyntheticState(a)).control.revision, 1);
  assert.deepEqual({ ...(await readReceipt(a, write.batchId)) }, {
    expected_rev: 0, consent_epoch: 7, committed_rev: 1,
  });
}));

test('probe defaults to unavailable and requires a secret even when enabled', async () => {
  const url = 'https://cf00.invalid/__cf00/init';
  const missing = await worker.fetch(new Request(url, { method: 'POST' }), {});
  assert.equal(missing.status, 404);
  const invalid = await worker.fetch(new Request(url, { method: 'POST', headers: { 'x-cf00-secret': 'wrong' } }), {
    CF00_PROBE_ENABLED: 'true', CF00_PROBE_SECRET: 'a'.repeat(48),
  });
  assert.equal(invalid.status, 404);
});

test('work factor probes use synthetic data and do not expose hash output', async () => {
  const probe = new PasswordProbe();
  const r = await probe.fetch(new Request('https://cf00.invalid/?algorithm=pbkdf2', { method: 'POST' }));
  const p = await r.json();
  assert.equal(r.status, 200);
  assert.equal(p.algorithm, 'pbkdf2-sha256');
  assert.equal(p.workFactor, 600000);
  assert.equal(p.outputBits, 256);
  assert.ok(p.wallMs > 0);
  assert.ok(!('hash' in p));
  const q = await probe.fetch(new Request('https://cf00.invalid/?algorithm=scrypt', { method: 'POST' }));
  const s = await q.json();
  assert.equal(q.status, 200);
  assert.equal(s.algorithm, 'scrypt');
  assert.deepEqual([s.N, s.r, s.p], [16384, 8, 5]);
  assert.ok(s.wallMs > 0);
  assert.ok(!('hash' in s));
});
