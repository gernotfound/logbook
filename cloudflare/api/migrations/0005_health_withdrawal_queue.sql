-- CF-05: durable withdrawal request. No erasure runner is enabled by this
-- migration. The job must remain pending until deletion is separately proven.
CREATE TABLE health_erasure_jobs (
  uid TEXT NOT NULL REFERENCES sync_subjects(uid) ON DELETE RESTRICT,
  consent_revision INTEGER NOT NULL CHECK (consent_revision >= 1),
  fence_epoch INTEGER NOT NULL CHECK (fence_epoch >= 1),
  requested_at_ms INTEGER NOT NULL CHECK (requested_at_ms > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  PRIMARY KEY (uid, consent_revision)
);

-- Inserting an authorized job and withdrawing its sync grant are ONE SQLite
-- statement. No separate ACK or client retry may leave a durable job while
-- the same consent generation remains active. Reacceptance requires a new
-- trusted consent revision and fence epoch after completed erasure.
CREATE TRIGGER health_erasure_queue_withdraw AFTER INSERT ON health_erasure_jobs
BEGIN
  UPDATE sync_subjects SET status = 'withdrawn'
  WHERE uid = NEW.uid AND status = 'active'
    AND consent_revision = NEW.consent_revision
    AND fence_epoch = NEW.fence_epoch;
  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'withdrawal-fenced') END;
END;
