-- DESTRUCTIVE: use ONLY on a disposable isolated D1 database, never live data.
-- D1 migrations are forward-only; this file is deliberately OUTSIDE migrations/.
DROP TRIGGER IF EXISTS sync_replica_mutation_fence;
DROP TRIGGER IF EXISTS sync_replica_no_regression;
DROP TRIGGER IF EXISTS sync_state_monotone;
DROP TABLE IF EXISTS sync_replica_mutations;
DROP TRIGGER IF EXISTS sync_receipt_fence;
DROP TABLE IF EXISTS sync_receipts;
DROP TABLE IF EXISTS sync_documents;
DROP TABLE IF EXISTS sync_replicas;
DROP TABLE IF EXISTS sync_state;
DROP TABLE IF EXISTS sync_subjects;
