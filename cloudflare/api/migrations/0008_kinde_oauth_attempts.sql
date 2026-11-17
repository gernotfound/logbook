-- CF-03 OAuth state belongs to the trusted callback, never to a browser UID.
-- A single DELETE ... RETURNING claims the state once across concurrent Workers.
-- Verifiers/nonces are short-lived server-only material; an expired attempt
-- is never redeemable. Prune expired rows with a separate bounded job before GO.
CREATE TABLE auth_oauth_attempts (
  state_hash TEXT PRIMARY KEY CHECK (length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
  browser_hash TEXT NOT NULL CHECK (length(browser_hash) = 64 AND browser_hash NOT GLOB '*[^0-9a-f]*'),
  code_verifier TEXT NOT NULL CHECK (length(code_verifier) = 43 AND code_verifier NOT GLOB '*[^A-Za-z0-9_-]*'),
  nonce TEXT NOT NULL CHECK (length(nonce) = 43 AND nonce NOT GLOB '*[^A-Za-z0-9_-]*'),
  issued_at_ms INTEGER NOT NULL CHECK (issued_at_ms > 0),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > issued_at_ms AND expires_at_ms <= issued_at_ms + 600000)
);
CREATE INDEX auth_oauth_attempt_expiry ON auth_oauth_attempts (expires_at_ms);
