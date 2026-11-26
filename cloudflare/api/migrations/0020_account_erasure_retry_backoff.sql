-- Candidate per-owner retry scheduling. This is not erasure authority:
-- the existing intent, recovery denial and owner leases remain mandatory.
CREATE TABLE kinde_account_erasure_retries (
  uid TEXT PRIMARY KEY REFERENCES kinde_account_erasure_intents(uid) ON DELETE CASCADE,
  failure_count INTEGER NOT NULL CHECK (failure_count BETWEEN 1 AND 7),
  retry_after_ms INTEGER NOT NULL CHECK (retry_after_ms BETWEEN 1 AND 9007199254740991)
) STRICT;

CREATE TRIGGER kinde_account_erasure_retry_no_terminal
BEFORE INSERT ON kinde_account_erasure_retries
WHEN EXISTS (SELECT 1 FROM kinde_account_erasure_completions WHERE uid = NEW.uid)
BEGIN SELECT RAISE(ABORT, 'kinde-erasure-retry-terminal'); END;

CREATE TRIGGER kinde_account_erasure_retry_terminal_cleanup
AFTER INSERT ON kinde_account_erasure_completions
BEGIN DELETE FROM kinde_account_erasure_retries WHERE uid = NEW.uid; END;
