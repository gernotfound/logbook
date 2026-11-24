-- Candidate foreground activity metadata. This has no cron, account-erasure
-- trigger, client-provided clock or default for unobserved owners.
CREATE TABLE kinde_account_activity (
  uid TEXT PRIMARY KEY REFERENCES auth_principals(uid) ON DELETE RESTRICT,
  first_observed_at_ms INTEGER NOT NULL CHECK (first_observed_at_ms > 0),
  last_recorded_at_ms INTEGER NOT NULL CHECK (last_recorded_at_ms >= first_observed_at_ms)
) STRICT;

CREATE INDEX kinde_account_activity_by_last_seen ON kinde_account_activity (last_recorded_at_ms, uid);

CREATE TRIGGER kinde_account_activity_insert_fence
BEFORE INSERT ON kinde_account_activity
WHEN NEW.first_observed_at_ms != NEW.last_recorded_at_ms
  OR NEW.last_recorded_at_ms !=
    (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
  OR NOT EXISTS (SELECT 1 FROM auth_principals WHERE uid = NEW.uid AND status = 'active')
BEGIN SELECT RAISE(ABORT, 'kinde-activity-fenced'); END;

CREATE TRIGGER kinde_account_activity_update_fence
BEFORE UPDATE ON kinde_account_activity
WHEN NEW.uid != OLD.uid OR NEW.first_observed_at_ms != OLD.first_observed_at_ms
  OR NEW.last_recorded_at_ms < OLD.last_recorded_at_ms
  OR NEW.last_recorded_at_ms !=
    (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
  OR NOT EXISTS (SELECT 1 FROM auth_principals WHERE uid = OLD.uid AND status = 'active')
BEGIN SELECT RAISE(ABORT, 'kinde-activity-fenced'); END;

CREATE TABLE kinde_inactivity_control (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  mode TEXT NOT NULL CHECK (mode IN ('paused', 'enabled')),
  generation INTEGER NOT NULL CHECK (generation >= 1)
) STRICT;

INSERT INTO kinde_inactivity_control VALUES (1, 'paused', 1);

CREATE TRIGGER kinde_inactivity_control_no_replace
BEFORE INSERT ON kinde_inactivity_control
WHEN EXISTS (SELECT 1 FROM kinde_inactivity_control)
BEGIN SELECT RAISE(ABORT, 'kinde-inactivity-control-immutable'); END;

CREATE TRIGGER kinde_inactivity_control_no_delete
BEFORE DELETE ON kinde_inactivity_control
BEGIN SELECT RAISE(ABORT, 'kinde-inactivity-control-immutable'); END;

CREATE TRIGGER kinde_inactivity_control_generation
BEFORE UPDATE ON kinde_inactivity_control
WHEN NEW.singleton != OLD.singleton OR NEW.generation != OLD.generation + 1
BEGIN SELECT RAISE(ABORT, 'kinde-inactivity-control-regression'); END;
