-- Retain historical membership IDs as tombstones, even after their slot is
-- reused. A registered device cannot resurrect an old replica identity.
-- Additive migration for isolated databases where 0001 is already applied.
CREATE TRIGGER sync_replica_id_no_reuse BEFORE INSERT ON sync_replica_mutations
WHEN NEW.action IN ('register', 'reuse-expired') AND EXISTS (
  SELECT 1 FROM sync_replica_mutations history
  WHERE history.uid = NEW.uid AND history.replica_id = NEW.replica_id
)
BEGIN
  SELECT RAISE(ABORT, 'replica-id-reuse');
END;
