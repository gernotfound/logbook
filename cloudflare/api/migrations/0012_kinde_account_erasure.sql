-- Encrypted address and request fences for account erasure on Kinde.
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

-- Separate from ordinary login state so a deletion attempt can never
-- create a normal login session. Only its original session may redeem it.
CREATE TABLE kinde_deletion_oauth_attempts (
  state_hash TEXT PRIMARY KEY CHECK (length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
  browser_hash TEXT NOT NULL CHECK (length(browser_hash) = 64 AND browser_hash NOT GLOB '*[^0-9a-f]*'),
  session_hash TEXT NOT NULL CHECK (length(session_hash) = 64 AND session_hash NOT GLOB '*[^0-9a-f]*'),
  uid TEXT NOT NULL REFERENCES auth_principals(uid) ON DELETE RESTRICT,
  auth_epoch INTEGER NOT NULL CHECK (auth_epoch >= 1),
  code_verifier TEXT NOT NULL CHECK (length(code_verifier) = 43 AND code_verifier NOT GLOB '*[^A-Za-z0-9_-]*'),
  nonce TEXT NOT NULL CHECK (length(nonce) = 43 AND nonce NOT GLOB '*[^A-Za-z0-9_-]*'),
  issued_at_ms INTEGER NOT NULL CHECK (issued_at_ms > 0),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms = issued_at_ms + 300000)
) STRICT;

CREATE INDEX kinde_deletion_oauth_expiry ON kinde_deletion_oauth_attempts (expires_at_ms);

-- This records an explicit, freshly reauthenticated request. A row proves
-- the owner's decision even if a cross-D1 call or its acknowledgement fails.
CREATE TABLE kinde_account_erasure_intents (
  uid TEXT PRIMARY KEY REFERENCES auth_principals(uid) ON DELETE RESTRICT,
  auth_epoch INTEGER NOT NULL CHECK (auth_epoch BETWEEN 1 AND 9007199254740990),
  receipt_hash TEXT NOT NULL UNIQUE CHECK (length(receipt_hash) = 64 AND receipt_hash NOT GLOB '*[^0-9a-f]*'),
  reauthenticated_at_ms INTEGER NOT NULL CHECK (reauthenticated_at_ms > 0 AND reauthenticated_at_ms % 1000 = 0),
  confirmed_at_ms INTEGER NOT NULL CHECK (
    confirmed_at_ms >= reauthenticated_at_ms AND confirmed_at_ms - reauthenticated_at_ms <= 300000
  )
) STRICT;

CREATE TRIGGER kinde_account_erasure_intent_fence
BEFORE INSERT ON kinde_account_erasure_intents
WHEN EXISTS (SELECT 1 FROM kinde_account_erasure_intents WHERE uid = NEW.uid OR receipt_hash = NEW.receipt_hash)
  OR NOT EXISTS (
    SELECT 1 FROM auth_principals p JOIN kinde_erasure_targets t ON t.uid = p.uid
    WHERE p.uid = NEW.uid AND p.status = 'active' AND p.auth_epoch = NEW.auth_epoch
  )
BEGIN SELECT RAISE(ABORT, 'kinde-account-erasure-intent-fenced'); END;

CREATE TRIGGER kinde_account_erasure_intent_immutable
BEFORE UPDATE ON kinde_account_erasure_intents
BEGIN SELECT RAISE(ABORT, 'kinde-account-erasure-intent-immutable'); END;

CREATE TRIGGER kinde_account_erasure_intent_no_early_delete
BEFORE DELETE ON kinde_account_erasure_intents
WHEN NOT EXISTS (SELECT 1 FROM auth_principals WHERE uid = OLD.uid AND status = 'deleted')
BEGIN SELECT RAISE(ABORT, 'kinde-account-erasure-intent-retained'); END;

-- A request proves acceptance and local access denial only. The separate
-- runner must still prove application erasure before invoking Kinde.
CREATE TABLE kinde_account_erasure_requests (
  uid TEXT PRIMARY KEY REFERENCES kinde_account_erasure_intents(uid) ON DELETE RESTRICT,
  prior_auth_epoch INTEGER NOT NULL CHECK (prior_auth_epoch BETWEEN 1 AND 9007199254740990),
  receipt_hash TEXT NOT NULL UNIQUE CHECK (length(receipt_hash) = 64 AND receipt_hash NOT GLOB '*[^0-9a-f]*'),
  reauthenticated_at_ms INTEGER NOT NULL CHECK (reauthenticated_at_ms > 0 AND reauthenticated_at_ms % 1000 = 0),
  requested_at_ms INTEGER NOT NULL CHECK (
    requested_at_ms >= reauthenticated_at_ms AND requested_at_ms - reauthenticated_at_ms <= 300000
  )
) STRICT;

CREATE TRIGGER kinde_account_erasure_request_fence
BEFORE INSERT ON kinde_account_erasure_requests
WHEN EXISTS (SELECT 1 FROM kinde_account_erasure_requests WHERE uid = NEW.uid OR receipt_hash = NEW.receipt_hash)
  OR NOT EXISTS (
    SELECT 1 FROM auth_principals p JOIN kinde_account_erasure_intents i ON i.uid = p.uid
    WHERE p.uid = NEW.uid AND p.status IN ('active', 'disabled')
      AND p.auth_epoch = NEW.prior_auth_epoch AND p.auth_epoch >= i.auth_epoch
      AND i.receipt_hash = NEW.receipt_hash AND i.reauthenticated_at_ms = NEW.reauthenticated_at_ms
      AND i.confirmed_at_ms = NEW.requested_at_ms
  )
BEGIN SELECT RAISE(ABORT, 'kinde-account-erasure-request-fenced'); END;

CREATE TRIGGER kinde_account_erasure_freeze
AFTER INSERT ON kinde_account_erasure_requests
BEGIN
  INSERT INTO health_erasure_jobs (uid, consent_revision, fence_epoch, requested_at_ms)
  SELECT uid, consent_revision, fence_epoch, NEW.requested_at_ms FROM sync_subjects
  WHERE uid = NEW.uid AND status = 'active';

  UPDATE auth_principals SET status = 'disabled', auth_epoch = auth_epoch + 1
  WHERE uid = NEW.uid AND status IN ('active', 'disabled') AND auth_epoch = NEW.prior_auth_epoch;
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'kinde-account-erasure-request-fenced') END;
  -- All current sessions are now denied. Physical cleanup belongs to the
  -- bounded runner because one owner may have many sessions.
END;

CREATE TRIGGER kinde_account_erasure_request_immutable
BEFORE UPDATE ON kinde_account_erasure_requests
BEGIN SELECT RAISE(ABORT, 'kinde-account-erasure-request-immutable'); END;

CREATE TRIGGER kinde_account_erasure_request_no_early_delete
BEFORE DELETE ON kinde_account_erasure_requests
WHEN NOT EXISTS (SELECT 1 FROM auth_principals WHERE uid = OLD.uid AND status = 'deleted')
BEGIN SELECT RAISE(ABORT, 'kinde-account-erasure-request-retained'); END;

CREATE TRIGGER kinde_account_erasure_disallow_reactivation
BEFORE UPDATE ON auth_principals
WHEN NEW.status = 'active' AND EXISTS (SELECT 1 FROM kinde_account_erasure_requests WHERE uid = OLD.uid)
BEGIN SELECT RAISE(ABORT, 'kinde-account-erasure-request-retained'); END;
