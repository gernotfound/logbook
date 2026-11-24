import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { recordKindeForegroundActivity } from '../../cloudflare/auth/kinde-foreground-activity.mjs';
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
    return { prepare(sql) { return { bind(...args) { return { async first() {
      const row = sqlite.prepare(sql).get(...args) ?? null;
      if (rejectAfterWrite && sql.includes('INSERT INTO kinde_account_activity')) throw new Error('synthetic ACK lost');
      return row;
    } }; } }; } };
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
