// Candidate-only D1 membership writer. The caller verifies real Auth/consent,
// session-bound CSRF and a full AEAD-verified scan before allowing adoption.
// Public cloud clocks are queryable without decrypting business or field guards.
const SLOT = /^s(?:0[0-9]|1[0-5])$/;
const SLOT_IDS = Array.from({ length: 16 }, (_, i) => `s${String(i).padStart(2, '0')}`);
const LEASE_MS = 360 * 24 * 60 * 60 * 1000;
const SKEW_MS = 5 * 60 * 1000;

export async function readPublicCheckpointClock(db, uid) {
  const [integrity, clocks] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN json_type(envelope_json, '$._sync.clock') = 'object' THEN 0 ELSE 1 END) AS invalid FROM sync_documents WHERE uid = ?")
      .bind(uid),
    db.prepare("SELECT j.key AS slot, MAX(j.value) AS seq, MIN(j.type) AS min_type, MAX(j.type) AS max_type FROM sync_documents d, json_each(d.envelope_json, '$._sync.clock') j WHERE d.uid = ? GROUP BY j.key ORDER BY j.key LIMIT 17")
      .bind(uid),
  ]);
  if (!integrity?.results?.length || integrity.results[0].invalid !== 0 && integrity.results[0].invalid !== null
      || !Array.isArray(clocks?.results) || clocks.results.length > 16) {
    throw new Error('invalid-cloud-clock');
  }
  const clock = {};
  for (const row of clocks.results) {
    if (typeof row.slot !== 'string' || !SLOT.test(row.slot)
      || row.min_type !== 'integer' || row.max_type !== 'integer'
      || !Number.isSafeInteger(row.seq) || row.seq < 0 || Object.hasOwn(clock, row.slot)) {
      throw new Error('invalid-cloud-clock');
    }
    clock[row.slot] = row.seq;
  }
  return clock;
}

function chooseReplicaClaim(control, candidateId, current, checkpointClock, now) {
  const entries = control.replicas;
  const isEligible = entry => entry?.status === 'active' && entry.leaseUntilMs + SKEW_MS >= now;
  let match = null;
  if (current && entries[current.slot] && isEligible(entries[current.slot])
    && entries[current.slot].replicaId === current.replicaId
    && entries[current.slot].generation === current.generation) {
    match = current.slot;
  }
  if (!match) {
    const existing = Object.entries(entries).find(([, entry]) =>
      entry.replicaId === candidateId && isEligible(entry));
    if (existing) match = existing[0];
  }
  if (match) {
    const entry = entries[match];
    return {
      action: 'checkpoint', slot: match, replicaId: entry.replicaId,
      generation: entry.generation,
      lastSeq: Math.max(entry.lastSeq, checkpointClock[match] ?? 0),
    };
  }
  // A retired/expired incarnation must not be resurrected with its old ID.
  if (Object.values(entries).some(entry => entry.replicaId === candidateId)) return null;

  const available = SLOT_IDS.find(slot => !Object.hasOwn(entries, slot))
    ?? SLOT_IDS.find(slot => entries[slot].status === 'retired')
    ?? SLOT_IDS.find(slot => entries[slot].status === 'active'
      && entries[slot].leaseUntilMs + SKEW_MS < now);
  if (!available) return null;
  const old = entries[available];
  return {
    action: old ? 'reuse-expired' : 'register',
    slot: available, replicaId: candidateId, generation: (old?.generation ?? 0) + 1,
    lastSeq: Math.max(old?.lastSeq ?? 0, checkpointClock[available] ?? 0),
  };
}

// The receipt is immutable proof of an earlier mutation, NOT a current
// membership grant. A later business write, another claim or slot reuse must
// not erase evidence of the original commit. Only the same live consent/epoch
// can look it up; currentRevision/currentReplicaMatches fence local adoption.
export async function readReplicaMutationReceipt(db, uid, consentRevision, fenceEpoch, mutationId) {
  return db.prepare(`SELECT e.request_hash, e.action, e.committed_revision, e.slot,
    e.replica_id, e.generation, e.last_seq, e.checkpoint_at_ms, e.lease_until_ms
    , s.revision AS current_revision,
    CASE WHEN r.replica_id = e.replica_id AND r.generation = e.generation
      AND r.status = CASE WHEN e.action = 'retire' THEN 'retired' ELSE 'active' END
      THEN 1 ELSE 0 END AS current_replica_matches
    FROM sync_replica_mutations e
    JOIN sync_subjects a ON a.uid = e.uid
    JOIN sync_state s ON s.uid = e.uid
    LEFT JOIN sync_replicas r ON r.uid = e.uid AND r.slot = e.slot
    WHERE e.uid = ? AND e.mutation_id = ?
      AND a.status = 'active' AND a.consent_revision = ?
      AND a.fence_epoch = ? AND e.consent_revision = a.consent_revision
      AND e.fence_epoch = a.fence_epoch AND s.revision >= e.committed_revision`)
    .bind(uid, mutationId, consentRevision, fenceEpoch).first();
}

export function mutationResponse(mutationId, receipt, replayed) {
  return {
    mutationId, action: receipt.action, revision: receipt.committed_revision,
    replica: {
      slot: receipt.slot, replicaId: receipt.replica_id, generation: receipt.generation,
      leaseUntilMs: receipt.lease_until_ms, checkpointAtMs: receipt.checkpoint_at_ms,
    },
    baseSeq: receipt.last_seq, replayed,
    currentRevision: receipt.current_revision ?? receipt.committed_revision,
    // A historical receipt proves the original SQL transaction only. It is
    // never authorization to adopt membership after another revision/slot reuse.
    reconciliationRequired: (receipt.current_revision ?? receipt.committed_revision) !== receipt.committed_revision
      || receipt.current_replica_matches === 0,
  };
}

export async function writeReplicaMutation(db, uid, mutation) {
  const nextRevision = mutation.expectedRevision + 1;
  const params = [
    uid, mutation.mutationId, mutation.hash, mutation.action,
    mutation.expectedRevision, nextRevision, mutation.consentRevision, mutation.fenceEpoch,
    mutation.slot, mutation.replicaId, mutation.generation, mutation.lastSeq,
    mutation.checkpointAtMs, mutation.leaseUntilMs, JSON.stringify(mutation.checkpointClock),
  ];
  // First INSERT is a trigger-enforced CAS. Any later failure undoes the
  // membership mutation and its receipt in the same D1 transaction.
  const statements = [
    db.prepare("INSERT INTO sync_replica_mutations (uid,mutation_id,request_hash,action,expected_revision,committed_revision,consent_revision,fence_epoch,slot,replica_id,generation,last_seq,checkpoint_at_ms,lease_until_ms,checkpoint_clock_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(...params),
  ];
  if (mutation.action === 'retire') {
    statements.push(db.prepare("UPDATE sync_replicas SET status = 'retired' WHERE uid = ? AND slot = ? AND replica_id = ? AND generation = ? AND status = 'active'")
      .bind(uid, mutation.slot, mutation.replicaId, mutation.generation));
  } else {
    statements.push(db.prepare(`INSERT INTO sync_replicas
      (uid,slot,replica_id,generation,lease_until_ms,checkpoint_at_ms,checkpoint_clock_json,last_seq,status)
      VALUES (?,?,?,?,?,?,?,?,'active')
      ON CONFLICT(uid,slot) DO UPDATE SET replica_id=excluded.replica_id,
        generation=excluded.generation,lease_until_ms=excluded.lease_until_ms,
        checkpoint_at_ms=excluded.checkpoint_at_ms,
        checkpoint_clock_json=excluded.checkpoint_clock_json,last_seq=excluded.last_seq,status='active'`)
      .bind(uid, mutation.slot, mutation.replicaId, mutation.generation,
        mutation.leaseUntilMs, mutation.checkpointAtMs,
        JSON.stringify(mutation.checkpointClock), mutation.lastSeq));
  }
  statements.push(db.prepare("UPDATE sync_state SET revision = ? WHERE uid = ? AND revision = ?")
    .bind(nextRevision, uid, mutation.expectedRevision));
  await db.batch(statements);
  return {
    action: mutation.action, committed_revision: nextRevision, slot: mutation.slot,
    replica_id: mutation.replicaId, generation: mutation.generation, last_seq: mutation.lastSeq,
    checkpoint_at_ms: mutation.checkpointAtMs, lease_until_ms: mutation.leaseUntilMs,
  };
}

export function prepareReplicaClaim(control, checkpointClock, candidateReplicaId, currentReplica) {
  const now = Date.now();
  const selected = chooseReplicaClaim(control, candidateReplicaId, currentReplica, checkpointClock, now);
  if (!selected) return null;
  return {
    ...selected, checkpointAtMs: now, leaseUntilMs: now + LEASE_MS,
    checkpointClock,
  };
}

export function prepareReplicaRetirement(control, replica) {
  const entry = control.replicas[replica.slot];
  if (!entry || entry.status !== 'active'
      || entry.replicaId !== replica.replicaId || entry.generation !== replica.generation
      || entry.leaseUntilMs + SKEW_MS >= Date.now()) return null;
  return {
    action: 'retire', ...replica, lastSeq: entry.lastSeq,
    checkpointAtMs: entry.checkpointAtMs, leaseUntilMs: entry.leaseUntilMs,
    checkpointClock: entry.checkpointClock,
  };
}
