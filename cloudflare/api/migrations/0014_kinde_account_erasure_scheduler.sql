-- Candidate account-erasure sweep checkpoint. This lease serializes cursor
-- progress, not owner authorization or irreversible provider requests.
CREATE TABLE kinde_account_erasure_scheduler (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  cursor_uid TEXT CHECK (cursor_uid IS NULL OR (length(cursor_uid) = 45
    AND substr(cursor_uid, 1, 2) = 'k_' AND substr(cursor_uid, 3) NOT GLOB '*[^A-Za-z0-9_-]*')),
  lease_epoch INTEGER NOT NULL CHECK (lease_epoch BETWEEN 0 AND 9007199254740991),
  lease_token TEXT CHECK (lease_token IS NULL OR (length(lease_token) = 64 AND lease_token NOT GLOB '*[^0-9a-f]*')),
  lease_until_ms INTEGER NOT NULL CHECK (lease_until_ms >= 0),
  CHECK ((lease_epoch = 0 AND lease_token IS NULL AND lease_until_ms = 0)
    OR (lease_epoch > 0 AND lease_token IS NOT NULL))
) STRICT;

INSERT INTO kinde_account_erasure_scheduler VALUES (1, NULL, 0, NULL, 0);

CREATE TRIGGER kinde_account_erasure_scheduler_no_replace
BEFORE INSERT ON kinde_account_erasure_scheduler
WHEN EXISTS (SELECT 1 FROM kinde_account_erasure_scheduler)
BEGIN SELECT RAISE(ABORT, 'kinde-erasure-scheduler-immutable'); END;

CREATE TRIGGER kinde_account_erasure_scheduler_no_delete
BEFORE DELETE ON kinde_account_erasure_scheduler
BEGIN SELECT RAISE(ABORT, 'kinde-erasure-scheduler-immutable'); END;

CREATE TRIGGER kinde_account_erasure_scheduler_transition
BEFORE UPDATE ON kinde_account_erasure_scheduler
WHEN NEW.singleton != OLD.singleton OR NOT (
  (NEW.lease_epoch = OLD.lease_epoch + 1 AND NEW.lease_token IS NOT OLD.lease_token
    AND NEW.cursor_uid IS OLD.cursor_uid AND OLD.lease_until_ms <=
      (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
    AND NEW.lease_until_ms =
      (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)) + 60000)
  OR (NEW.lease_epoch = OLD.lease_epoch AND NEW.lease_token IS OLD.lease_token
    AND OLD.lease_until_ms >
      (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
    AND NEW.lease_until_ms = 0
    AND (NEW.cursor_uid IS NULL OR OLD.cursor_uid IS NULL OR NEW.cursor_uid > OLD.cursor_uid))
)
BEGIN SELECT RAISE(ABORT, 'kinde-erasure-scheduler-fenced'); END;
