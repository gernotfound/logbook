-- Dry-run traversal checkpoint, not an account erasure authorization.
CREATE TABLE kinde_inactivity_scan_checkpoint (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  policy_generation INTEGER NOT NULL CHECK (policy_generation BETWEEN 0 AND 9007199254740991),
  recovery_generation INTEGER NOT NULL CHECK (recovery_generation BETWEEN 0 AND 9007199254740991),
  cursor_last_recorded_at_ms INTEGER CHECK (cursor_last_recorded_at_ms > 0),
  cursor_uid TEXT CHECK (cursor_uid IS NULL OR (length(cursor_uid) = 45
    AND substr(cursor_uid, 1, 2) = 'k_' AND substr(cursor_uid, 3) NOT GLOB '*[^A-Za-z0-9_-]*')),
  lease_epoch INTEGER NOT NULL CHECK (lease_epoch BETWEEN 0 AND 9007199254740991),
  lease_token TEXT CHECK (lease_token IS NULL OR (length(lease_token) = 64 AND lease_token NOT GLOB '*[^0-9a-f]*')),
  lease_until_ms INTEGER NOT NULL CHECK (lease_until_ms >= 0),
  CHECK ((cursor_uid IS NULL) = (cursor_last_recorded_at_ms IS NULL)),
  CHECK ((lease_epoch = 0 AND lease_token IS NULL AND lease_until_ms = 0
    AND policy_generation = 0 AND recovery_generation = 0 AND cursor_uid IS NULL)
    OR (lease_epoch > 0 AND lease_token IS NOT NULL AND policy_generation > 0 AND recovery_generation > 0))
) STRICT;

INSERT INTO kinde_inactivity_scan_checkpoint VALUES (1, 0, 0, NULL, NULL, 0, NULL, 0);

CREATE TRIGGER kinde_inactivity_scan_checkpoint_no_replace
BEFORE INSERT ON kinde_inactivity_scan_checkpoint
WHEN EXISTS (SELECT 1 FROM kinde_inactivity_scan_checkpoint)
BEGIN SELECT RAISE(ABORT, 'kinde-inactivity-checkpoint-immutable'); END;

CREATE TRIGGER kinde_inactivity_scan_checkpoint_no_delete
BEFORE DELETE ON kinde_inactivity_scan_checkpoint
BEGIN SELECT RAISE(ABORT, 'kinde-inactivity-checkpoint-immutable'); END;

CREATE TRIGGER kinde_inactivity_scan_checkpoint_transition
BEFORE UPDATE ON kinde_inactivity_scan_checkpoint
WHEN NEW.singleton != OLD.singleton OR NOT (
  EXISTS (SELECT 1 FROM kinde_inactivity_control c WHERE c.singleton = 1
    AND c.mode = 'enabled' AND c.generation = NEW.policy_generation)
  AND (
    (NEW.lease_epoch = OLD.lease_epoch + 1 AND NEW.lease_token IS NOT OLD.lease_token
      AND NEW.policy_generation >= OLD.policy_generation AND NEW.recovery_generation >= OLD.recovery_generation
      AND OLD.lease_until_ms <=
        (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
      AND NEW.lease_until_ms =
        (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)) + 60000
      AND ((NEW.policy_generation = OLD.policy_generation AND NEW.recovery_generation = OLD.recovery_generation
        AND NEW.cursor_uid IS OLD.cursor_uid AND NEW.cursor_last_recorded_at_ms IS OLD.cursor_last_recorded_at_ms)
        OR ((NEW.policy_generation != OLD.policy_generation OR NEW.recovery_generation != OLD.recovery_generation)
          AND NEW.cursor_uid IS NULL AND NEW.cursor_last_recorded_at_ms IS NULL)))
    OR (NEW.lease_epoch = OLD.lease_epoch AND NEW.lease_token IS OLD.lease_token
      AND NEW.policy_generation = OLD.policy_generation AND NEW.recovery_generation = OLD.recovery_generation
      AND OLD.lease_until_ms >
        (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
      AND NEW.lease_until_ms = 0
      AND (NEW.cursor_uid IS NULL OR OLD.cursor_uid IS NULL OR
        (NEW.cursor_last_recorded_at_ms, NEW.cursor_uid) > (OLD.cursor_last_recorded_at_ms, OLD.cursor_uid)))
  )
)
BEGIN SELECT RAISE(ABORT, 'kinde-inactivity-checkpoint-fenced'); END;
