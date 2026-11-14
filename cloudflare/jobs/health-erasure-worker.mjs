import { D1_NOW_MS } from '../sql/d1-time.mjs';

// Candidate-only D1 erasure worker. No public fetch, route, or cron binding.
// This step removes bounded encrypted replica rows; it cannot remove a cloud
// ADK or issue an erasure-complete receipt until those trusted flows exist.
const MAX_ROWS_PER_STEP = 4;
const LEASE_MS = 30_000;
const SERVER_NOW = D1_NOW_MS;
const TABLES = Object.freeze([
  { name: 'sync_documents', key: 'path' },
  { name: 'sync_receipts', key: 'batch_id' },
  { name: 'sync_replica_mutations', key: 'mutation_id' },
  { name: 'sync_replicas', key: 'slot' },
]);

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

const FIND_JOB = [
  'SELECT j.uid, j.consent_revision, j.fence_epoch',
  'FROM health_erasure_jobs j',
  'JOIN sync_subjects s ON s.uid = j.uid',
  "WHERE j.phase = 'data' AND j.status IN ('pending', 'processing')",
  '  AND j.lease_until_ms <= ' + SERVER_NOW,
  "  AND s.status = 'withdrawn'",
  '  AND s.consent_revision = j.consent_revision AND s.fence_epoch = j.fence_epoch',
  'ORDER BY j.requested_at_ms, j.uid LIMIT 1',
].join('\n');

const CLAIM_JOB = [
  'UPDATE health_erasure_jobs SET',
  "  status = 'processing', lease_epoch = lease_epoch + 1,",
  '  lease_token = ?, lease_until_ms = ' + SERVER_NOW + ' + ' + LEASE_MS,
  'WHERE uid = ? AND consent_revision = ? AND fence_epoch = ?',
  "  AND phase = 'data' AND status IN ('pending', 'processing')",
  '  AND lease_until_ms <= ' + SERVER_NOW,
  '  AND EXISTS (SELECT 1 FROM sync_subjects s',
  "    WHERE s.uid = health_erasure_jobs.uid AND s.status = 'withdrawn'",
  '      AND s.consent_revision = health_erasure_jobs.consent_revision',
  '      AND s.fence_epoch = health_erasure_jobs.fence_epoch)',
  'RETURNING lease_epoch, lease_until_ms',
].join('\n');

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
 * Process at most four rows in one D1 statement. Each statement rechecks the
 * lease and withdrawn generation inside SQL, so a stolen or expired lease
 * cannot authorize later writes. Missing schema, quota, or uncertain ACK
 * raises: this runner never advances the job to complete/failed.
 */
export async function runOneHealthErasureStep(db) {
  if (!db || typeof db.withSession !== 'function') throw new Error('erasure-db-unavailable');
  const primary = db.withSession('first-primary');
  if (!primary || typeof primary.prepare !== 'function') throw new Error('erasure-db-unavailable');
  const candidate = await primary.prepare(FIND_JOB).first();
  if (!candidate) return { outcome: 'idle' };
  if (typeof candidate.uid !== 'string' || candidate.uid.length < 1
    || !Number.isSafeInteger(candidate.consent_revision) || candidate.consent_revision < 1
    || !Number.isSafeInteger(candidate.fence_epoch) || candidate.fence_epoch < 1) {
    throw new Error('invalid-erasure-job');
  }
  const token = newLeaseToken();
  const claimed = await primary.prepare(CLAIM_JOB)
    .bind(token, candidate.uid, candidate.consent_revision, candidate.fence_epoch).first();
  if (!claimed) return { outcome: 'contended' };
  if (!Number.isSafeInteger(claimed.lease_epoch) || claimed.lease_epoch < 1
    || !Number.isSafeInteger(claimed.lease_until_ms) || claimed.lease_until_ms < 1) {
    throw new Error('erasure-lease-unproven');
  }
  const scope = [candidate.uid, candidate.consent_revision,
    candidate.fence_epoch, claimed.lease_epoch, token];
  for (const table of TABLES) {
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

export default {
  async scheduled(_event, env) {
    await runOneHealthErasureStep(env.DB);
  },
};
