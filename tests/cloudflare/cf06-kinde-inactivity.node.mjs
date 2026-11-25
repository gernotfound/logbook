import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { recordKindeForegroundActivity } from '../../cloudflare/auth/kinde-foreground-activity.mjs';
import { isKindeInactivityCandidateCurrent, readKindeInactivityCandidates } from '../../cloudflare/jobs/kinde-inactivity-candidates.mjs';
import {
  ACTIVITY_WRITE_INTERVAL_MS, earliestKindeInactivityErasureAt,
} from '../../cloudflare/jobs/kinde-inactivity-time.mjs';
import { applyCurrentD1Schema } from './current-d1-schema.mjs';

const VISIT = Date.parse('2026-11-24T16:38:00.000Z');
const UID = 'k_' + 'a'.repeat(43);
const OTHER_UID = 'k_' + 'b'.repeat(43);
const HASH = 'c'.repeat(64);
const IDLE_TTL = 2 * ACTIVITY_WRITE_INTERVAL_MS;
const claims = {
  uid: UID, fenceEpoch: 1, sessionHash: HASH, authenticated: true, rateGatePassed: true, csrfVerified: true,
};

function fixture(t, rejectAfterWrite = false) {
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
        return row;
      },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...args) }; },
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
