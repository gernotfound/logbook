-- CF-05 fresh-start key custody: wrapped random ADK only, never business plaintext.
-- Neither this schema nor its triggers publishes a key-release Worker route.
-- An issuance marker survives key erasure to prohibit silent same-generation rekey.
CREATE TABLE cloud_key_issuance (
  uid TEXT NOT NULL REFERENCES sync_subjects(uid) ON DELETE RESTRICT,
  consent_revision INTEGER NOT NULL CHECK (consent_revision >= 1),
  issued_at_ms INTEGER NOT NULL CHECK (issued_at_ms > 0),
  PRIMARY KEY (uid, consent_revision)
);

CREATE TRIGGER cloud_key_issuance_immutable_update BEFORE UPDATE ON cloud_key_issuance
BEGIN SELECT RAISE(ABORT, 'cloud-key-issuance-immutable'); END;
CREATE TRIGGER cloud_key_issuance_immutable_delete BEFORE DELETE ON cloud_key_issuance
BEGIN SELECT RAISE(ABORT, 'cloud-key-issuance-immutable'); END;

CREATE TABLE cloud_account_keys (
  uid TEXT PRIMARY KEY REFERENCES sync_subjects(uid) ON DELETE RESTRICT,
  consent_revision INTEGER NOT NULL CHECK (consent_revision >= 1),
  format TEXT NOT NULL CHECK (format = 'thelogbook-wrapped-account-key'),
  version INTEGER NOT NULL CHECK (version = 1),
  key_version INTEGER NOT NULL CHECK (key_version = 1),
  iv TEXT NOT NULL CHECK (length(iv) = 16),
  ciphertext TEXT NOT NULL CHECK (length(ciphertext) = 44),
  tag TEXT NOT NULL CHECK (length(tag) = 24),
  issued_at_ms INTEGER NOT NULL CHECK (issued_at_ms > 0)
);

-- The first issuance must happen before ANY encrypted document or replica
-- change, and only with a fresh explicit consent and no unfinished erasure.
-- SQL guard remains effective even if a future application handler is flawed.
CREATE TRIGGER cloud_key_first_issuance BEFORE INSERT ON cloud_account_keys
BEGIN
  SELECT CASE WHEN
    EXISTS (SELECT 1 FROM cloud_key_issuance i
      WHERE i.uid = NEW.uid AND i.consent_revision = NEW.consent_revision)
    OR NOT EXISTS (
      SELECT 1 FROM sync_subjects s
      JOIN sync_state state ON state.uid = s.uid
      JOIN health_consent_acceptances c ON c.uid = s.uid
      JOIN auth_principals p ON p.uid = s.uid
      WHERE s.uid = NEW.uid AND s.status = 'active'
        AND s.consent_revision = NEW.consent_revision
        AND s.fence_epoch = p.auth_epoch
        AND p.status = 'active' AND p.verified_at_ms IS NOT NULL
        AND p.verified_at_ms <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
        AND c.consent_revision = NEW.consent_revision AND c.over_18_confirmed = 1
        AND c.accepted_at_ms > 0 AND c.accepted_at_ms <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
        AND state.revision = 0
    )
    OR EXISTS (SELECT 1 FROM sync_documents WHERE uid = NEW.uid)
    OR EXISTS (SELECT 1 FROM sync_replicas WHERE uid = NEW.uid)
    OR EXISTS (SELECT 1 FROM sync_receipts WHERE uid = NEW.uid)
    OR EXISTS (SELECT 1 FROM sync_replica_mutations WHERE uid = NEW.uid)
    OR EXISTS (SELECT 1 FROM health_erasure_jobs j
      WHERE j.uid = NEW.uid AND j.status != 'complete')
  THEN RAISE(ABORT, 'cloud-key-provision-fenced') END;
END;

CREATE TRIGGER cloud_key_issue_marker AFTER INSERT ON cloud_account_keys
BEGIN
  INSERT INTO cloud_key_issuance(uid, consent_revision, issued_at_ms)
  VALUES (NEW.uid, NEW.consent_revision, NEW.issued_at_ms);
END;

-- In-place ciphertext replacement or key-version upgrade requires a dedicated
-- rewrap/rotation protocol. Blind overwrite would permanently lose the ADK.
CREATE TRIGGER cloud_key_no_update BEFORE UPDATE ON cloud_account_keys
BEGIN SELECT RAISE(ABORT, 'cloud-key-immutable'); END;

-- Key deletion is permitted only after a withdrawn owner's bounded erasure
-- runner has reached the keys phase with a still-live lease. Finalizing the
-- job and permanently excluding restore/resurrection are future CF-06/08 gates.
CREATE TRIGGER cloud_key_erasure_only BEFORE DELETE ON cloud_account_keys
WHEN NOT EXISTS (
  SELECT 1 FROM health_erasure_jobs j
  JOIN sync_subjects s ON s.uid = j.uid
  WHERE j.uid = OLD.uid AND j.consent_revision = OLD.consent_revision
    AND j.status = 'processing' AND j.phase = 'awaiting-keys'
    AND j.lease_epoch > 0 AND j.lease_token IS NOT NULL
    AND j.lease_until_ms > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    AND s.status = 'withdrawn'
    AND s.consent_revision = j.consent_revision
    AND s.fence_epoch = j.fence_epoch
)
BEGIN SELECT RAISE(ABORT, 'cloud-key-erasure-fenced'); END;
