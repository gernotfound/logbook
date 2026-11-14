import { activeSessionArgs, activeSessionPredicateSql, sessionFencedRequestHashSql, sessionFencedHashArgs } from '../auth/session-write-fence.mjs';

// D1 transport adapter: SQL has no access to the account data key or business plaintext.
// All queries bind values; writes require a trigger-guarded atomic D1 batch.
export async function readSnapshot(db, uid, consentRevision, fenceEpoch, paths, sessionHash) {
  const primary = db.withSession('first-primary');
  const statements = [
    primary.prepare(`SELECT s.revision, a.fence_epoch, a.consent_revision
      FROM sync_subjects a JOIN sync_state s ON s.uid = a.uid
      WHERE a.uid = ? AND a.status = 'active' AND a.consent_revision = ?
        AND a.fence_epoch = ? AND ${activeSessionPredicateSql}`)
      .bind(uid, consentRevision, fenceEpoch, ...activeSessionArgs(sessionHash, uid, fenceEpoch)),
    ...paths.map(path => primary.prepare("SELECT envelope_json, revision FROM sync_documents WHERE uid = ? AND path = ?").bind(uid, path)),
  ];
  const rows = await primary.batch(statements);
  const control = rows[0]?.results?.[0];
  if (!control) return null;
  const documents = paths.map((path, index) => {
    const row = rows[index + 1]?.results?.[0];
    return { path, revision: row?.revision ?? null, document: row ? JSON.parse(row.envelope_json) : null };
  });
  return { revision: control.revision, fenceEpoch: control.fence_epoch, consentRevision: control.consent_revision, documents };
}

// The replica register and sync revision are read inside one SQL snapshot.
// All future register/checkpoint/retirement writes MUST advance the revision.
export async function readReplicaControl(db, uid, consentRevision, fenceEpoch, sessionHash) {
  const primary = db.withSession('first-primary');
  const [head, list] = await primary.batch([
    primary.prepare(`SELECT s.revision, a.fence_epoch, a.consent_revision
      FROM sync_subjects a JOIN sync_state s ON s.uid = a.uid
      WHERE a.uid = ? AND a.status = 'active' AND a.consent_revision = ?
        AND a.fence_epoch = ? AND ${activeSessionPredicateSql}`)
      .bind(uid, consentRevision, fenceEpoch, ...activeSessionArgs(sessionHash, uid, fenceEpoch)),
    primary.prepare("SELECT slot, replica_id, generation, lease_until_ms, checkpoint_at_ms, checkpoint_clock_json, last_seq, status FROM sync_replicas WHERE uid = ? ORDER BY slot LIMIT 17")
      .bind(uid),
  ]);
  const control = head?.results?.[0];
  if (!control) return null;
  if (!list || !Array.isArray(list.results) || list.results.length > 16) {
    throw new Error('invalid-replica-register');
  }
  const replicas = {};
  for (const row of list.results) {
    if (Object.hasOwn(replicas, row.slot)) throw new Error('invalid-replica-register');
    replicas[row.slot] = {
      replicaId: row.replica_id,
      generation: row.generation,
      leaseUntilMs: row.lease_until_ms,
      checkpointAtMs: row.checkpoint_at_ms,
      checkpointClock: JSON.parse(row.checkpoint_clock_json),
      lastSeq: row.last_seq,
      status: row.status,
    };
  }
  return {
    revision: control.revision, fenceEpoch: control.fence_epoch,
    consentRevision: control.consent_revision, replicas,
  };
}

// A full checkpoint is collected in bounded, revision-fenced pages. Each D1
// batch is one SQL transaction: the control and its page share a consistent view.
// No page is authoritative on its own, and callers must reject stale revisions.
export async function readDocumentPage(db, uid, consentRevision, fenceEpoch, afterPath, expectedRevision, sessionHash) {
  const primary = db.withSession('first-primary');
  const pageSql = afterPath === null
    ? "SELECT path, envelope_json, revision FROM sync_documents WHERE uid = ? ORDER BY path LIMIT 9"
    : "SELECT path, envelope_json, revision FROM sync_documents WHERE uid = ? AND path > ? ORDER BY path LIMIT 9";
  const pageArgs = afterPath === null ? [uid] : [uid, afterPath];
  const [controlResult, pageResult] = await primary.batch([
    primary.prepare(`SELECT s.revision, a.fence_epoch, a.consent_revision
      FROM sync_subjects a JOIN sync_state s ON s.uid = a.uid
      WHERE a.uid = ? AND a.status = 'active' AND a.consent_revision = ?
        AND a.fence_epoch = ? AND ${activeSessionPredicateSql}`)
      .bind(uid, consentRevision, fenceEpoch, ...activeSessionArgs(sessionHash, uid, fenceEpoch)),
    primary.prepare(pageSql).bind(...pageArgs),
  ]);
  const control = controlResult?.results?.[0];
  if (!control) return { kind: 'access-revoked' };
  if (expectedRevision !== null && control.revision !== expectedRevision) {
    return { kind: 'snapshot-changed' };
  }
  const all = pageResult.results;
  const hasMore = all.length > 8;
  const items = all.slice(0, 8).map(row => ({
    path: row.path,
    revision: row.revision,
    document: JSON.parse(row.envelope_json),
  }));
  return {
    kind: 'page', revision: control.revision, fenceEpoch: control.fence_epoch,
    consentRevision: control.consent_revision, documents: items, nextAfter: hasMore ? items.at(-1).path : null, complete: !hasMore,
  };
}

export async function readReceipt(db, uid, consentRevision, fenceEpoch, batchId, sessionHash) {
  return db.withSession('first-primary').prepare(`SELECT r.request_hash,
    r.committed_revision, r.last_seq, r.consent_revision, r.slot, r.replica_id,
    r.generation FROM sync_receipts r
    JOIN sync_subjects a ON a.uid = r.uid
    WHERE r.uid = ? AND r.batch_id = ? AND a.status = 'active'
      AND a.consent_revision = ? AND a.fence_epoch = ?
      AND r.consent_revision = a.consent_revision
      AND r.fence_epoch = a.fence_epoch AND ${activeSessionPredicateSql}`)
    .bind(uid, batchId, consentRevision, fenceEpoch, ...activeSessionArgs(sessionHash, uid, fenceEpoch)).first();
}

/**
 * A single primary SQL read couples the authoritative revision with the
 * immutable receipt. Receipt absence alone is never non-commit evidence.
 */
export async function readCommitOutcome(db, uid, consentRevision, fenceEpoch, batchId, sessionHash) {
  if (typeof db.withSession !== 'function') throw new Error('primary-d1-session-unavailable');
  const primary = db.withSession('first-primary');
  return primary.prepare(`SELECT s.revision AS current_revision,
    r.request_hash AS existing_hash,
    r.expected_revision AS existing_expected_revision,
    r.consent_revision AS existing_consent_revision,
    r.fence_epoch AS existing_fence_epoch
    FROM sync_subjects a
    JOIN sync_state s ON s.uid = a.uid
    LEFT JOIN sync_receipts r ON r.uid = a.uid AND r.batch_id = ?
    WHERE a.uid = ? AND a.status = 'active'
      AND a.consent_revision = ? AND a.fence_epoch = ?
      AND ${activeSessionPredicateSql}`)
    .bind(batchId, uid, consentRevision, fenceEpoch,
      ...activeSessionArgs(sessionHash, uid, fenceEpoch)).first();
}

export async function readAccessState(db, uid, fenceEpoch, sessionHash) {
  return db.withSession('first-primary').prepare(`SELECT a.status,
    a.consent_revision, a.fence_epoch, s.revision
    FROM sync_subjects a JOIN sync_state s ON a.uid = s.uid
    WHERE a.uid = ? AND ${activeSessionPredicateSql}`)
    .bind(uid, ...activeSessionArgs(sessionHash, uid, fenceEpoch)).first();
}

export async function commitEncryptedBatch(db, uid, fenceEpoch, attempt, hash, sessionHash) {
  const { batchId, expectedRevision, consentRevision, replica, lastSeq, documents } = attempt;
  const nextRevision = expectedRevision + 1;
  // A silent no-op UPDATE is NOT a CAS primitive. The trigger on this first
  // INSERT aborts the D1 transaction when ownership, consent, lease or revision
  // changed; D1 batch rolls back all later statements on any failure.
  const statements = [
    db.prepare(`INSERT INTO sync_receipts
      (uid,batch_id,request_hash,expected_revision,committed_revision,
       consent_revision,fence_epoch,slot,replica_id,generation,last_seq,document_count)
      VALUES (?, ?, ${sessionFencedRequestHashSql}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(uid, batchId, ...sessionFencedHashArgs(sessionHash, uid, fenceEpoch, hash),
        expectedRevision, nextRevision, consentRevision, fenceEpoch,
        replica.slot, replica.replicaId, replica.generation, lastSeq, documents.length),
    ...documents.map(({ path, document }) =>
      db.prepare("INSERT INTO sync_documents (uid, path, envelope_json, revision) VALUES (?, ?, ?, ?) ON CONFLICT(uid, path) DO UPDATE SET envelope_json = excluded.envelope_json, revision = excluded.revision")
        .bind(uid, path, JSON.stringify(document), nextRevision)),
    db.prepare("UPDATE sync_replicas SET last_seq = ? WHERE uid = ? AND slot = ? AND replica_id = ? AND generation = ? AND last_seq <= ?")
      .bind(lastSeq, uid, replica.slot, replica.replicaId, replica.generation, lastSeq),
    db.prepare("UPDATE sync_state SET revision = ? WHERE uid = ? AND revision = ?")
      .bind(nextRevision, uid, expectedRevision),
  ];
  await db.batch(statements);
  return { revision: nextRevision, lastSeq, batchId };
}
