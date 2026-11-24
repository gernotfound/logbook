import { D1_NOW_MS } from '../sql/d1-time.mjs';
import { earliestKindeInactivityErasureAt } from './kinde-inactivity-time.mjs';

const UID = /^k_[A-Za-z0-9_-]{43}$/;
const MAX_PAGE = 16;
const DAYS_365_MS = 365 * 24 * 60 * 60 * 1000;
const ELIGIBLE_SOURCE = `
  FROM kinde_account_activity a JOIN auth_principals p ON p.uid = a.uid
  CROSS JOIN kinde_inactivity_control control
  WHERE p.status = 'active' AND control.singleton = 1 AND control.mode = 'enabled'
`;

/**
 * Bounded dry-run candidates from recorded foreground activity. Each row
 * includes the account and pause generations to revalidate in the enqueue
 * transaction. Advance by the last scanned row, not the last eligible row:
 * UTC anniversaries around leap day need not preserve marker order.
 * Reading this page never queues or disables an account.
 * @param {{withSession: (policy: 'first-primary') => any}} db
 * @param {{lastRecordedAtMs: number, uid: string} | null} [after]
 */
export async function readKindeInactivityCandidates(db, after = null) {
  if (after !== null && (!Number.isSafeInteger(after.lastRecordedAtMs)
    || after.lastRecordedAtMs <= 0 || typeof after.uid !== 'string' || !UID.test(after.uid))) {
    throw new TypeError('invalid-kinde-inactivity-cursor');
  }
  const cursorPredicate = after === null ? '' : 'AND (a.last_recorded_at_ms, a.uid) > (?, ?)';
  const cursorBindings = after === null ? [] : [after.lastRecordedAtMs, after.uid];
  const page = await db.withSession('first-primary').prepare(`
    SELECT a.uid, p.auth_epoch, a.last_recorded_at_ms, control.generation, ${D1_NOW_MS} AS observed_at_ms
    ${ELIGIBLE_SOURCE} AND a.last_recorded_at_ms <= ${D1_NOW_MS} - ?
    ${cursorPredicate}
    ORDER BY a.last_recorded_at_ms, a.uid LIMIT ${MAX_PAGE}
  `).bind(DAYS_365_MS, ...cursorBindings).all();
  if (page?.success !== true || !Array.isArray(page.results) || page.results.length > MAX_PAGE) {
    throw new Error('kinde-inactivity-candidates-unavailable');
  }
  const candidates = [];
  for (const row of page.results) {
    const eligibleAtMs = earliestKindeInactivityErasureAt(row.last_recorded_at_ms);
    if (!Number.isSafeInteger(row.observed_at_ms) || row.observed_at_ms <= 0
      || !Number.isSafeInteger(row.auth_epoch) || row.auth_epoch < 1
      || !Number.isSafeInteger(row.generation) || row.generation < 1
      || !Number.isSafeInteger(row.last_recorded_at_ms) || row.last_recorded_at_ms <= 0
      || typeof row.uid !== 'string' || !UID.test(row.uid)) {
      throw new Error('kinde-inactivity-candidates-unavailable');
    }
    if (eligibleAtMs !== null && eligibleAtMs <= row.observed_at_ms) {
      candidates.push({ uid: row.uid, authEpoch: row.auth_epoch, generation: row.generation,
        lastRecordedAtMs: row.last_recorded_at_ms, eligibleAtMs });
    }
  }
  const last = page.results.at(-1);
  const nextCursor = page.results.length === MAX_PAGE
    ? { lastRecordedAtMs: last.last_recorded_at_ms, uid: last.uid }
    : null;
  return { candidates, nextCursor };
}

/**
 * A dry-run read to validate a selection. The future erasure write must
 * repeat these predicates in its own SQL statement before accepting intent.
 * @param {Parameters<typeof readKindeInactivityCandidates>[0]} db
 * @param {Awaited<ReturnType<typeof readKindeInactivityCandidates>>['candidates'][number]} candidate
 */
export async function isKindeInactivityCandidateCurrent(db, candidate) {
  const { uid, authEpoch, generation, lastRecordedAtMs, eligibleAtMs } = candidate;
  if (earliestKindeInactivityErasureAt(lastRecordedAtMs) !== eligibleAtMs || eligibleAtMs === null) return false;
  const row = await db.withSession('first-primary').prepare(`
    SELECT a.uid ${ELIGIBLE_SOURCE}
      AND a.uid = ? AND p.auth_epoch = ? AND control.generation = ?
      AND a.last_recorded_at_ms = ? AND ? <= ${D1_NOW_MS}
  `).bind(uid, authEpoch, generation, lastRecordedAtMs, eligibleAtMs).first();
  return row?.uid === uid;
}
