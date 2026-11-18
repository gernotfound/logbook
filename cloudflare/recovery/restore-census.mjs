import { inspectRestoredOwnerCoverage } from './restore-preflight.mjs';

// Operator-only diagnostic. Never mount this as an HTTP authorization endpoint.
// Bound the full-table reads so a large or ambiguous source fails closed instead
// of exhausting D1 Free quotas or reporting an incomplete scan as successful.
const MAX_OWNERS = 512;
const COUNTS = Object.freeze({
  restored: 'SELECT COUNT(*) AS total FROM sync_subjects',
  independent: 'SELECT COUNT(*) AS total FROM recovery_owner_fences',
});
const RESTORED_SQL = `SELECT uid, status, consent_revision, fence_epoch,
  erased_before_revision FROM sync_subjects ORDER BY uid LIMIT ?`;
const INDEPENDENT_SQL = `SELECT uid, status, consent_revision, fence_epoch,
  erased_before_revision, change_seq FROM recovery_owner_fences
  ORDER BY uid LIMIT ?`;
const CONTROL_SQL = `SELECT singleton, mode, generation
  FROM recovery_control WHERE singleton = 1`;

class CensusFailure extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const blocked = reason => ({ outcome: 'blocked', reason });
function requireEvidence(value, reason) {
  if (!value) throw new CensusFailure(reason);
}

function firstPrimary(db) {
  requireEvidence(db && typeof db.withSession === 'function', 'scan-unavailable');
  const conn = db.withSession('first-primary');
  requireEvidence(conn && typeof conn.prepare === 'function', 'scan-unavailable');
  return conn;
}
function count(row) {
  requireEvidence(row && Number.isSafeInteger(row.total) && row.total >= 0,
    'scan-invalid-count');
  return row.total;
}
async function metadata(restored, independent) {
  const control = await independent.prepare(CONTROL_SQL).first();
  requireEvidence(control && control.singleton === 1 && control.mode === 'sealed'
    && Number.isSafeInteger(control.generation) && control.generation >= 1,
  'independent-authority-not-sealed');
  const cutoff = await independent.prepare(
    'SELECT uid FROM recovery_erasure_cutoffs WHERE finalized = 0 LIMIT 1',
  ).first();
  requireEvidence(cutoff === null, 'terminal-erasure-cutoff-pending');
  const restoredCount = count(await restored.prepare(COUNTS.restored).first());
  const independentCount = count(await independent.prepare(COUNTS.independent).first());
  requireEvidence(restoredCount > 0 && independentCount > 0,
    'independent-coverage-empty');
  requireEvidence(restoredCount === independentCount, 'owner-coverage-mismatch');
  requireEvidence(restoredCount <= MAX_OWNERS, 'coverage-limit-exceeded');
  return { generation: control.generation, restoredCount, independentCount };
}
function normalizedRows(rows, independent) {
  requireEvidence(Array.isArray(rows), 'scan-unavailable');
  let previous = '';
  return rows.map(row => {
    requireEvidence(row && typeof row.uid === 'string'
      && row.uid.length > 0 && row.uid.length <= 128
      && row.uid.trim() === row.uid && !row.uid.includes('/')
      && row.uid > previous, 'scan-owner-order-or-format-invalid');
    previous = row.uid;
    if (independent) {
      requireEvidence(Number.isSafeInteger(row.change_seq) && row.change_seq >= 1,
        'independent-row-sequence-invalid');
    }
    return {
      uid: row.uid, status: row.status,
      consentRevision: row.consent_revision, fenceEpoch: row.fence_epoch,
      erasedBeforeRevision: row.erased_before_revision,
    };
  });
}
async function readRows(conn, sql, independent) {
  const response = await conn.prepare(sql).bind(MAX_OWNERS + 1).all();
  requireEvidence(response?.success === true && Array.isArray(response.results),
    'scan-unavailable');
  requireEvidence(response.results.length <= MAX_OWNERS, 'coverage-limit-exceeded');
  return normalizedRows(response.results, independent);
}

/**
 * Inspect ALL rows in the two independently supplied D1 bindings, not
 * caller-assembled owner lists. A sealed external registry and two equal
 * snapshots reduce accidental omissions, but they DO NOT prove a distributed
 * snapshot, trusted IAM, the original DB identity or historical completeness.
 * In particular, a write/restore between checks can still evade this read.
 * The only non-blocked result is "consistent-for-diagnostics-only".
 */
export async function inspectRestoredD1Census(restoredDb, independentDb) {
  try {
    requireEvidence(restoredDb && independentDb && restoredDb !== independentDb,
      'independent-database-required');
    const restored = firstPrimary(restoredDb);
    const independent = firstPrimary(independentDb);
    const before = await metadata(restored, independent);
    const firstRestored = await readRows(restored, RESTORED_SQL, false);
    const firstIndependent = await readRows(independent, INDEPENDENT_SQL, true);
    requireEvidence(firstRestored.length === before.restoredCount
      && firstIndependent.length === before.independentCount, 'owner-coverage-mismatch');

    // A second full read detects ordinary concurrent insert/update/delete,
    // while the final control generation check detects seal/unseal changes.
    // It is not an atomic barrier across databases or even across D1 queries.
    const secondRestored = await readRows(restored, RESTORED_SQL, false);
    const secondIndependent = await readRows(independent, INDEPENDENT_SQL, true);
    const after = await metadata(restored, independent);
    requireEvidence(before.generation === after.generation
      && before.restoredCount === after.restoredCount
      && before.independentCount === after.independentCount
      && JSON.stringify(firstRestored) === JSON.stringify(secondRestored)
      && JSON.stringify(firstIndependent) === JSON.stringify(secondIndependent),
    'coverage-changed-during-scan');

    return inspectRestoredOwnerCoverage(secondRestored, secondIndependent);
  } catch (error) {
    return blocked(error instanceof CensusFailure ? error.reason : 'scan-unavailable');
  }
}
