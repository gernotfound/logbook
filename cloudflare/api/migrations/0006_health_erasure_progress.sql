-- CF-06: bounded, lease-fenced progress on the new D1 withdrawal jobs.
-- No Worker cron/route is enabled by this schema. "awaiting-keys" is NOT
-- completion: the cloud ADK and final owner-scoped erasure proof are absent.
ALTER TABLE health_erasure_jobs
  ADD COLUMN phase TEXT NOT NULL DEFAULT 'data'
    CHECK (phase IN ('data', 'awaiting-keys'));
ALTER TABLE health_erasure_jobs
  ADD COLUMN lease_epoch INTEGER NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0);
ALTER TABLE health_erasure_jobs
  ADD COLUMN lease_token TEXT
    CHECK (lease_token IS NULL OR (length(lease_token) = 64 AND lease_token NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE health_erasure_jobs
  ADD COLUMN lease_until_ms INTEGER NOT NULL DEFAULT 0 CHECK (lease_until_ms >= 0);

CREATE INDEX health_erasure_runnable
  ON health_erasure_jobs (phase, status, lease_until_ms, requested_at_ms, uid);

-- No code in this increment can legitimately emit "complete" or "failed".
-- Keep the original identity, receipt and lease epoch immutable/monotone.
-- A future finalizer must introduce its own stronger migration and evidence.
CREATE TRIGGER health_erasure_progress_fence BEFORE UPDATE ON health_erasure_jobs
WHEN NEW.uid != OLD.uid
  OR NEW.consent_revision != OLD.consent_revision
  OR NEW.fence_epoch != OLD.fence_epoch
  OR NEW.requested_at_ms != OLD.requested_at_ms
  OR NEW.status NOT IN ('pending', 'processing')
  OR (OLD.status = 'processing' AND NEW.status != 'processing')
  OR (NEW.status = 'processing'
      AND (NEW.lease_epoch < 1 OR NEW.lease_token IS NULL
        OR NEW.lease_until_ms <= 0))
  OR (NEW.status = 'processing' AND OLD.status = 'pending'
      AND NEW.lease_epoch <= OLD.lease_epoch)
  OR NEW.lease_epoch < OLD.lease_epoch
  OR NEW.lease_epoch > OLD.lease_epoch + 1
  OR (NEW.lease_epoch = OLD.lease_epoch AND NEW.lease_token IS NOT OLD.lease_token)
  OR (NEW.phase = 'data' AND OLD.phase = 'awaiting-keys')
  OR (NEW.phase = 'awaiting-keys' AND OLD.phase = 'data' AND (
      OLD.status != 'processing'
      OR EXISTS (SELECT 1 FROM sync_documents d WHERE d.uid = OLD.uid)
      OR EXISTS (SELECT 1 FROM sync_receipts r WHERE r.uid = OLD.uid)
      OR EXISTS (SELECT 1 FROM sync_replica_mutations m WHERE m.uid = OLD.uid)
      OR EXISTS (SELECT 1 FROM sync_replicas r WHERE r.uid = OLD.uid)
    ))
BEGIN
  SELECT RAISE(ABORT, 'erasure-progress-fenced');
END;

CREATE TRIGGER health_erasure_job_initial_state BEFORE INSERT ON health_erasure_jobs
WHEN NEW.status != 'pending' OR NEW.phase != 'data'
  OR NEW.lease_epoch != 0 OR NEW.lease_token IS NOT NULL
  OR NEW.lease_until_ms != 0
BEGIN
  SELECT RAISE(ABORT, 'erasure-job-initial-state');
END;

-- The revoked generation cannot regain fitness access while any erasure
-- request remains unfinished, even if another trusted Auth action advances
-- the principal epoch and a new explicit consent revision.
CREATE TRIGGER sync_subject_reaccept_requires_erasure BEFORE UPDATE ON sync_subjects
WHEN OLD.status != 'active' AND NEW.status = 'active'
  AND EXISTS (SELECT 1 FROM health_erasure_jobs j
    WHERE j.uid = OLD.uid AND j.status != 'complete')
BEGIN SELECT RAISE(ABORT, 'erasure-not-complete'); END;

-- An out-of-band writer may not resurrect encrypted business documents or
-- replica leases during erasure. Normal writes already require an API receipt,
-- but these triggers fence direct SQL as defense in depth.
CREATE TRIGGER sync_document_no_write_after_withdraw BEFORE INSERT ON sync_documents
WHEN NOT EXISTS (SELECT 1 FROM sync_subjects s
  WHERE s.uid = NEW.uid AND s.status = 'active')
BEGIN SELECT RAISE(ABORT, 'withdrawn-document-write'); END;

CREATE TRIGGER sync_document_no_update_after_withdraw BEFORE UPDATE ON sync_documents
WHEN NEW.uid != OLD.uid OR NOT EXISTS (SELECT 1 FROM sync_subjects s
  WHERE s.uid = OLD.uid AND s.status = 'active')
BEGIN SELECT RAISE(ABORT, 'withdrawn-document-write'); END;

CREATE TRIGGER sync_replica_no_insert_after_withdraw BEFORE INSERT ON sync_replicas
WHEN NOT EXISTS (SELECT 1 FROM sync_subjects s
  WHERE s.uid = NEW.uid AND s.status = 'active')
BEGIN SELECT RAISE(ABORT, 'withdrawn-replica-write'); END;

CREATE TRIGGER sync_replica_no_update_after_withdraw BEFORE UPDATE ON sync_replicas
WHEN NEW.uid != OLD.uid OR NOT EXISTS (SELECT 1 FROM sync_subjects s
  WHERE s.uid = OLD.uid AND s.status = 'active')
BEGIN SELECT RAISE(ABORT, 'withdrawn-replica-write'); END;
