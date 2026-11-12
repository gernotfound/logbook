// Isolated synthetic D1 probe, never imported by the production PWA.
const PROBE_OWNER = 'cf00-synthetic-owner';
const PROBE_EPOCH = 7;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS cf00_control (
      owner TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK (revision >= 0),
      consent_epoch INTEGER NOT NULL CHECK (consent_epoch >= 1)
    )`,
  `CREATE TABLE IF NOT EXISTS cf00_receipt (
      owner TEXT NOT NULL, batch_id TEXT NOT NULL, writer TEXT NOT NULL, expected_rev INTEGER NOT NULL,
      consent_epoch INTEGER NOT NULL, committed_rev INTEGER NOT NULL,
      PRIMARY KEY (owner, batch_id)
    )`,
  `CREATE TABLE IF NOT EXISTS cf00_document (
      owner TEXT NOT NULL, path TEXT NOT NULL, ciphertext TEXT NOT NULL,
      revision INTEGER NOT NULL, PRIMARY KEY (owner, path)
    )`,
  `CREATE TRIGGER IF NOT EXISTS cf00_guard BEFORE INSERT ON cf00_receipt
   BEGIN
     SELECT CASE WHEN NOT EXISTS (
       SELECT 1 FROM cf00_control WHERE owner = NEW.owner
         AND revision = NEW.expected_rev AND consent_epoch = NEW.consent_epoch
     ) THEN RAISE(ABORT, 'cf00-stale-revision-or-consent') END;
   END`,
];

export async function prepareFixture(db) {
  const statements = SCHEMA.map(sql => db.prepare(sql));
  await db.batch(statements);
  await db.batch([
    db.prepare('DELETE FROM cf00_document WHERE owner = ?').bind(PROBE_OWNER),
    db.prepare('DELETE FROM cf00_receipt WHERE owner = ?').bind(PROBE_OWNER),
    db.prepare(`INSERT INTO cf00_control (owner, revision, consent_epoch) VALUES (?, 0, ?)
      ON CONFLICT(owner) DO UPDATE SET revision = 0, consent_epoch = excluded.consent_epoch`).bind(PROBE_OWNER, PROBE_EPOCH),
  ]);
}

function isSafeAttempt(attempt) {
  return attempt && typeof attempt === 'object' && !Array.isArray(attempt)
    && /^[a-z][a-z0-9-]{0,31}$/.test(attempt.writer)
    && /^[a-zA-Z0-9_-]{16,64}$/.test(attempt.batchId)
    && Number.isSafeInteger(attempt.expectedRev) && attempt.expectedRev >= 0
    && Number.isSafeInteger(attempt.consentEpoch) && attempt.consentEpoch >= 1;
}

export async function commitSyntheticBatch(db, attempt) {
  if (!isSafeAttempt(attempt)) throw new TypeError('Invalid synthetic transaction');
  const { writer, batchId, expectedRev, consentEpoch } = attempt;
  // A no-op UPDATE cannot fail a D1 batch; the guard trigger must abort it.
  return db.batch([
    db.prepare(`INSERT INTO cf00_receipt
      (owner, batch_id, writer, expected_rev, consent_epoch, committed_rev)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(PROBE_OWNER, batchId, writer, expectedRev, consentEpoch, expectedRev + 1),
    db.prepare(`INSERT INTO cf00_document (owner, path, ciphertext, revision)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(owner, path) DO UPDATE SET ciphertext = excluded.ciphertext,
        revision = excluded.revision`).bind(PROBE_OWNER, writer, 'synthetic-ciphertext-only', expectedRev + 1),
    db.prepare(`UPDATE cf00_control SET revision = revision + 1
      WHERE owner = ? AND revision = ? AND consent_epoch = ?`).bind(PROBE_OWNER, expectedRev, consentEpoch),
  ]);
}

export async function readReceipt(db, batchId) {
  if (typeof batchId !== 'string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(batchId)) throw new TypeError('Invalid batch ID');
  return db.prepare('SELECT writer, expected_rev, consent_epoch, committed_rev FROM cf00_receipt WHERE owner=? AND batch_id=?')
    .bind(PROBE_OWNER, batchId).first();
}

export async function readSyntheticState(db) {
  const control = await db.prepare('SELECT revision, consent_epoch FROM cf00_control WHERE owner=?')
    .bind(PROBE_OWNER).first();
  const docs = await db.prepare('SELECT path, revision FROM cf00_document WHERE owner=? ORDER BY path')
    .bind(PROBE_OWNER).all();
  return { control, docs: docs.results };
}
