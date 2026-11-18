-- The independent deny must survive an application restore after key erasure.
-- Store only the owner and generation. A lease or cutoff is not an erasure proof.
CREATE TABLE recovery_erasure_cutoffs (
  uid TEXT NOT NULL REFERENCES recovery_owner_fences(uid),
  consent_revision INTEGER NOT NULL CHECK (consent_revision >= 1),
  fence_epoch INTEGER NOT NULL CHECK (fence_epoch >= 1),
  next_check_ms INTEGER NOT NULL DEFAULT 0 CHECK (next_check_ms >= 0),
  finalized INTEGER NOT NULL DEFAULT 0 CHECK (finalized IN (0, 1)),
  PRIMARY KEY (uid, consent_revision, fence_epoch)
) WITHOUT ROWID;

CREATE INDEX recovery_erasure_cutoffs_due
ON recovery_erasure_cutoffs (next_check_ms, uid, consent_revision, fence_epoch)
WHERE finalized = 0;

CREATE TRIGGER recovery_erasure_cutoff_insert_fenced
BEFORE INSERT ON recovery_erasure_cutoffs
WHEN NEW.next_check_ms != 0 OR NEW.finalized != 0
  OR EXISTS (SELECT 1 FROM recovery_erasure_cutoffs c
    WHERE c.uid = NEW.uid AND c.consent_revision = NEW.consent_revision
      AND c.fence_epoch = NEW.fence_epoch)
  OR NOT EXISTS (
    SELECT 1 FROM recovery_owner_fences f CROSS JOIN recovery_control r
    WHERE r.singleton = 1 AND r.mode = 'open' AND f.uid = NEW.uid
      AND f.status IN ('blocked', 'withdrawn')
      AND f.consent_revision = NEW.consent_revision AND f.fence_epoch = NEW.fence_epoch
      AND f.erased_before_revision < f.consent_revision
  )
BEGIN SELECT RAISE(ABORT, 'recovery-erasure-cutoff-fenced'); END;

CREATE TRIGGER recovery_erasure_cutoff_no_delete
BEFORE DELETE ON recovery_erasure_cutoffs
BEGIN SELECT RAISE(ABORT, 'recovery-erasure-cutoff-immutable'); END;

CREATE TRIGGER recovery_erasure_cutoff_update_fenced
BEFORE UPDATE ON recovery_erasure_cutoffs
WHEN NEW.uid != OLD.uid OR NEW.consent_revision != OLD.consent_revision
  OR NEW.fence_epoch != OLD.fence_epoch OR OLD.finalized != 0
  OR NOT (
    (NEW.finalized = 0 AND NEW.next_check_ms > OLD.next_check_ms)
    OR (NEW.finalized = 1 AND NEW.next_check_ms = OLD.next_check_ms AND EXISTS (
      SELECT 1 FROM recovery_owner_fences f
      WHERE f.uid = OLD.uid AND f.status = 'withdrawn'
        AND f.consent_revision = OLD.consent_revision + 1 AND f.fence_epoch = OLD.fence_epoch + 1
        AND f.erased_before_revision = f.consent_revision
    ))
  )
BEGIN SELECT RAISE(ABORT, 'recovery-erasure-cutoff-fenced'); END;

-- Closing the queue item and publishing terminal evidence are one D1 commit.
-- The cutoff survives completion, even after it stops counting toward retries.
CREATE TRIGGER recovery_erasure_cutoff_close_with_terminal_floor
AFTER UPDATE ON recovery_owner_fences
WHEN OLD.status IN ('blocked', 'withdrawn') AND NEW.status = 'withdrawn'
  AND NEW.consent_revision = OLD.consent_revision + 1
  AND NEW.fence_epoch = OLD.fence_epoch + 1
  AND NEW.erased_before_revision = NEW.consent_revision
BEGIN
  UPDATE recovery_erasure_cutoffs SET finalized = 1
  WHERE uid = OLD.uid AND consent_revision = OLD.consent_revision
    AND fence_epoch = OLD.fence_epoch AND finalized = 0;
END;
