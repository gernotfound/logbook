import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { recordKindeForegroundActivity } from '../../cloudflare/auth/kinde-foreground-activity.mjs';
import { isKindeInactivityCandidateCurrent, readKindeInactivityCandidates } from '../../cloudflare/jobs/kinde-inactivity-candidates.mjs';
import {
  ACTIVITY_WRITE_INTERVAL_MS, earliestKindeInactivityErasureAt,
} from '../../cloudflare/jobs/kinde-inactivity-time.mjs';
import { runKindeInactivityDryRunTick } from '../../cloudflare/jobs/kinde-inactivity-dry-run.mjs';
import erasureWorker from '../../cloudflare/jobs/health-erasure-worker.mjs';
import { applyCurrentD1RecoverySchema, applyCurrentD1Schema } from './current-d1-schema.mjs';

const VISIT = Date.parse('2026-11-24T16:38:00.000Z');
const UID = 'k_' + 'a'.repeat(43);
const OTHER_UID = 'k_' + 'b'.repeat(43);
const HASH = 'c'.repeat(64);
const IDLE_TTL = 2 * ACTIVITY_WRITE_INTERVAL_MS;
const claims = {
  uid: UID, fenceEpoch: 1, sessionHash: HASH, authenticated: true, rateGatePassed: true, csrfVerified: true,
};

function fixture(t, rejectAfterWrite = false, hooks = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const clock = new DatabaseSync(':memory:');
  t.after(() => { sqlite.close(); clock.close(); });
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyCurrentD1Schema(sqlite);
  const formatTime = clock.prepare('SELECT strftime(?, ?) AS value');
  let observedAt = VISIT;
  sqlite.function('strftime', (format, date) =>
    formatTime.get(format, date === 'now' ? new Date(observedAt).toISOString() : date).value);
  const addPrincipal = sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)");
  addPrincipal.run(UID, VISIT - 1000);
  addPrincipal.run(OTHER_UID, VISIT - 1000);
  sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)')
    .run(HASH, UID, 'd'.repeat(64), VISIT - 1000, VISIT + IDLE_TTL, VISIT + IDLE_TTL);
  const db = { withSession(mode) {
    assert.equal(mode, 'first-primary');
    return { prepare(sql) { return { bind(...args) { return {
      async first() {
        const row = sqlite.prepare(sql).get(...args) ?? null;
        if (rejectAfterWrite && sql.includes('INSERT INTO kinde_account_activity')) throw new Error('synthetic ACK lost');
        hooks.afterFirst?.(sql);
        return row;
      },
      async all() {
        const results = sqlite.prepare(sql).all(...args);
        hooks.afterAll?.(sql);
        return { success: true, results };
      },
      async run() {
        const { changes } = sqlite.prepare(sql).run(...args);
        hooks.afterRun?.(sql);
        return { success: true, meta: { changes } };
      },
    }; } }; } };
  } };
  return { sqlite, db, advance(ms) { observedAt += ms; } };
}

void test('only the currently authenticated foreground owner can record a server-clock observation', async (t) => {
  const { db, sqlite } = fixture(t);
  for (const invalid of [
    { ...claims, csrfVerified: false }, { ...claims, authenticated: false },
    { ...claims, rateGatePassed: false }, { ...claims, uid: OTHER_UID },
    { ...claims, sessionHash: 'e'.repeat(64) }, { ...claims, fenceEpoch: 2 },
  ]) assert.deepEqual(await recordKindeForegroundActivity(db, invalid), { outcome: 'unauthorized' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_activity').get().n, 0);
  assert.deepEqual(await recordKindeForegroundActivity(db, { ...claims, timestamp: VISIT + 10_000_000 }),
    { outcome: 'recorded' });
  assert.deepEqual({ ...sqlite.prepare('SELECT * FROM kinde_account_activity').get() },
    { uid: UID, first_observed_at_ms: VISIT, last_recorded_at_ms: VISIT });
});

void test('concurrent foreground visits conserve the marker and write again only at the trusted ten-minute boundary', async (t) => {
  const { db, sqlite, advance } = fixture(t);
  const simultaneous = await Promise.all([recordKindeForegroundActivity(db, claims), recordKindeForegroundActivity(db, claims)]);
  assert.deepEqual(simultaneous.map(result => result.outcome).sort(), ['observed', 'recorded']);
  const marker = sqlite.prepare('SELECT * FROM kinde_account_activity WHERE uid=?');
  advance(ACTIVITY_WRITE_INTERVAL_MS - 1);
  assert.deepEqual(await recordKindeForegroundActivity(db, claims), { outcome: 'observed' });
  assert.equal(marker.get(UID).last_recorded_at_ms, VISIT);
  advance(1);
  assert.deepEqual(await recordKindeForegroundActivity(db, claims), { outcome: 'recorded' });
  assert.equal(marker.get(UID).last_recorded_at_ms, VISIT + ACTIVITY_WRITE_INTERVAL_MS);
  assert.equal(marker.get(UID).first_observed_at_ms, VISIT);
  advance(ACTIVITY_WRITE_INTERVAL_MS);
  assert.deepEqual(await recordKindeForegroundActivity(db, claims), { outcome: 'unauthorized' });
  assert.equal(marker.get(UID).last_recorded_at_ms, VISIT + ACTIVITY_WRITE_INTERVAL_MS);
});

void test('a lost write reply is recoverable only while the authenticated observation is current', async (t) => {
  const { db, sqlite } = fixture(t, true);
  assert.deepEqual(await recordKindeForegroundActivity(db, claims), { outcome: 'observed' });
  sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?').run(VISIT, HASH);
  assert.deepEqual(await recordKindeForegroundActivity(db, claims), { outcome: 'unauthorized' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_activity').get().n, 1);
});

void test('twelve calendar months preserve throttled observations across UTC leap-day boundaries', () => {
  for (const [last, due] of [
    ['2026-11-24T16:38:00.000Z', '2027-11-24T16:48:00.000Z'],
    ['2027-02-28T23:55:00.000Z', '2028-03-01T00:05:00.000Z'],
    ['2028-02-28T23:55:00.000Z', '2029-02-28T23:59:59.999Z'],
    ['2028-02-29T23:55:00.000Z', '2029-03-01T00:05:00.000Z'],
    ['2028-02-29T12:00:00.000Z', '2029-02-28T12:10:00.000Z'],
  ]) assert.equal(earliestKindeInactivityErasureAt(Date.parse(last)), Date.parse(due));
  for (const missing of [null, NaN, 0, -1, 0.5, Number.MAX_SAFE_INTEGER]) {
    assert.equal(earliestKindeInactivityErasureAt(missing), null);
  }
});

void test('the dry run finds only observed owners at their exact due time and only when enabled', async (t) => {
  const { db, sqlite, advance } = fixture(t);
  await recordKindeForegroundActivity(db, claims);
  const dueAt = earliestKindeInactivityErasureAt(VISIT);
  advance(dueAt - VISIT - 1);
  assert.deepEqual((await readKindeInactivityCandidates(db)).candidates, []);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
  assert.deepEqual((await readKindeInactivityCandidates(db)).candidates, []);
  advance(1);
  const { candidates: valid, nextCursor } = await readKindeInactivityCandidates(db);
  assert.equal(nextCursor, null);
  assert.deepEqual(valid, [{
    uid: UID, authEpoch: 1, generation: 2, lastRecordedAtMs: VISIT, eligibleAtMs: dueAt,
  }]);
  assert.equal(await isKindeInactivityCandidateCurrent(db, valid[0]), true);
  assert.equal(await isKindeInactivityCandidateCurrent(db, { ...valid[0], eligibleAtMs: dueAt - 1 }), false);
  assert.throws(() => sqlite.exec("INSERT OR REPLACE INTO kinde_inactivity_control VALUES (1,'enabled',1)"),
    /kinde-inactivity-control-immutable/);
});

void test('a fresh online observation or a pause invalidates an already selected inactivity candidate', async (t) => {
  const { db, sqlite, advance } = fixture(t);
  await recordKindeForegroundActivity(db, claims);
  const dueAt = earliestKindeInactivityErasureAt(VISIT);
  advance(dueAt - VISIT);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
  const { candidates: [first] } = await readKindeInactivityCandidates(db);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='paused', generation=3");
  assert.equal(await isKindeInactivityCandidateCurrent(db, first), false);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=4");
  assert.equal(await isKindeInactivityCandidateCurrent(db, first), false);
  const { candidates: [second] } = await readKindeInactivityCandidates(db);
  const newHash = 'f'.repeat(64);
  sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)')
    .run(newHash, UID, 'd'.repeat(64), dueAt, dueAt + IDLE_TTL, dueAt + IDLE_TTL);
  assert.deepEqual(await recordKindeForegroundActivity(db, { ...claims, sessionHash: newHash }), { outcome: 'recorded' });
  assert.equal(await isKindeInactivityCandidateCurrent(db, second), false);
  assert.deepEqual((await readKindeInactivityCandidates(db)).candidates, []);
  assert.equal(sqlite.prepare('SELECT status FROM auth_principals WHERE uid=?').get(UID).status, 'active');
});

void test('a due page reads at most sixteen recorded owners without changing their activity state', async (t) => {
  const { db, sqlite, advance } = fixture(t);
  const principal = sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)");
  const session = sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)');
  const uids = [];
  for (let i = 0; i < 20; i += 1) {
    const suffix = i.toString(16);
    const uid = 'k_' + suffix.padStart(43, '0');
    const sessionHash = suffix.padStart(64, '0');
    principal.run(uid, VISIT - 1000);
    session.run(sessionHash, uid, 'd'.repeat(64), VISIT - 1000, VISIT + IDLE_TTL, VISIT + IDLE_TTL);
    assert.deepEqual(await recordKindeForegroundActivity(db, { ...claims, uid, sessionHash }), { outcome: 'recorded' });
    uids.push(uid);
  }
  advance(earliestKindeInactivityErasureAt(VISIT) - VISIT);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
  const page = await readKindeInactivityCandidates(db);
  assert.deepEqual(page.candidates.map(item => item.uid), uids.slice(0, 16));
  assert.deepEqual(page.nextCursor, { lastRecordedAtMs: VISIT, uid: uids[15] });
  const tail = await readKindeInactivityCandidates(db, page.nextCursor);
  assert.deepEqual(tail.candidates.map(item => item.uid), uids.slice(16));
  assert.equal(tail.nextCursor, null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_activity').get().n, 20);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auth_principals WHERE status != 'active'").get().n, 0);
});

void test('an empty eligible page still advances past a leap-day anniversary inversion', async (t) => {
  const { db, sqlite, advance } = fixture(t);
  const older = Date.parse('2028-02-28T23:55:00.000Z');
  const newer = Date.parse('2028-02-29T00:00:00.000Z');
  const now = Date.parse('2029-02-28T12:00:00.000Z');
  advance(older - VISIT);
  const principal = sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)");
  const session = sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)');
  const uids = [];
  for (let i = 0; i < 16; i += 1) {
    const uid = 'k_' + i.toString(16).padStart(43, '0');
    const sessionHash = i.toString(16).padStart(64, '0');
    principal.run(uid, older - 1000);
    session.run(sessionHash, uid, 'd'.repeat(64), older - 1000, older + IDLE_TTL, older + IDLE_TTL);
    assert.deepEqual(await recordKindeForegroundActivity(db, { ...claims, uid, sessionHash }), { outcome: 'recorded' });
    uids.push(uid);
  }
  advance(newer - older);
  const sessionHash = 'e'.repeat(64);
  session.run(sessionHash, OTHER_UID, 'd'.repeat(64), newer - 1000, newer + IDLE_TTL, newer + IDLE_TTL);
  assert.deepEqual(await recordKindeForegroundActivity(db, { ...claims, uid: OTHER_UID, sessionHash }), { outcome: 'recorded' });
  advance(now - newer);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");

  const first = await readKindeInactivityCandidates(db);
  assert.deepEqual(first.candidates, []);
  assert.deepEqual(first.nextCursor, { lastRecordedAtMs: older, uid: uids[15] });
  const second = await readKindeInactivityCandidates(db, first.nextCursor);
  assert.deepEqual(second, {
    candidates: [{ uid: OTHER_UID, authEpoch: 1, generation: 2, lastRecordedAtMs: newer,
      eligibleAtMs: Date.parse('2029-02-28T00:10:00.000Z') }],
    nextCursor: null,
  });
  assert.equal(await isKindeInactivityCandidateCurrent(db, second.candidates[0]), true);
  await assert.rejects(readKindeInactivityCandidates(db, { lastRecordedAtMs: 0, uid: OTHER_UID }),
    /invalid-kinde-inactivity-cursor/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auth_principals WHERE status != 'active'").get().n, 0);
});

void test('raw activity pages stay bounded when disabled principals precede an active candidate', async (t) => {
  const { db, sqlite, advance } = fixture(t);
  const principal = sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)");
  const session = sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)');
  const disable = sqlite.prepare("UPDATE auth_principals SET status='disabled' WHERE uid=?");
  const disabled = [];
  for (let i = 0; i < 20; i += 1) {
    const uid = 'k_' + i.toString(16).padStart(43, '0');
    const sessionHash = i.toString(16).padStart(64, '0');
    principal.run(uid, VISIT - 1000);
    session.run(sessionHash, uid, 'd'.repeat(64), VISIT - 1000, VISIT + IDLE_TTL, VISIT + IDLE_TTL);
    assert.deepEqual(await recordKindeForegroundActivity(db, { ...claims, uid, sessionHash }), { outcome: 'recorded' });
    disable.run(uid);
    disabled.push(uid);
  }
  assert.deepEqual(await recordKindeForegroundActivity(db, claims), { outcome: 'recorded' });
  const dueAt = earliestKindeInactivityErasureAt(VISIT);
  advance(dueAt - VISIT);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
  const first = await readKindeInactivityCandidates(db);
  assert.deepEqual(first, { candidates: [], nextCursor: { lastRecordedAtMs: VISIT, uid: disabled[15] } });
  assert.deepEqual(await readKindeInactivityCandidates(db, first.nextCursor), {
    candidates: [{ uid: UID, authEpoch: 1, generation: 2, lastRecordedAtMs: VISIT, eligibleAtMs: dueAt }],
    nextCursor: null,
  });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auth_principals WHERE status='disabled'").get().n, 20);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_activity').get().n, 21);
});

void test('persistent dry run checkpoints empty pages, retries ambiguous writes and resets on both generations', async (t) => {
  const hooks = {};
  const { db, sqlite, advance } = fixture(t, false, hooks);
  const registry = new DatabaseSync(':memory:');
  t.after(() => registry.close());
  applyCurrentD1RecoverySchema(registry);
  registry.exec("UPDATE recovery_control SET mode='open', generation=2");
  const recovery = { withSession(mode) {
    assert.equal(mode, 'first-primary');
    return { prepare(sql) { return { async first() { return registry.prepare(sql).get() ?? null; } }; } };
  } };
  const tick = (pin = 2) => runKindeInactivityDryRunTick(db, recovery, pin);
  const checkpoint = () => ({ ...sqlite.prepare('SELECT * FROM kinde_inactivity_scan_checkpoint').get() });
  const principal = sqlite.prepare("INSERT INTO auth_principals VALUES (?, 'active', ?, 1)");
  const session = sqlite.prepare('INSERT INTO auth_sessions VALUES (?, ?, 1, ?, ?, ?, ?, NULL)');
  const disabled = [];
  for (let i = 0; i < 16; i += 1) {
    const uid = 'k_' + i.toString(16).padStart(43, '0');
    const sessionHash = i.toString(16).padStart(64, '0');
    principal.run(uid, VISIT - 1000);
    session.run(sessionHash, uid, 'd'.repeat(64), VISIT - 1000, VISIT + IDLE_TTL, VISIT + IDLE_TTL);
    assert.deepEqual(await recordKindeForegroundActivity(db, { ...claims, uid, sessionHash }), { outcome: 'recorded' });
    sqlite.prepare("UPDATE auth_principals SET status='disabled' WHERE uid=?").run(uid);
    disabled.push(uid);
  }
  await recordKindeForegroundActivity(db, claims);
  advance(earliestKindeInactivityErasureAt(VISIT) - VISIT);
  const initial = checkpoint();
  assert.equal((await tick()).outcome, 'not-claimed');
  assert.deepEqual(checkpoint(), initial);
  await assert.rejects(tick(null), /kinde-inactivity-scanner-unavailable/);
  await assert.rejects(runKindeInactivityDryRunTick(db, db, 2), /kinde-inactivity-scanner-unavailable/);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
  hooks.afterFirst = sql => {
    if (sql.includes('RETURNING policy_generation')) throw Error('synthetic claim reply lost');
  };
  await assert.rejects(tick(), /synthetic claim reply lost/);
  delete hooks.afterFirst;
  assert.equal(checkpoint().cursor_uid, null);
  assert.equal((await tick()).outcome, 'not-claimed');
  advance(60001);
  const pair = await Promise.all([tick(), tick()]);
  assert.deepEqual(pair.map(result => result.outcome).sort(), ['checkpointed', 'not-claimed']);
  assert.deepEqual(pair.find(result => result.outcome === 'checkpointed'),
    { outcome: 'checkpointed', candidateCount: 0, endOfSweep: false });
  assert.equal(checkpoint().cursor_uid, disabled[15]);
  hooks.afterRun = sql => {
    if (sql.includes('SET cursor_uid')) throw Error('synthetic checkpoint reply lost');
  };
  assert.deepEqual(await tick(), { outcome: 'checkpointed', candidateCount: 1, endOfSweep: true });
  delete hooks.afterRun;
  assert.equal(checkpoint().cursor_uid, null);

  hooks.afterAll = () => sqlite.exec("UPDATE kinde_inactivity_control SET mode='paused', generation=3");
  assert.equal((await tick()).outcome, 'contended');
  delete hooks.afterAll;
  assert.equal(checkpoint().cursor_uid, null);
  assert.equal((await tick()).outcome, 'not-claimed');
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=4");
  advance(60001);
  assert.deepEqual(await tick(), { outcome: 'checkpointed', candidateCount: 0, endOfSweep: false });
  assert.equal(checkpoint().policy_generation, 4);
  assert.equal(checkpoint().cursor_uid, disabled[15]);

  registry.exec("UPDATE recovery_control SET mode='sealed', generation=3");
  registry.exec("UPDATE recovery_control SET mode='open', generation=4");
  const before = checkpoint();
  await assert.rejects(tick(), /independent-recovery-fence-unavailable/);
  assert.deepEqual(checkpoint(), before);
  assert.deepEqual(await tick(4), { outcome: 'checkpointed', candidateCount: 0, endOfSweep: false });
  assert.equal(checkpoint().recovery_generation, 4);
  assert.equal(checkpoint().cursor_uid, disabled[15]);
  assert.throws(() => sqlite.exec("DELETE FROM kinde_inactivity_scan_checkpoint"), /checkpoint-immutable/);
  assert.throws(() => sqlite.exec("UPDATE kinde_inactivity_scan_checkpoint SET lease_epoch=0"), /checkpoint-fenced/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_activity').get().n, 17);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auth_principals WHERE status='disabled'").get().n, 16);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_intents').get().n, 0);
  assert.equal(registry.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n, 0);
});

void test('scheduled diagnostic mode requires an external recovery pin and never enters the erasure lanes', async (t) => {
  const { db, sqlite, advance } = fixture(t);
  const registry = new DatabaseSync(':memory:');
  t.after(() => registry.close());
  applyCurrentD1RecoverySchema(registry);
  registry.exec("UPDATE recovery_control SET mode='open', generation=2");
  const recovery = { withSession(mode) {
    assert.equal(mode, 'first-primary');
    return { prepare(sql) { return { async first() { return registry.prepare(sql).get() ?? null; } }; } };
  } };
  const env = { CF06_ERASURE_RUN_ENABLED: 'enabled', CF06_ERASURE_RUN_MODE: 'inactivity-dry-run',
    CF06_INACTIVITY_RECOVERY_GENERATION: '2', DB: db, RECOVERY_DB: recovery };
  const checkpoint = () => ({ ...sqlite.prepare('SELECT * FROM kinde_inactivity_scan_checkpoint').get() });
  await recordKindeForegroundActivity(db, claims);
  advance(earliestKindeInactivityErasureAt(VISIT) - VISIT);
  const initial = checkpoint();
  assert.deepEqual(await erasureWorker.scheduled({}, env), { outcome: 'not-claimed' });
  assert.deepEqual(checkpoint(), initial);
  sqlite.exec("UPDATE kinde_inactivity_control SET mode='enabled', generation=2");
  await assert.rejects(erasureWorker.scheduled({}, { ...env, CF06_INACTIVITY_RECOVERY_GENERATION: '1' }),
    /independent-recovery-fence-unavailable/);
  assert.deepEqual(checkpoint(), initial);
  assert.deepEqual(await erasureWorker.scheduled({}, env),
    { outcome: 'checkpointed', candidateCount: 1, endOfSweep: true });
  assert.equal(checkpoint().lease_epoch, 1);
  assert.equal(checkpoint().recovery_generation, 2);
  assert.equal(sqlite.prepare('SELECT turn FROM erasure_dispatch_control').get().turn, 0);
  assert.equal(sqlite.prepare('SELECT lease_epoch FROM kinde_account_erasure_scheduler').get().lease_epoch, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_erasure_intents').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM health_erasure_jobs').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM kinde_account_activity').get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auth_principals WHERE status='active'").get().n, 2);
  assert.equal(registry.prepare('SELECT COUNT(*) AS n FROM recovery_account_erasure_denials').get().n, 0);
});
