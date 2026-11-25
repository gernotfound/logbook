-- Preserve historical receipts and the automatic expired-lease fence.
-- Explicit retirement is a separate, exact-incarnation decision in the same CAS.
ALTER TABLE sync_replica_mutations ADD COLUMN retirement_mode TEXT NOT NULL DEFAULT 'expired'
  CHECK (retirement_mode IN ('expired', 'explicit') AND (retirement_mode = 'expired' OR action = 'retire'));

DROP TRIGGER sync_replica_mutation_fence;
CREATE TRIGGER sync_replica_mutation_fence BEFORE INSERT ON sync_replica_mutations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sync_subjects a
    JOIN sync_state s ON s.uid = a.uid
    WHERE a.uid = NEW.uid AND a.status = 'active'
      AND a.consent_revision = NEW.consent_revision
      AND a.fence_epoch = NEW.fence_epoch
      AND s.revision = NEW.expected_revision
  ) THEN RAISE(ABORT, 'replica-control-fenced') END;

  SELECT CASE WHEN NEW.action = 'register' AND (
    NEW.generation != 1 OR
    EXISTS (SELECT 1 FROM sync_replicas r WHERE r.uid = NEW.uid AND r.slot = NEW.slot) OR
    EXISTS (SELECT 1 FROM sync_replicas r WHERE r.uid = NEW.uid AND r.replica_id = NEW.replica_id)
  ) THEN RAISE(ABORT, 'replica-control-fenced') END;

  SELECT CASE WHEN NEW.action = 'checkpoint' AND NOT EXISTS (
    SELECT 1 FROM sync_replicas r
    WHERE r.uid = NEW.uid AND r.slot = NEW.slot
      AND r.replica_id = NEW.replica_id AND r.generation = NEW.generation
      AND r.status = 'active' AND r.last_seq <= NEW.last_seq
      AND r.lease_until_ms + 300000 >= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  ) THEN RAISE(ABORT, 'replica-control-fenced') END;

  SELECT CASE WHEN NEW.action = 'reuse-expired' AND (
    NOT EXISTS (
      SELECT 1 FROM sync_replicas r WHERE r.uid = NEW.uid AND r.slot = NEW.slot
        AND NEW.generation = r.generation + 1 AND NEW.last_seq >= r.last_seq
        AND (r.status = 'retired' OR
          r.lease_until_ms + 300000 < CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
    ) OR EXISTS (
      SELECT 1 FROM sync_replicas r WHERE r.uid = NEW.uid AND r.replica_id = NEW.replica_id
    )
  ) THEN RAISE(ABORT, 'replica-control-fenced') END;

  SELECT CASE WHEN NEW.action = 'retire' AND NOT EXISTS (
    SELECT 1 FROM sync_replicas r
    WHERE r.uid = NEW.uid AND r.slot = NEW.slot
      AND r.replica_id = NEW.replica_id AND r.generation = NEW.generation
      AND r.status = 'active' AND r.last_seq = NEW.last_seq
      AND (
        (NEW.retirement_mode = 'expired' AND
          r.lease_until_ms + 300000 < CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
        OR (NEW.retirement_mode = 'explicit'
          AND r.lease_until_ms = NEW.lease_until_ms
          AND r.checkpoint_at_ms = NEW.checkpoint_at_ms
          AND r.checkpoint_clock_json = NEW.checkpoint_clock_json)
      )
  ) THEN RAISE(ABORT, 'replica-control-fenced') END;
END;
