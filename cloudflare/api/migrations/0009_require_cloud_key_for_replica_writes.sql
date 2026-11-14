-- B-01: a stored issuance marker alone must never authorize replica writes.
-- This grant is for active fitness writes only. Rights-only reads, withdrawal,
-- bounded erasure DELETEs and final key destruction must not depend on it.
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
  AND p.verified_at_ms <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  AND c.consent_revision = s.consent_revision
  AND c.over_18_confirmed = 1
  AND c.accepted_at_ms > 0
  AND c.accepted_at_ms <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  AND NOT EXISTS (
    SELECT 1 FROM health_erasure_jobs j
    WHERE j.uid = s.uid AND j.status != 'complete'
  );

-- The first receipt/mutation INSERT is the CAS fence for the entire D1 batch.
-- An aborted key guard must roll back every subsequent document/control write.
CREATE TRIGGER sync_receipt_requires_cloud_key BEFORE INSERT ON sync_receipts
BEGIN
  -- BEFORE INSERT runs before SQLite's OR REPLACE conflict handling. Refuse
  -- replacement of a historical receipt, even with an otherwise valid ADK.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM sync_receipts r WHERE r.uid = NEW.uid AND r.batch_id = NEW.batch_id
  ) THEN RAISE(ABORT, 'sync-receipt-immutable') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sync_writable_cloud_key
    WHERE uid = NEW.uid AND consent_revision = NEW.consent_revision
  ) THEN RAISE(ABORT, 'replica-cloud-key-required') END;
END;

CREATE TRIGGER sync_replica_mutation_requires_cloud_key BEFORE INSERT ON sync_replica_mutations
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM sync_replica_mutations m
    WHERE m.uid = NEW.uid AND m.mutation_id = NEW.mutation_id
  ) THEN RAISE(ABORT, 'sync-replica-mutation-immutable') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sync_writable_cloud_key
    WHERE uid = NEW.uid AND consent_revision = NEW.consent_revision
  ) THEN RAISE(ABORT, 'replica-cloud-key-required') END;
END;

-- Direct SQL and maintenance code cannot bypass the first-statement receipts
-- by writing the storage tables independently.
CREATE TRIGGER sync_document_insert_requires_cloud_key BEFORE INSERT ON sync_documents
WHEN NOT EXISTS (SELECT 1 FROM sync_writable_cloud_key WHERE uid = NEW.uid)
BEGIN SELECT RAISE(ABORT, 'replica-cloud-key-required'); END;

CREATE TRIGGER sync_document_update_requires_cloud_key BEFORE UPDATE ON sync_documents
WHEN NEW.uid != OLD.uid
  OR NOT EXISTS (SELECT 1 FROM sync_writable_cloud_key WHERE uid = OLD.uid)
BEGIN SELECT RAISE(ABORT, 'replica-cloud-key-required'); END;

CREATE TRIGGER sync_replica_insert_requires_cloud_key BEFORE INSERT ON sync_replicas
WHEN NOT EXISTS (SELECT 1 FROM sync_writable_cloud_key WHERE uid = NEW.uid)
BEGIN SELECT RAISE(ABORT, 'replica-cloud-key-required'); END;

CREATE TRIGGER sync_replica_update_requires_cloud_key BEFORE UPDATE ON sync_replicas
WHEN NEW.uid != OLD.uid
  OR NOT EXISTS (SELECT 1 FROM sync_writable_cloud_key WHERE uid = OLD.uid)
BEGIN SELECT RAISE(ABORT, 'replica-cloud-key-required'); END;

-- A direct global revision advance would prevent first ADK issuance forever.
-- Initial state creation with revision 0 remains valid before key provisioning;
-- erasure finalization may advance a withdrawn owner's control separately.
CREATE TRIGGER sync_state_initial_revision_zero BEFORE INSERT ON sync_state
WHEN NEW.revision != 0
  OR EXISTS (SELECT 1 FROM sync_state WHERE uid = NEW.uid)
BEGIN SELECT RAISE(ABORT, 'replica-cloud-key-required'); END;

CREATE TRIGGER sync_state_advance_requires_cloud_key BEFORE UPDATE ON sync_state
WHEN NEW.uid != OLD.uid
  OR (NEW.revision > OLD.revision
    AND EXISTS (SELECT 1 FROM sync_subjects s
      WHERE s.uid = OLD.uid AND s.status = 'active')
    AND NOT EXISTS (SELECT 1 FROM sync_writable_cloud_key WHERE uid = OLD.uid))
BEGIN SELECT RAISE(ABORT, 'replica-cloud-key-required'); END;

-- Removing an active owner's control row and recreating it at revision zero
-- would bypass CAS, even if all existing receipts remain untouched.
CREATE TRIGGER sync_state_delete_only_after_withdraw BEFORE DELETE ON sync_state
WHEN EXISTS (SELECT 1 FROM sync_subjects s WHERE s.uid = OLD.uid AND s.status = 'active')
BEGIN SELECT RAISE(ABORT, 'active-replica-delete'); END;

-- Content-bound receipts and the causal membership ledger are append-only
-- while active. The bounded erasure runner DELETEs them after withdrawal.
CREATE TRIGGER sync_receipt_immutable BEFORE UPDATE ON sync_receipts
BEGIN SELECT RAISE(ABORT, 'sync-receipt-immutable'); END;

CREATE TRIGGER sync_replica_mutation_immutable BEFORE UPDATE ON sync_replica_mutations
BEGIN SELECT RAISE(ABORT, 'sync-replica-mutation-immutable'); END;

CREATE TRIGGER sync_document_delete_only_after_withdraw BEFORE DELETE ON sync_documents
WHEN EXISTS (SELECT 1 FROM sync_subjects s WHERE s.uid = OLD.uid AND s.status = 'active')
BEGIN SELECT RAISE(ABORT, 'active-replica-delete'); END;

CREATE TRIGGER sync_replica_delete_only_after_withdraw BEFORE DELETE ON sync_replicas
WHEN EXISTS (SELECT 1 FROM sync_subjects s WHERE s.uid = OLD.uid AND s.status = 'active')
BEGIN SELECT RAISE(ABORT, 'active-replica-delete'); END;

CREATE TRIGGER sync_receipt_delete_only_after_withdraw BEFORE DELETE ON sync_receipts
WHEN EXISTS (SELECT 1 FROM sync_subjects s WHERE s.uid = OLD.uid AND s.status = 'active')
BEGIN SELECT RAISE(ABORT, 'active-replica-delete'); END;

CREATE TRIGGER sync_replica_mutation_delete_only_after_withdraw BEFORE DELETE ON sync_replica_mutations
WHEN EXISTS (SELECT 1 FROM sync_subjects s WHERE s.uid = OLD.uid AND s.status = 'active')
BEGIN SELECT RAISE(ABORT, 'active-replica-delete'); END;
