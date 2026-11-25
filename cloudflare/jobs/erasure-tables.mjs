// Explicit reviewed deletion allowlists. The schema inventory is deliberately
// independent: classifying a new table must not automatically authorize DELETE.
export const ACCOUNT_AUTH_CLEANUP_TABLES = Object.freeze([
  Object.freeze({ name: 'auth_sessions', key: 'token_hash' }),
  Object.freeze({ name: 'kinde_deletion_oauth_attempts', key: 'state_hash' }),
  Object.freeze({ name: 'kinde_account_activity', key: 'uid' }),
]);

export const HEALTH_DATA_CLEANUP_TABLES = Object.freeze([
  Object.freeze({ name: 'sync_documents', key: 'path' }),
  Object.freeze({ name: 'sync_receipts', key: 'batch_id' }),
  Object.freeze({ name: 'sync_replica_mutations', key: 'mutation_id' }),
  Object.freeze({ name: 'sync_replicas', key: 'slot' }),
]);

// All owner health children must be absent if the parent subject is absent.
// Proof and tombstone records are NOT a deletion allowlist.
export const HEALTH_CHILD_TABLES = Object.freeze([
  'sync_state', 'sync_documents', 'sync_receipts', 'sync_replicas', 'sync_replica_mutations',
  'health_consent_acceptances', 'health_erasure_jobs', 'health_erasure_finalizations',
  'cloud_account_keys', 'cloud_key_issuance',
]);
