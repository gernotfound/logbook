import { inspectRestoredOwnerCoverage } from './restore-preflight.mjs';
import { digestForIntent } from './account-erasure-denials.mjs';
import { QUALIFIED_INTENT_COLUMNS, intentFromRow } from '../jobs/kinde-erasure-intent.mjs';

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
// The account census is independent of consent: a denied identity may never
// have created a sync_subjects row. Read only proof metadata, not credentials.
const ACCOUNT_SQL = `SELECT ${QUALIFIED_INTENT_COLUMNS}, p.status AS principal_status,
  p.auth_epoch AS principal_epoch, r.uid AS request_uid, r.prior_auth_epoch,
  r.receipt_hash AS request_hash, r.reauthenticated_at_ms AS request_auth_ms,
  r.requested_at_ms, c.uid AS completion_uid, c.completed_at_ms,
  EXISTS (SELECT 1 FROM kinde_erasure_targets t WHERE t.uid = i.uid) AS target_present
  FROM kinde_account_erasure_intents i
  LEFT JOIN auth_principals p ON p.uid = i.uid
  LEFT JOIN kinde_account_erasure_requests r ON r.uid = i.uid
  LEFT JOIN kinde_account_erasure_completions c ON c.uid = i.uid
  ORDER BY i.uid LIMIT ?`;
const DENIAL_SQL = `SELECT d.uid, d.intent_digest FROM recovery_account_erasure_denials d
  ORDER BY d.uid LIMIT ?`;
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
      ...(independent ? { changeSeq: row.change_seq } : {}),
    };
  });
}
async function readBoundedRows(conn, sql) {
  const response = await conn.prepare(sql).bind(MAX_OWNERS + 1).all();
  requireEvidence(response?.success === true && Array.isArray(response.results),
    'scan-unavailable');
  requireEvidence(response.results.length <= MAX_OWNERS, 'coverage-limit-exceeded');
  return response.results;
}
async function readRows(conn, sql, independent) {
  return normalizedRows(await readBoundedRows(conn, sql), independent);
}
async function readAccountSnapshot(restored, independent) {
  return {
    intents: await readBoundedRows(restored, ACCOUNT_SQL),
    denials: await readBoundedRows(independent, DENIAL_SQL),
  };
}

async function inspectAccountCoverage({ intents, denials }) {
  // A local decision awaiting independent denial or acceptance is not safe
  // to discard on restore. Reconcile it separately; never synthesize proof.
  requireEvidence(intents.every(row => row && row.request_uid !== null), 'account-erasure-intent-pending');
  requireEvidence(intents.length === denials.length, 'account-erasure-coverage-mismatch');
  let previous = '';
  for (let index = 0; index < intents.length; index += 1) {
    const row = intents[index];
    const deny = denials[index];
    requireEvidence(typeof row.uid === 'string' && /^k_[A-Za-z0-9_-]{43}$/.test(row.uid)
      && row.uid > previous && deny?.uid === row.uid, 'account-erasure-coverage-mismatch');
    previous = row.uid;
    const intent = intentFromRow(row);
    requireEvidence(intent, 'account-erasure-intent-invalid');
    const digest = await digestForIntent(intent);
    requireEvidence(deny.intent_digest === digest, 'account-erasure-denial-mismatch');
    requireEvidence(row.request_uid === row.uid
      && row.request_hash === row.receipt_hash && row.request_auth_ms === row.reauthenticated_at_ms
      && row.requested_at_ms === row.confirmed_at_ms
      && Number.isSafeInteger(row.prior_auth_epoch) && row.prior_auth_epoch >= row.auth_epoch
      && Number.isSafeInteger(row.principal_epoch) && row.principal_epoch === row.prior_auth_epoch + 1,
      'account-erasure-request-inconsistent');
    if (row.completion_uid === null) {
      requireEvidence(row.principal_status === 'disabled' && row.target_present === 1
        && row.completed_at_ms === null, 'account-erasure-request-inconsistent');
    } else {
      requireEvidence(row.completion_uid === row.uid && row.principal_status === 'deleted'
        && row.target_present === 0 && Number.isSafeInteger(row.completed_at_ms)
        && row.completed_at_ms >= row.confirmed_at_ms, 'account-erasure-completion-inconsistent');
    }
  }
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
    const firstAccounts = await readAccountSnapshot(restored, independent);
    requireEvidence(firstRestored.length === before.restoredCount
      && firstIndependent.length === before.independentCount, 'owner-coverage-mismatch');

    // A second full read detects ordinary concurrent insert/update/delete,
    // while the final control generation check detects seal/unseal changes.
    // It is not an atomic barrier across databases or even across D1 queries.
    const secondRestored = await readRows(restored, RESTORED_SQL, false);
    const secondIndependent = await readRows(independent, INDEPENDENT_SQL, true);
    const secondAccounts = await readAccountSnapshot(restored, independent);
    const after = await metadata(restored, independent);
    requireEvidence(before.generation === after.generation
      && before.restoredCount === after.restoredCount
      && before.independentCount === after.independentCount
      && JSON.stringify(firstRestored) === JSON.stringify(secondRestored)
      && JSON.stringify(firstIndependent) === JSON.stringify(secondIndependent)
      && JSON.stringify(firstAccounts) === JSON.stringify(secondAccounts),
    'coverage-changed-during-scan');

    await inspectAccountCoverage(secondAccounts);
    return inspectRestoredOwnerCoverage(secondRestored, secondIndependent);
  } catch (error) {
    return blocked(error instanceof CensusFailure ? error.reason : 'scan-unavailable');
  }
}
