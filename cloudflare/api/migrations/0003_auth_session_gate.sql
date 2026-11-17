-- CF-03: session-verification boundary for a future trusted Auth issuer.
-- No credentials, secrets or health plaintext live in these tables.
-- Creation of accounts/sessions is exclusively the responsibility of the trusted
-- signup/OAuth service; the private AUTH_GATE only reads them.
CREATE TABLE auth_principals (
  uid TEXT PRIMARY KEY CHECK (length(uid) BETWEEN 1 AND 128 AND instr(uid, '/') = 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'deleted')),
  verified_at_ms INTEGER CHECK (verified_at_ms > 0),
  auth_epoch INTEGER NOT NULL CHECK (auth_epoch >= 1)
);

CREATE TRIGGER auth_principal_fence BEFORE UPDATE ON auth_principals
WHEN NEW.uid != OLD.uid
  OR NEW.auth_epoch < OLD.auth_epoch
  OR (OLD.status = 'deleted' AND NEW.status != 'deleted')
  OR (OLD.status = 'disabled' AND NEW.status = 'active' AND NEW.auth_epoch <= OLD.auth_epoch)
  OR (OLD.verified_at_ms IS NOT NULL AND NEW.verified_at_ms IS NULL AND NEW.auth_epoch <= OLD.auth_epoch)
BEGIN
  SELECT RAISE(ABORT, 'auth-principal-regression');
END;

-- Only SHA-256 hashes of 32-byte random session and CSRF tokens are stored.
-- This table has no user-visible token issuance endpoint.
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  uid TEXT NOT NULL REFERENCES auth_principals(uid) ON DELETE RESTRICT,
  auth_epoch INTEGER NOT NULL CHECK (auth_epoch >= 1),
  csrf_hash TEXT NOT NULL CHECK (length(csrf_hash) = 64 AND csrf_hash NOT GLOB '*[^0-9a-f]*'),
  issued_at_ms INTEGER NOT NULL CHECK (issued_at_ms > 0),
  idle_expires_at_ms INTEGER NOT NULL CHECK (idle_expires_at_ms > issued_at_ms),
  absolute_expires_at_ms INTEGER NOT NULL CHECK (absolute_expires_at_ms >= idle_expires_at_ms),
  revoked_at_ms INTEGER CHECK (revoked_at_ms >= issued_at_ms)
);

CREATE INDEX auth_sessions_owner_epoch ON auth_sessions (uid, auth_epoch);
