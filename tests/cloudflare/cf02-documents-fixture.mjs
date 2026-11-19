import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../../cloudflare/api/worker.mjs';
import { releaseCloudAccountDataKey } from '../../cloudflare/api/cloud-key-store.mjs';
import { applyCurrentD1RecoverySchema, applyCurrentD1Schema } from './current-d1-schema.mjs';

export const syntheticSessionHash = 'b'.repeat(64);
export const origin = 'https://candidate.invalid';
export const owner = 'cf02-synthetic-owner';
export const replica = { slot: 's00', replicaId: 'synthetic-replica-0001', generation: 1 };
export const independentDatabases = new WeakMap();

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  run() { return this.db.prepare(this.sql).run(...this.args); }
}
class D1SqliteAdapter {
  constructor(file) {
    this.sqlite = new DatabaseSync(file);
    this.sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  withSession(mode) { assert.equal(mode, 'first-primary'); return this; }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const values = statements.map(statement => /^\s*SELECT\b/i.test(statement.sql)
        ? statement.all() : { results: [], meta: statement.run() });
      this.sqlite.exec('COMMIT');
      return values;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}
export async function withFixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'thelogbook-cf02-'));
  const filename = join(dir, 'synthetic.sqlite');
  const db = new D1SqliteAdapter(filename);
  const second = new D1SqliteAdapter(filename);
  const fence = new D1SqliteAdapter(join(dir, 'independent.sqlite'));
  independentDatabases.set(db, fence);
  independentDatabases.set(second, fence);
  try {
    applyCurrentD1RecoverySchema(fence.sqlite);
    fence.sqlite.prepare("UPDATE recovery_control SET mode='open',generation=2 WHERE singleton=1").run();
    applyCurrentD1Schema(db.sqlite);
    const issuedAt = Date.now() - 5000;
    db.sqlite.prepare('INSERT INTO auth_principals (uid,status,verified_at_ms,auth_epoch) VALUES (?,?,?,?)')
      .run(owner, 'active', issuedAt, 5);
    db.sqlite.prepare('INSERT INTO auth_sessions (token_hash,uid,auth_epoch,csrf_hash,issued_at_ms,idle_expires_at_ms,absolute_expires_at_ms) VALUES (?,?,?,?,?,?,?)')
      .run(syntheticSessionHash, owner, 5, 'c'.repeat(64), issuedAt, issuedAt + 86400000, issuedAt + 2592000000);
    db.sqlite.prepare('INSERT INTO sync_subjects (uid,status,consent_revision,fence_epoch) VALUES (?, ?, ?, ?)').run(owner, 'active', 1, 5);
    db.sqlite.prepare('INSERT INTO health_consent_acceptances (uid,consent_revision,privacy_version,terms_version,accepted_at_ms,over_18_confirmed) VALUES (?,1,?,?,?,1)')
      .run(owner, '1.3.9', '1.2.5', issuedAt);
    db.sqlite.prepare('INSERT INTO sync_state (uid, revision) VALUES (?, 0)').run(owner);
    fence.sqlite.prepare(`INSERT INTO recovery_owner_fences
      (uid,status,consent_revision,fence_epoch,erased_before_revision,change_seq)
      VALUES (?,'pending',0,5,0,1)`).run(owner);
    fence.sqlite.prepare(`UPDATE recovery_owner_fences
      SET status='active',consent_revision=1,change_seq=2 WHERE uid=?`).run(owner);
    const dataKey = await releaseCloudAccountDataKey(db, {
      CLOUD_ACCOUNT_KEK_V1: Buffer.alloc(32, 41).toString('base64'),
      CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
    }, {
      uid: owner, authenticated: true, emailVerified: true,
      healthConsentRevision: 1, fenceEpoch: 5, csrfVerified: true,
      rateGatePassed: true, sessionHash: syntheticSessionHash,
    });
    dataKey.fill(0);
    const now = Date.now();
    db.sqlite.prepare('INSERT INTO sync_replicas (uid, slot, replica_id, generation, lease_until_ms, checkpoint_at_ms, checkpoint_clock_json, last_seq, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      owner, replica.slot, replica.replicaId, 1, now + 86400000, now, '{}', 0, 'active');
    await run(db, second, fence);
  } finally {
    independentDatabases.delete(db);
    independentDatabases.delete(second);
    fence.close();
    second.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

export function envelope(seq = 1) {
  return {
    _schemaVersion: 1,
    _sync: {
      protocolVersion: 3, clock: { s00: seq }, fields: {},
      writer: { ...replica, seq, consentRevision: 1 },
    },
    _sealed: {
      format: 'thelogbook-cloud-document', version: 1,
      nonce: 'A'.repeat(32), ciphertext: 'B'.repeat(48),
    },
  };
}

export function attempt(batchId = 'batch000000000001', seq = 1, rev = 0, paths = ['']) {
  return {
    batchId, expectedRevision: rev, expectedFenceEpoch: 5, consentRevision: 1,
    replica, lastSeq: seq, documents: paths.map(path => ({ path, document: envelope(seq) })),
  };
}
export function makeEnv(db, claims = {}) {
  return {
    DB: db, RECOVERY_DB: independentDatabases.get(db), API_ORIGIN: origin,
    CONSENT_PRIVACY_VERSION: '1.3.9', CONSENT_TERMS_VERSION: '1.2.5',
    AUTH_GATE: {
      async fetch() {
        return new Response(JSON.stringify({
          uid: owner, authenticated: true, emailVerified: true,
          healthConsentRevision: 1, fenceEpoch: 5, csrfVerified: true, rateGatePassed: true,
          sessionHash: syntheticSessionHash, ...claims,
        }), { status: 200 });
      },
    },
  };
}
export async function call(db, route, body, config = {}) {
  const env = config.env ?? makeEnv(db);
  const headers = {
    'Origin': origin, 'Content-Type': 'application/json', 'Cookie': 'synthetic-session=opaque',
    'X-CSRF-Token': 'synthetic-csrf',
    ...(config.headers ?? {}),
  };
  const response = await worker.fetch(new Request(origin + '/v1/sync/' + route, {
    method: config.method ?? 'POST', headers, body: JSON.stringify(body),
  }), env);
  return { status: response.status, body: await response.json() };
}


export function claim(mutationId = 'mutation0000000001', revision = 0, candidateReplicaId = 'another-synthetic-device', clock = {}, currentReplica = null) {
  return {
    mutationId, expectedRevision: revision, expectedFenceEpoch: 5, consentRevision: 1,
    candidateReplicaId, currentReplica, checkpointClock: clock,
  };
}
export function retire(mutationId, revision, target = replica) {
  return { mutationId, expectedRevision: revision, expectedFenceEpoch: 5, consentRevision: 1, replica: target };
}
