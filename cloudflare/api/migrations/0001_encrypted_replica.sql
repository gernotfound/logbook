-- CF-01/02: versioned D1 schema. Encrypted business documents only; no health plaintext.
-- Account and replica rows are provisioned by a future trusted Auth/consent boundary,
-- never by the public document Worker.
CREATE TABLE sync_subjects (
  uid TEXT PRIMARY KEY CHECK (length(uid) BETWEEN 1 AND 128 AND instr(uid, '/') = 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'withdrawn', 'deleting', 'deleted')),
  consent_revision INTEGER NOT NULL CHECK (consent_revision >= 1),
  fence_epoch INTEGER NOT NULL CHECK (fence_epoch >= 1)
);

CREATE TABLE sync_state (
  uid TEXT PRIMARY KEY REFERENCES sync_subjects(uid) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE sync_replicas (
  uid TEXT NOT NULL REFERENCES sync_subjects(uid) ON DELETE RESTRICT,
  slot TEXT NOT NULL CHECK (slot GLOB 's0[0-9]' OR slot GLOB 's1[0-5]'),
  replica_id TEXT NOT NULL CHECK (length(replica_id) BETWEEN 1 AND 128),
  generation INTEGER NOT NULL CHECK (generation >= 1),
  lease_until_ms INTEGER NOT NULL CHECK (lease_until_ms > 0),
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  PRIMARY KEY (uid, slot)
);

CREATE TABLE sync_documents (
  uid TEXT NOT NULL REFERENCES sync_subjects(uid) ON DELETE RESTRICT,
  path TEXT NOT NULL,
  envelope_json TEXT NOT NULL CHECK (length(envelope_json) BETWEEN 1 AND 950000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  PRIMARY KEY (uid, path),
  CHECK (path = '' OR path GLOB 'history_months/[0-9][0-9][0-9][0-9]-[0-1][0-9]'
           OR path GLOB 'nutrition_months/[0-9][0-9][0-9][0-9]-[0-1][0-9]')
);

CREATE TABLE sync_receipts (
  uid TEXT NOT NULL REFERENCES sync_subjects(uid) ON DELETE RESTRICT,
  batch_id TEXT NOT NULL CHECK (length(batch_id) BETWEEN 16 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  committed_revision INTEGER NOT NULL CHECK (committed_revision = expected_revision + 1),
  consent_revision INTEGER NOT NULL CHECK (consent_revision >= 1),
  fence_epoch INTEGER NOT NULL CHECK (fence_epoch >= 1),
  slot TEXT NOT NULL,
  replica_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  last_seq INTEGER NOT NULL CHECK (last_seq > 0),
  document_count INTEGER NOT NULL CHECK (document_count BETWEEN 1 AND 8),
  PRIMARY KEY (uid, batch_id)
);

-- The first statement of each D1 batch MUST be the receipt insert.
-- A failed compare must abort the whole batch, not silently update zero rows.
-- SQLite serialization makes the following document/control writes atomic.
CREATE TRIGGER sync_receipt_fence BEFORE INSERT ON sync_receipts
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sync_subjects AS a
    JOIN sync_state AS s ON s.uid = a.uid
    JOIN sync_replicas AS r ON r.uid = a.uid
    WHERE a.uid = NEW.uid
      AND a.status = 'active'
      AND a.consent_revision = NEW.consent_revision
      AND a.fence_epoch = NEW.fence_epoch
      AND s.revision = NEW.expected_revision
      AND r.slot = NEW.slot
      AND r.replica_id = NEW.replica_id
      AND r.generation = NEW.generation
      AND r.status = 'active'
      AND r.last_seq < NEW.last_seq
      AND r.lease_until_ms > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  ) THEN RAISE(ABORT, 'sync-fenced') END;
END;

