-- CF-06 / B-02: terminal erasure is ONE SQLite INSERT statement.
-- A successful finalization proof cannot exist unless all triggered deletions,
-- subject fencing and job completion committed together. No D1.batch() contract
-- or cross-statement "success" is needed. All old migrations stay immutable.

-- "erased_before_revision = N" means consent generations strictly below N
-- are irrecoverably erased/fenced. This is NOT sync_state.revision (CAS counter).
ALTER TABLE sync_subjects
  ADD COLUMN erased_before_revision INTEGER NOT NULL DEFAULT 0
    CHECK (erased_before_revision >= 0
      AND erased_before_revision <= consent_revision);

ALTER TABLE health_erasure_jobs
  ADD COLUMN completed_at_ms INTEGER
    CHECK (completed_at_ms IS NULL OR completed_at_ms > 0);
ALTER TABLE health_erasure_jobs
  ADD COLUMN erased_before_revision INTEGER
    CHECK (erased_before_revision IS NULL OR erased_before_revision >= 2);
ALTER TABLE health_erasure_jobs
  ADD COLUMN key_disposition TEXT
    CHECK (key_disposition IS NULL
      OR key_disposition IN ('destroyed', 'never-issued'));

-- A separate durable terminal proof survives completed-job retention. The
-- immutable issuance marker remains present after destruction. The private
-- lease token is a SQL capability and MUST NOT appear in public readbacks.
CREATE TABLE health_erasure_finalizations (
  uid TEXT NOT NULL REFERENCES sync_subjects(uid) ON DELETE RESTRICT,
  consent_revision INTEGER NOT NULL CHECK (consent_revision >= 1),
  fence_epoch INTEGER NOT NULL CHECK (fence_epoch >= 1),
  lease_epoch INTEGER NOT NULL CHECK (lease_epoch >= 1),
  lease_token TEXT NOT NULL CHECK (
    length(lease_token) = 64 AND lease_token NOT GLOB '*[^0-9a-f]*'
  ),
  completed_at_ms INTEGER NOT NULL CHECK (completed_at_ms > 0),
  erased_before_revision INTEGER NOT NULL
    CHECK (erased_before_revision = consent_revision + 1),
  sync_revision_at_erasure INTEGER NOT NULL CHECK (sync_revision_at_erasure >= 0),
  key_disposition TEXT NOT NULL
    CHECK (key_disposition IN ('destroyed', 'never-issued')),
  key_issued_at_ms INTEGER CHECK (key_issued_at_ms IS NULL OR key_issued_at_ms > 0),
  PRIMARY KEY (uid, consent_revision),
  CHECK (
    (key_disposition = 'destroyed' AND key_issued_at_ms IS NOT NULL)
    OR (key_disposition = 'never-issued' AND key_issued_at_ms IS NULL)
  )
);

CREATE TRIGGER health_erasure_proof_immutable_update
BEFORE UPDATE ON health_erasure_finalizations
BEGIN SELECT RAISE(ABORT, 'erasure-proof-immutable'); END;

CREATE TRIGGER health_erasure_proof_immutable_delete
BEFORE DELETE ON health_erasure_finalizations
BEGIN SELECT RAISE(ABORT, 'erasure-proof-immutable'); END;

-- The first SQLite statement is the proof INSERT; it authorizes no work unless
-- the exact still-live job lease, owner generation, empty ciphertext register
-- and real ADK/issuance state are all simultaneously verified.
CREATE TRIGGER health_erasure_finalization_fence
BEFORE INSERT ON health_erasure_finalizations
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM health_erasure_finalizations f
    WHERE f.uid = NEW.uid AND f.consent_revision = NEW.consent_revision
  ) OR NEW.consent_revision >= 9223372036854775807
    OR NEW.completed_at_ms != CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    OR NOT EXISTS (
      SELECT 1 FROM health_erasure_jobs j
      JOIN sync_subjects s ON s.uid = j.uid
      JOIN sync_state rev ON rev.uid = j.uid
      WHERE j.uid = NEW.uid
        AND j.consent_revision = NEW.consent_revision
        AND j.fence_epoch = NEW.fence_epoch
        AND j.status = 'processing'
        AND j.phase = 'awaiting-keys'
        AND j.lease_epoch = NEW.lease_epoch
        AND j.lease_token = NEW.lease_token
        AND j.lease_until_ms > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
        AND j.completed_at_ms IS NULL
        AND j.erased_before_revision IS NULL
        AND j.key_disposition IS NULL
        AND s.status = 'withdrawn'
        AND s.consent_revision = j.consent_revision
        AND s.fence_epoch = j.fence_epoch
        AND s.fence_epoch < 9223372036854775807
        AND s.erased_before_revision < NEW.erased_before_revision
        AND NEW.erased_before_revision = j.consent_revision + 1
        AND rev.revision = NEW.sync_revision_at_erasure
    )
    OR EXISTS (SELECT 1 FROM sync_documents d WHERE d.uid = NEW.uid)
    OR EXISTS (SELECT 1 FROM sync_receipts r WHERE r.uid = NEW.uid)
    OR EXISTS (SELECT 1 FROM sync_replica_mutations m WHERE m.uid = NEW.uid)
    OR EXISTS (SELECT 1 FROM sync_replicas r WHERE r.uid = NEW.uid)
    OR NOT (
      (NEW.key_disposition = 'destroyed'
        AND EXISTS (
          SELECT 1 FROM cloud_key_issuance i
          JOIN cloud_account_keys k ON k.uid = i.uid
            AND k.consent_revision = i.consent_revision
            AND k.issued_at_ms = i.issued_at_ms
          WHERE i.uid = NEW.uid AND i.consent_revision = NEW.consent_revision
            AND i.issued_at_ms = NEW.key_issued_at_ms
        ))
      OR
      (NEW.key_disposition = 'never-issued'
        AND NOT EXISTS (SELECT 1 FROM cloud_key_issuance i
          WHERE i.uid = NEW.uid AND i.consent_revision = NEW.consent_revision)
        AND NOT EXISTS (SELECT 1 FROM cloud_account_keys k
          WHERE k.uid = NEW.uid))
    )
    THEN RAISE(ABORT, 'erasure-finalization-fenced') END;
END;

-- Replace the old "never complete" guard; keep all original progress/lease
-- protections, and allow complete only with an exact immutable proof inserted
-- by this SAME SQL statement. Ordinary lease claims/pages are unchanged.
DROP TRIGGER health_erasure_progress_fence;
CREATE TRIGGER health_erasure_progress_fence
BEFORE UPDATE ON health_erasure_jobs
WHEN NEW.uid != OLD.uid
  OR NEW.consent_revision != OLD.consent_revision
  OR NEW.fence_epoch != OLD.fence_epoch
  OR NEW.requested_at_ms != OLD.requested_at_ms
  OR OLD.status = 'complete'
  OR NEW.status NOT IN ('pending', 'processing', 'complete')
  OR (NEW.status != 'complete' AND (
    NEW.completed_at_ms IS NOT NULL
    OR NEW.erased_before_revision IS NOT NULL
    OR NEW.key_disposition IS NOT NULL))
  OR (NEW.status = 'complete' AND (
    OLD.status != 'processing' OR OLD.phase != 'awaiting-keys'
    OR NEW.phase != 'awaiting-keys'
    OR NEW.lease_epoch != OLD.lease_epoch
    OR NEW.lease_token IS NOT OLD.lease_token
    OR NEW.lease_until_ms != OLD.lease_until_ms
    OR NOT EXISTS (
      SELECT 1 FROM health_erasure_finalizations f
      WHERE f.uid = OLD.uid AND f.consent_revision = OLD.consent_revision
        AND f.fence_epoch = OLD.fence_epoch
        AND f.lease_epoch = OLD.lease_epoch
        AND f.lease_token = OLD.lease_token
        AND f.completed_at_ms = NEW.completed_at_ms
        AND f.erased_before_revision = NEW.erased_before_revision
        AND f.key_disposition = NEW.key_disposition
    )
  ))
  OR (NEW.status != 'complete'
    AND OLD.status = 'processing' AND NEW.status != 'processing')
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
BEGIN SELECT RAISE(ABORT, 'erasure-progress-fenced'); END;

-- B-01 keeps direct replica writes fenced; do not allow a direct change of
-- erasedBeforeRevision without the corresponding terminal row and subject
-- epoch advance. The no-regression trigger from 0001 remains active.
CREATE TRIGGER sync_subject_erased_before_fence
BEFORE UPDATE ON sync_subjects
WHEN NEW.erased_before_revision < OLD.erased_before_revision
  OR NEW.erased_before_revision > NEW.consent_revision
  OR (NEW.erased_before_revision > OLD.erased_before_revision AND NOT EXISTS (
    SELECT 1 FROM health_erasure_finalizations f
    JOIN health_erasure_jobs j ON j.uid = f.uid
      AND j.consent_revision = f.consent_revision
    WHERE f.uid = OLD.uid
      AND f.consent_revision = OLD.consent_revision
      AND f.fence_epoch = OLD.fence_epoch
      AND f.erased_before_revision = NEW.erased_before_revision
      AND j.status = 'complete'
      AND j.completed_at_ms = f.completed_at_ms
      AND j.erased_before_revision = f.erased_before_revision
      AND OLD.status = 'withdrawn' AND NEW.status = 'withdrawn'
      AND NEW.consent_revision = f.erased_before_revision
      AND NEW.fence_epoch = OLD.fence_epoch + 1
  ))
BEGIN SELECT RAISE(ABORT, 'erasure-subject-fenced'); END;

-- Old 0007 allowed an independently issued DELETE in awaiting-keys, leaving
-- a keyless job unfinished. Now ONLY a freshly inserted terminal proof with
-- matching still-active lease may authorize deletion during its trigger.
DROP TRIGGER cloud_key_erasure_only;
CREATE TRIGGER cloud_key_erasure_only
BEFORE DELETE ON cloud_account_keys
WHEN NOT EXISTS (
  SELECT 1 FROM health_erasure_finalizations f
  JOIN health_erasure_jobs j
    ON j.uid = f.uid AND j.consent_revision = f.consent_revision
  JOIN sync_subjects s ON s.uid = f.uid
  WHERE f.uid = OLD.uid
    AND f.consent_revision = OLD.consent_revision
    AND f.key_disposition = 'destroyed'
    AND f.key_issued_at_ms = OLD.issued_at_ms
    AND j.status = 'processing' AND j.phase = 'awaiting-keys'
    AND j.fence_epoch = f.fence_epoch
    AND j.lease_epoch = f.lease_epoch
    AND j.lease_token = f.lease_token
    AND j.lease_until_ms > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    AND s.status = 'withdrawn'
    AND s.consent_revision = f.consent_revision
    AND s.fence_epoch = f.fence_epoch
)
BEGIN SELECT RAISE(ABORT, 'cloud-key-erasure-fenced'); END;

-- Every side-effect is part of this SAME INSERT statement. SQLite RAISE
-- ABORT restores the proof row AND all earlier trigger side effects if
-- the required DELETE or either UPDATE affects zero rows or fails.
CREATE TRIGGER health_erasure_finalize_atomically
AFTER INSERT ON health_erasure_finalizations
BEGIN
  DELETE FROM cloud_account_keys
  WHERE uid = NEW.uid
    AND consent_revision = NEW.consent_revision
    AND issued_at_ms = NEW.key_issued_at_ms
    AND NEW.key_disposition = 'destroyed';
  SELECT CASE WHEN NEW.key_disposition = 'destroyed' AND changes() != 1
    THEN RAISE(ABORT, 'erasure-adk-delete-unproven') END;

  UPDATE health_erasure_jobs
  SET status = 'complete',
    completed_at_ms = NEW.completed_at_ms,
    erased_before_revision = NEW.erased_before_revision,
    key_disposition = NEW.key_disposition
  WHERE uid = NEW.uid
    AND consent_revision = NEW.consent_revision
    AND fence_epoch = NEW.fence_epoch
    AND status = 'processing' AND phase = 'awaiting-keys'
    AND lease_epoch = NEW.lease_epoch AND lease_token = NEW.lease_token
    AND lease_until_ms > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER);
  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'erasure-job-complete-unproven') END;

  UPDATE sync_subjects
  SET erased_before_revision = NEW.erased_before_revision,
    consent_revision = NEW.erased_before_revision,
    fence_epoch = fence_epoch + 1
  WHERE uid = NEW.uid AND status = 'withdrawn'
    AND consent_revision = NEW.consent_revision AND fence_epoch = NEW.fence_epoch
    AND erased_before_revision < NEW.erased_before_revision;
  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'erasure-subject-complete-unproven') END;
END;
