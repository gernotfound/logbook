-- CF-08: INSERT OR REPLACE can delete a conflicting row without firing
-- DELETE triggers when SQLite recursive_triggers is OFF. A BEFORE INSERT guard
-- rejects that replacement BEFORE it can erase a monotone recovery floor.
-- Keep 0001 immutable: this additive migration is required on the isolated
-- registry before any owner is enrolled or the global gate is opened.
CREATE TRIGGER recovery_control_no_replace
BEFORE INSERT ON recovery_control
WHEN EXISTS (SELECT 1 FROM recovery_control
  WHERE singleton = NEW.singleton)
BEGIN SELECT RAISE(ABORT, 'recovery-control-exists'); END;

CREATE TRIGGER recovery_owner_no_replace
BEFORE INSERT ON recovery_owner_fences
WHEN EXISTS (SELECT 1 FROM recovery_owner_fences
  WHERE uid = NEW.uid)
BEGIN SELECT RAISE(ABORT, 'recovery-owner-exists'); END;
