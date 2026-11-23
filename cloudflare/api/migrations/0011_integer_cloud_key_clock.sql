-- Use the same integer epoch milliseconds as D1_NOW_MS in d1-time.mjs.
-- Rounding a floating Julian date can place fresh verified consent 1 ms in
-- the future. Replacing these definitions changes no account or key rows.
DROP TRIGGER cloud_key_first_issuance;
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
        AND p.verified_at_ms <= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
        AND c.consent_revision = s.consent_revision AND c.over_18_confirmed = 1
        AND c.accepted_at_ms > 0
        AND c.accepted_at_ms <= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
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

DROP VIEW sync_writable_cloud_key;
CREATE VIEW sync_writable_cloud_key AS
SELECT s.uid, s.consent_revision
FROM sync_subjects s
JOIN auth_principals p ON p.uid = s.uid
JOIN health_consent_acceptances c ON c.uid = s.uid
JOIN cloud_account_keys k
  ON k.uid = s.uid AND k.consent_revision = s.consent_revision
JOIN cloud_key_issuance i
  ON i.uid = k.uid AND i.consent_revision = k.consent_revision
    AND i.issued_at_ms = k.issued_at_ms
WHERE s.status = 'active'
  AND p.status = 'active' AND p.auth_epoch = s.fence_epoch
  AND p.verified_at_ms IS NOT NULL
  AND p.verified_at_ms <= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
  AND c.consent_revision = s.consent_revision
  AND c.over_18_confirmed = 1
  AND c.accepted_at_ms > 0
  AND c.accepted_at_ms <= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
  AND NOT EXISTS (
    SELECT 1 FROM health_erasure_jobs j
    WHERE j.uid = s.uid AND j.status != 'complete'
  );
