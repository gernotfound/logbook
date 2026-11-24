-- Encrypted address of the Kinde profile that may eventually be erased.
-- The verified callback derives uid from the same issuer and subject.
-- This additive migration neither enrolls nor modifies existing principals.
CREATE TABLE kinde_erasure_targets (
  uid TEXT PRIMARY KEY REFERENCES auth_principals(uid) ON DELETE RESTRICT
    CHECK (length(uid) = 45 AND substr(uid, 1, 2) = 'k_'
      AND substr(uid, 3) NOT GLOB '*[^A-Za-z0-9_-]*'),
  format_version INTEGER NOT NULL CHECK (format_version = 1),
  key_id TEXT NOT NULL CHECK (length(key_id) BETWEEN 1 AND 32
    AND key_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  iv TEXT NOT NULL CHECK (length(iv) = 16 AND iv NOT GLOB '*[^A-Za-z0-9+/]*'),
  ciphertext TEXT NOT NULL CHECK (length(ciphertext) BETWEEN 28 AND 192
    AND length(ciphertext) % 4 = 0 AND ciphertext NOT GLOB '*[^A-Za-z0-9+/=]*')
) STRICT;

CREATE TRIGGER kinde_erasure_target_insert_fence
BEFORE INSERT ON kinde_erasure_targets
WHEN EXISTS (SELECT 1 FROM kinde_erasure_targets WHERE uid = NEW.uid)
  OR NOT EXISTS (
    SELECT 1 FROM auth_principals
    WHERE uid = NEW.uid AND status = 'active' AND verified_at_ms IS NOT NULL
  )
BEGIN SELECT RAISE(ABORT, 'kinde-erasure-target-fenced'); END;

CREATE TRIGGER kinde_erasure_target_immutable
BEFORE UPDATE ON kinde_erasure_targets
BEGIN SELECT RAISE(ABORT, 'kinde-erasure-target-immutable'); END;

-- Keeping the target until account deletion finishes allows recovery from
-- a lost Management API reply without an email or untrusted target.
CREATE TRIGGER kinde_erasure_target_retention
BEFORE DELETE ON kinde_erasure_targets
WHEN NOT EXISTS (
  SELECT 1 FROM auth_principals WHERE uid = OLD.uid AND status = 'deleted'
)
BEGIN SELECT RAISE(ABORT, 'kinde-erasure-target-retained'); END;
