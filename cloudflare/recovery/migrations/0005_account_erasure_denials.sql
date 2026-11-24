-- This independent denial survives a rollback of the application database.
-- No provider subject, receipt or session credential is stored here.
CREATE TABLE recovery_account_erasure_denials (
  uid TEXT PRIMARY KEY CHECK (length(uid) = 45 AND substr(uid, 1, 2) = 'k_'
    AND substr(uid, 3) NOT GLOB '*[^A-Za-z0-9_-]*'),
  intent_digest TEXT NOT NULL CHECK (length(intent_digest) = 64
    AND intent_digest NOT GLOB '*[^0-9a-f]*')
) STRICT;

CREATE TRIGGER recovery_account_erasure_deny_insert
BEFORE INSERT ON recovery_account_erasure_denials
WHEN EXISTS (SELECT 1 FROM recovery_account_erasure_denials WHERE uid = NEW.uid)
  OR NOT EXISTS (SELECT 1 FROM recovery_control WHERE singleton = 1 AND mode = 'open')
BEGIN SELECT RAISE(ABORT, 'recovery-account-erasure-denial-fenced'); END;

CREATE TRIGGER recovery_account_erasure_block_fitness
AFTER INSERT ON recovery_account_erasure_denials
BEGIN
  UPDATE recovery_owner_fences SET status = 'blocked', change_seq = change_seq + 1
  WHERE uid = NEW.uid AND status = 'active';
END;

CREATE TRIGGER recovery_account_erasure_no_consent_reactivation
BEFORE UPDATE ON recovery_owner_fences
WHEN NEW.status = 'active' AND EXISTS (SELECT 1 FROM recovery_account_erasure_denials WHERE uid = OLD.uid)
BEGIN SELECT RAISE(ABORT, 'recovery-account-erasure-denial-fenced'); END;

CREATE TRIGGER recovery_account_erasure_deny_no_update
BEFORE UPDATE ON recovery_account_erasure_denials
BEGIN SELECT RAISE(ABORT, 'recovery-account-erasure-denial-immutable'); END;

CREATE TRIGGER recovery_account_erasure_deny_no_delete
BEFORE DELETE ON recovery_account_erasure_denials
BEGIN SELECT RAISE(ABORT, 'recovery-account-erasure-denial-immutable'); END;
