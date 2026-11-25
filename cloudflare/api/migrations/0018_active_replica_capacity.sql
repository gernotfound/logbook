-- SYNC-7: bound live memberships, not the 16 causal coordinates or history.
-- Exclude the target slot and allow a still-valid exact incarnation to renew.
-- Expired leases retain their causal history; the skew margin matches claims.
CREATE TRIGGER sync_replica_active_capacity_insert
BEFORE INSERT ON sync_replicas
WHEN NEW.status = 'active' AND NEW.lease_until_ms + 300000 >= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
  AND NOT EXISTS (
    SELECT 1 FROM sync_replicas r WHERE r.uid = NEW.uid AND r.slot = NEW.slot
      AND r.replica_id = NEW.replica_id AND r.generation = NEW.generation
      AND r.status = 'active' AND r.lease_until_ms + 300000 >= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
  )
  AND (SELECT COUNT(*) FROM sync_replicas r
    WHERE r.uid = NEW.uid AND r.slot != NEW.slot AND r.status = 'active'
      AND r.lease_until_ms + 300000 >= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))) >= 5
BEGIN SELECT RAISE(ABORT, 'replica-capacity'); END;

CREATE TRIGGER sync_replica_active_capacity_update
BEFORE UPDATE ON sync_replicas
WHEN NEW.status = 'active' AND NEW.lease_until_ms + 300000 >= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
  AND NOT (OLD.uid = NEW.uid AND OLD.slot = NEW.slot
    AND OLD.replica_id = NEW.replica_id AND OLD.generation = NEW.generation
    AND OLD.status = 'active' AND OLD.lease_until_ms + 300000 >= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))
  AND (SELECT COUNT(*) FROM sync_replicas r
    WHERE r.uid = NEW.uid AND r.slot != NEW.slot AND r.status = 'active'
      AND r.lease_until_ms + 300000 >= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))) >= 5
BEGIN SELECT RAISE(ABORT, 'replica-capacity'); END;
