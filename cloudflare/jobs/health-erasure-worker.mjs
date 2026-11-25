import { D1_NOW_MS } from '../sql/d1-time.mjs';
import {
  IndependentFenceUnavailableError, recordVerifiedTerminalErasure, requireIndependentOwnerFence,
} from '../recovery/independent-owner-fence.mjs';
import {
  armIndependentErasureCutoff, reconcileNextIndependentErasure,
} from '../recovery/terminal-erasure-cutoff.mjs';

import { HEALTH_DATA_CLEANUP_TABLES } from './erasure-tables.mjs';
import { runKindeAccountErasureSweepTick } from './kinde-account-erasure-scheduler.mjs';

// Candidate-only D1 erasure worker. No public fetch, route or cron binding.
// Terminal key erasure requires migration 0010: a single SQL INSERT atomically
// destroys the wrapped ADK and records the complete, generation-fenced proof.
const MAX_ROWS_PER_STEP = 4;
const LEASE_MS = 30_000;
const SERVER_NOW = D1_NOW_MS;

function newLeaseToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  bytes.fill(0);
  return token;
}

function deletedRowCount(result) {
  const count = result?.meta?.changes;
  if (result?.success !== true || !Number.isSafeInteger(count)
    || count < 0 || count > MAX_ROWS_PER_STEP) throw new Error('erasure-write-unproven');
  return count;
}

function deleteBoundedSql(table) {
  // The table and key are selected only from the static internal allowlist,
  // never from request, owner or database content.
  return [
    'DELETE FROM ' + table.name,
    'WHERE uid = ? AND ' + table.key + ' IN (',
    '  SELECT ' + table.key + ' FROM ' + table.name,
    '  WHERE uid = ? ORDER BY ' + table.key + ' LIMIT ' + MAX_ROWS_PER_STEP,
    ') AND EXISTS (',
    '  SELECT 1 FROM health_erasure_jobs j',
    '  JOIN sync_subjects s ON s.uid = j.uid',
    "  WHERE j.uid = ? AND j.consent_revision = ? AND j.fence_epoch = ?",
    "    AND j.status = 'processing' AND j.phase = 'data'",
    '    AND j.lease_epoch = ? AND j.lease_token = ?',
    '    AND j.lease_until_ms > ' + SERVER_NOW,
    "    AND s.status = 'withdrawn'",
    '    AND s.consent_revision = j.consent_revision',
    '    AND s.fence_epoch = j.fence_epoch',
    ')',
  ].join('\n');
}

// Start with the runnable-job index (migration 0006), not all sync subjects.
// Both phase values are exhaustive by the schema; the explicit IN predicate
// gives SQLite the phase/status/lease index range even for the all-phase scan.
const FIND_JOB = [
  'SELECT j.uid, j.consent_revision, j.fence_epoch, j.phase',
  'FROM health_erasure_jobs j',
  'CROSS JOIN sync_subjects s ON s.uid = j.uid',
  "WHERE j.phase IN ('data', 'awaiting-keys') AND (? IS NULL OR j.phase = ?)",
  "  AND j.status IN ('pending', 'processing')",
  '  AND j.lease_until_ms <= ' + SERVER_NOW,
  "  AND s.status = 'withdrawn'",
  '  AND s.consent_revision = j.consent_revision AND s.fence_epoch = j.fence_epoch',
  'ORDER BY MAX(j.requested_at_ms, j.lease_until_ms), j.requested_at_ms, j.uid LIMIT 1',
].join('\n');

const CLAIM_JOB = [
  'UPDATE health_erasure_jobs SET',
  "  status = 'processing', lease_epoch = lease_epoch + 1,",
  '  lease_token = ?, lease_until_ms = ' + SERVER_NOW + ' + ' + LEASE_MS,
  'WHERE uid = ? AND consent_revision = ? AND fence_epoch = ?',
  "  AND phase = ? AND status IN ('pending', 'processing')",
  '  AND lease_until_ms <= ' + SERVER_NOW,
  '  AND EXISTS (SELECT 1 FROM sync_subjects s',
  "    WHERE s.uid = health_erasure_jobs.uid AND s.status = 'withdrawn'",
  '      AND s.consent_revision = health_erasure_jobs.consent_revision',
  '      AND s.fence_epoch = health_erasure_jobs.fence_epoch)',
  'RETURNING lease_epoch, lease_until_ms',
].join('\n');

// Migration 0010 requires its original timestamp expression for the receipt.
// The lease uses the integer clock again here because it can expire after
// the independent cutoff is armed and the legacy clock can round down by 1 ms.
// The INSERT itself owns ALL effects via SQLite triggers, not a D1 batch.
const FINALIZE = `
INSERT INTO health_erasure_finalizations (
  uid, consent_revision, fence_epoch, lease_epoch, lease_token,
  completed_at_ms, erased_before_revision, sync_revision_at_erasure,
  key_disposition, key_issued_at_ms
)
SELECT j.uid, j.consent_revision, j.fence_epoch, j.lease_epoch, j.lease_token,
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
  j.consent_revision + 1, rev.revision,
  CASE WHEN issuance.uid IS NULL THEN 'never-issued' ELSE 'destroyed' END,
  issuance.issued_at_ms
FROM health_erasure_jobs j
JOIN sync_state rev ON rev.uid = j.uid
LEFT JOIN cloud_key_issuance issuance
  ON issuance.uid = j.uid AND issuance.consent_revision = j.consent_revision
WHERE j.uid = ? AND j.consent_revision = ? AND j.fence_epoch = ?
  AND j.lease_epoch = ? AND j.lease_token = ?
  AND j.lease_until_ms > ${SERVER_NOW}
  AND j.status = 'processing' AND j.phase = 'awaiting-keys'
RETURNING uid, consent_revision, fence_epoch, lease_epoch, completed_at_ms,
  erased_before_revision, sync_revision_at_erasure, key_disposition
`;

// This is an independent first-primary read, not a claim about the INSERT's
// network acknowledgement. Verify the immutable proof AND all current owner
// facts before reporting a result, including when a prior response was lost.
const COMPLETE_PROOF = `
SELECT f.uid, f.consent_revision, f.fence_epoch, f.lease_epoch,
  f.completed_at_ms, f.erased_before_revision, f.sync_revision_at_erasure,
  f.key_disposition, f.key_issued_at_ms,
  j.status AS job_status, j.phase AS job_phase,
  j.lease_epoch AS job_lease_epoch, j.lease_token AS job_lease_token,
  j.completed_at_ms AS job_completed_at_ms,
  j.erased_before_revision AS job_erased_before_revision,
  j.key_disposition AS job_key_disposition,
  s.status AS subject_status,
  s.consent_revision AS subject_consent_revision,
  s.fence_epoch AS subject_fence_epoch,
  s.erased_before_revision AS subject_erased_before_revision,
  rev.revision AS current_sync_revision
FROM health_erasure_finalizations f
JOIN health_erasure_jobs j
  ON j.uid = f.uid AND j.consent_revision = f.consent_revision
JOIN sync_subjects s ON s.uid = f.uid
JOIN sync_state rev ON rev.uid = f.uid
WHERE f.uid = ? AND f.consent_revision = ? AND f.fence_epoch = ?
  AND f.lease_epoch = ? AND f.lease_token = ?
  AND NOT EXISTS (SELECT 1 FROM cloud_account_keys k WHERE k.uid = f.uid)
  AND NOT EXISTS (SELECT 1 FROM sync_documents d WHERE d.uid = f.uid)
  AND NOT EXISTS (SELECT 1 FROM sync_receipts r WHERE r.uid = f.uid)
  AND NOT EXISTS (SELECT 1 FROM sync_replica_mutations m WHERE m.uid = f.uid)
  AND NOT EXISTS (SELECT 1 FROM sync_replicas r WHERE r.uid = f.uid)
  AND (
    (f.key_disposition = 'destroyed' AND f.key_issued_at_ms IS NOT NULL
      AND EXISTS (SELECT 1 FROM cloud_key_issuance i
        WHERE i.uid = f.uid AND i.consent_revision = f.consent_revision
          AND i.issued_at_ms = f.key_issued_at_ms))
    OR (f.key_disposition = 'never-issued' AND f.key_issued_at_ms IS NULL
      AND NOT EXISTS (SELECT 1 FROM cloud_key_issuance i
        WHERE i.uid = f.uid AND i.consent_revision = f.consent_revision))
  )
`;

async function readTerminalProof(db, scope) {
  // Always acquire a fresh primary session: a previous preflight SELECT, a
  // stale read replica or the INSERT's own RETURNING is not terminal evidence.
  const primary = db.withSession('first-primary');
  if (!primary || typeof primary.prepare !== 'function') throw new Error('erasure-db-unavailable');
  const row = await primary.prepare(COMPLETE_PROOF).bind(...scope).first();
  if (!row) return null;
  const [uid, revision, epoch, leaseEpoch, token] = scope;
  const nextRevision = revision + 1;
  if (!Number.isSafeInteger(nextRevision) || nextRevision < 2
    || !Number.isSafeInteger(epoch + 1)
    || row.uid !== uid || row.consent_revision !== revision
    || row.fence_epoch !== epoch || row.lease_epoch !== leaseEpoch
    || !Number.isSafeInteger(row.completed_at_ms) || row.completed_at_ms < 1
    || row.erased_before_revision !== nextRevision
    || !Number.isSafeInteger(row.sync_revision_at_erasure)
    || row.sync_revision_at_erasure < 0
    || row.job_status !== 'complete' || row.job_phase !== 'awaiting-keys'
    || row.job_lease_epoch !== leaseEpoch || row.job_lease_token !== token
    || row.job_completed_at_ms !== row.completed_at_ms
    || row.job_erased_before_revision !== nextRevision
    || row.job_key_disposition !== row.key_disposition
    || row.subject_status !== 'withdrawn'
    || row.subject_consent_revision !== nextRevision
    || row.subject_fence_epoch !== epoch + 1
    || row.subject_erased_before_revision !== nextRevision
    || row.current_sync_revision !== row.sync_revision_at_erasure
    || (row.key_disposition !== 'destroyed' && row.key_disposition !== 'never-issued')) {
    return null;
  }
  return { outcome: 'complete', keyDisposition: row.key_disposition };
}

async function finalizeHealthErasureLease(db, lease) {
  let result;
  try {
    // No standalone ADK DELETE, job UPDATE or D1.batch() is permitted here.
    result = await lease.primary.prepare(FINALIZE).bind(...lease.scope).first();
  } catch (error) {
    // The INSERT may have committed before its response was lost. Read the
    // exact terminal proof; if unproven, preserve the error for retry/triage.
    const recovered = await readTerminalProof(db, lease.scope);
    if (recovered) return recovered;
    throw error;
  }
  // A zero-row RETURNING does NOT prove the caller's attempt completed.
  if (!result) return { outcome: 'contended' };
  const [uid, revision, epoch, leaseEpoch] = lease.scope;
  if (result.uid !== uid || result.consent_revision !== revision
    || result.fence_epoch !== epoch || result.lease_epoch !== leaseEpoch
    || !Number.isSafeInteger(result.completed_at_ms) || result.completed_at_ms < 1
    || result.erased_before_revision !== revision + 1
    || !Number.isSafeInteger(result.sync_revision_at_erasure)
    || result.sync_revision_at_erasure < 0
    || (result.key_disposition !== 'destroyed' && result.key_disposition !== 'never-issued')) {
    throw new Error('erasure-returning-unproven');
  }
  const verified = await readTerminalProof(db, lease.scope);
  if (!verified || verified.keyDisposition !== result.key_disposition) {
    throw new Error('erasure-terminal-proof-unproven');
  }
  return verified;
}

async function finalizeWithIndependentFence(db, recoveryDb, lease) {
  const { candidate, primary, scope } = lease;
  // The app's key phase is necessary to close export early. A stale
  // restored job or an expired lease cannot arm the independent cutoff.
  const current = await primary.prepare(`
    SELECT j.uid FROM health_erasure_jobs j
    JOIN sync_subjects s ON s.uid = j.uid
    WHERE j.uid = ? AND j.consent_revision = ? AND j.fence_epoch = ?
      AND j.lease_epoch = ? AND j.lease_token = ?
      AND j.lease_until_ms > ${SERVER_NOW}
      AND j.status = 'processing' AND j.phase = 'awaiting-keys'
      AND s.status = 'withdrawn' AND s.consent_revision = j.consent_revision
      AND s.fence_epoch = j.fence_epoch
      ${HEALTH_DATA_CLEANUP_TABLES.map(({ name }) => `AND NOT EXISTS (SELECT 1 FROM ${name} WHERE uid = j.uid)`).join('\n')}
  `).bind(...scope).first();
  if (current?.uid !== candidate.uid) return { outcome: 'contended' };

  await armIndependentErasureCutoff(recoveryDb, scope);
  const result = await finalizeHealthErasureLease(db, lease);
  if (result.outcome === 'complete') {
    await recordVerifiedTerminalErasure(db, recoveryDb, candidate.uid, candidate);
  }
  return result;
}

const AWAIT_KEYS = [
  "UPDATE health_erasure_jobs SET phase = 'awaiting-keys'",
  'WHERE uid = ? AND consent_revision = ? AND fence_epoch = ?',
  "  AND status = 'processing' AND phase = 'data'",
  '  AND lease_epoch = ? AND lease_token = ?',
  '  AND lease_until_ms > ' + SERVER_NOW,
  '  AND EXISTS (SELECT 1 FROM sync_subjects s',
  "    WHERE s.uid = health_erasure_jobs.uid AND s.status = 'withdrawn'",
  '      AND s.consent_revision = health_erasure_jobs.consent_revision',
  '      AND s.fence_epoch = health_erasure_jobs.fence_epoch)',
  '  AND NOT EXISTS (SELECT 1 FROM sync_documents d WHERE d.uid = health_erasure_jobs.uid)',
  '  AND NOT EXISTS (SELECT 1 FROM sync_receipts r WHERE r.uid = health_erasure_jobs.uid)',
  '  AND NOT EXISTS (SELECT 1 FROM sync_replica_mutations m WHERE m.uid = health_erasure_jobs.uid)',
  '  AND NOT EXISTS (SELECT 1 FROM sync_replicas r WHERE r.uid = health_erasure_jobs.uid)',
].join('\n');

/**
 * Queue by eligibility time, not original request age alone. A claimed job
 * re-enters at its lease expiry even if its step fails or the reply is lost.
 * Older waiting jobs then take precedence; future arrivals cannot overtake
 * an already eligible retry. The key-only helper uses the same ordering
 * within its narrower phase, without granting terminal authority.
 * The single UPDATE ... RETURNING CAS fences the selected owner,
 * consent generation, phase, previous lease and current withdrawn status.
 * A lost claim acknowledgement cannot be interpreted as ownership.
 */
async function claimOneHealthErasureLease(db, phase = null) {
  if (phase !== null && phase !== 'data' && phase !== 'awaiting-keys') throw new Error('invalid-erasure-phase');
  if (!db || typeof db.withSession !== 'function') throw new Error('erasure-db-unavailable');
  const primary = db.withSession('first-primary');
  if (!primary || typeof primary.prepare !== 'function') throw new Error('erasure-db-unavailable');
  const candidate = await primary.prepare(FIND_JOB).bind(phase, phase).first();
  if (!candidate) return { outcome: 'idle' };
  if (typeof candidate.uid !== 'string' || candidate.uid.length < 1
    || candidate.uid.length > 128 || candidate.uid.includes('/')
    || candidate.uid.trim() !== candidate.uid
    || (candidate.phase !== 'data' && candidate.phase !== 'awaiting-keys')
    || !Number.isSafeInteger(candidate.consent_revision) || candidate.consent_revision < 1
    || !Number.isSafeInteger(candidate.fence_epoch) || candidate.fence_epoch < 1) {
    throw new Error('invalid-erasure-job');
  }
  const token = newLeaseToken();
  const claimed = await primary.prepare(CLAIM_JOB)
    .bind(token, candidate.uid, candidate.consent_revision, candidate.fence_epoch, candidate.phase).first();
  if (!claimed) return { outcome: 'contended' };
  if (!Number.isSafeInteger(claimed.lease_epoch) || claimed.lease_epoch < 1
    || !Number.isSafeInteger(claimed.lease_until_ms) || claimed.lease_until_ms < 1) {
    throw new Error('erasure-lease-unproven');
  }
  return {
    primary, candidate, claimed,
    scope: [candidate.uid, candidate.consent_revision,
      candidate.fence_epoch, claimed.lease_epoch, token],
  };
}

/**
 * Internal lease acquisition for the key phase. This is NOT an erasure grant:
 * only the 0010-backed atomic proof INSERT may consume the exact lease token.
 */
export async function acquireOneHealthErasureKeyPhaseLease(db) {
  const lease = await claimOneHealthErasureLease(db, 'awaiting-keys');
  if (lease.outcome) return { outcome: lease.outcome };
  return {
    outcome: 'leased',
    uid: lease.candidate.uid,
    consentRevision: lease.candidate.consent_revision,
    fenceEpoch: lease.candidate.fence_epoch,
    leaseEpoch: lease.claimed.lease_epoch,
    leaseToken: lease.scope[4],
    leaseUntilMs: lease.claimed.lease_until_ms,
  };
}

async function runApplicationHealthErasureStep(db, recoveryDb = null) {
  const lease = await claimOneHealthErasureLease(db);
  if (lease.outcome) return { outcome: lease.outcome };
  const { primary, candidate, scope } = lease;
  if (recoveryDb) {
    const subject = await primary.prepare(`
      SELECT erased_before_revision FROM sync_subjects
      WHERE uid = ? AND status = 'withdrawn' AND consent_revision = ? AND fence_epoch = ?
    `).bind(candidate.uid, candidate.consent_revision, candidate.fence_epoch).first();
    if (!subject) return { outcome: 'contended' };
    await requireIndependentOwnerFence(recoveryDb, {
      uid: candidate.uid, status: 'withdrawn', consentRevision: candidate.consent_revision,
      fenceEpoch: candidate.fence_epoch, erasedBeforeRevision: subject.erased_before_revision,
    }, 'erasure');
  }
  if (candidate.phase === 'awaiting-keys') {
    return recoveryDb ? finalizeWithIndependentFence(db, recoveryDb, lease)
      : finalizeHealthErasureLease(db, lease);
  }
  for (const table of HEALTH_DATA_CLEANUP_TABLES) {
    const result = await primary.prepare(deleteBoundedSql(table))
      .bind(candidate.uid, candidate.uid, ...scope).run();
    const removed = deletedRowCount(result);
    if (removed > 0) return { outcome: 'progress', phase: 'data', removed, table: table.name };
  }
  const result = await primary.prepare(AWAIT_KEYS).bind(...scope).run();
  if (result?.success !== true || !Number.isSafeInteger(result.meta?.changes)
    || result.meta.changes < 0 || result.meta.changes > 1) {
    throw new Error('erasure-key-phase-unproven');
  }
  return result.meta.changes === 1
    ? { outcome: 'awaiting-keys' }
    : { outcome: 'contended' };
}

/**
 * Application-only SQL step used by the synthetic schema tests. The
 * scheduled entry point always requires the independent cutoff.
 */
export function runOneHealthErasureStep(db) {
  return runApplicationHealthErasureStep(db);
}

// Assignment is durable before either pipeline starts. A lost reply skips
// at most an assignment, not an owner cursor; the next tick serves the other
// lane. Per-owner leases and independent fences still authorize all erasure.
async function claimErasureLane(db, recoveryDb) {
  if (!db || !recoveryDb || db === recoveryDb) throw new Error('erasure-dispatch-unavailable');
  const row = await db.withSession('first-primary').prepare(`
    UPDATE erasure_dispatch_control SET turn = turn + 1
    WHERE singleton = 1 AND turn < 9007199254740991
    RETURNING turn
  `).bind().first();
  if (!Number.isSafeInteger(row?.turn) || row.turn < 1) throw new Error('erasure-dispatch-unavailable');
  return row.turn % 2 === 1 ? 'health' : 'account-application';
}

export default {
  async scheduled(_event, env) {
    // A future cron must not start irreversible erasure merely because the
    // Worker was deployed. The candidate manifest does not bind this flag.
    // Pausing leaves all queued jobs and their leases intact for recovery.
    if (env?.CF06_ERASURE_RUN_ENABLED !== 'enabled') return { outcome: 'paused' };
    let mode = env.CF06_ERASURE_RUN_MODE;
    // One bounded pipeline per invocation. Account processing is application-only
    // until a separate, validated Management boundary is available.
    if (mode !== undefined && mode !== 'health' && mode !== 'account-application' && mode !== 'alternating-application') {
      return { outcome: 'paused' };
    }
    const { DB, RECOVERY_DB } = env;
    if (mode === 'alternating-application') mode = await claimErasureLane(DB, RECOVERY_DB);
    if (mode === 'account-application') {
      return await runKindeAccountErasureSweepTick(DB, RECOVERY_DB);
    }
    const reconciliation = await reconcileNextIndependentErasure(DB, RECOVERY_DB);
    // A reserved cutoff retry cannot authorize or prevent another owner's
    // independently fenced step. Preserve a failed invocation for diagnostics;
    // no completion receipt is returned for the unresolved cutoff.
    const result = await runApplicationHealthErasureStep(DB, RECOVERY_DB);
    if (reconciliation === 'blocked') throw new IndependentFenceUnavailableError();
    return result;
  },
};
