// The separate registry is an independent,
// rollback-resistant floor only if its own IAM/restore lifecycle stays separate.
// Both databases must be read from first-primary; there is no cross-D1 transaction.
const STATUSES = new Set(['pending', 'active', 'blocked', 'withdrawn', 'deleted']);

export class IndependentFenceUnavailableError extends Error {
  constructor() {
    super('independent-recovery-fence-unavailable');
    this.name = 'IndependentFenceUnavailableError';
  }
}

function validUid(uid) {
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 128
    && uid.trim() === uid && !uid.includes('/');
}

function validFence(row) {
  return row && validUid(row.uid) && STATUSES.has(row.status)
    && Number.isSafeInteger(row.consentRevision) && row.consentRevision >= 0
    && Number.isSafeInteger(row.fenceEpoch) && row.fenceEpoch >= 1
    && Number.isSafeInteger(row.erasedBeforeRevision)
    && row.erasedBeforeRevision >= 0
    && row.erasedBeforeRevision <= row.consentRevision;
}

function primary(db) {
  if (!db || typeof db.withSession !== 'function') throw new IndependentFenceUnavailableError();
  const session = db.withSession('first-primary');
  if (!session || typeof session.prepare !== 'function') {
    throw new IndependentFenceUnavailableError();
  }
  return session;
}

function shape(row) {
  if (!row) return null;
  return {
    uid: row.uid, status: row.status, consentRevision: row.consent_revision,
    fenceEpoch: row.fence_epoch, erasedBeforeRevision: row.erased_before_revision,
    changeSeq: row.change_seq,
  };
}

async function readRegistry(db, uid, checkRights = false) {
  const cutoffSql = checkRights ? `, EXISTS (
    SELECT 1 FROM recovery_erasure_cutoffs c WHERE c.uid = f.uid
      AND c.consent_revision = f.consent_revision AND c.fence_epoch = f.fence_epoch
  ) AS erasure_cutoff` : '';
  const row = await primary(db).prepare(`SELECT c.mode, f.uid, f.status,
    f.consent_revision, f.fence_epoch, f.erased_before_revision, f.change_seq, c.generation${cutoffSql}
    FROM recovery_control c LEFT JOIN recovery_owner_fences f ON f.uid = ?
    WHERE c.singleton = 1`).bind(uid).first();
  return row ? { mode: row.mode, generation: row.generation,
    owner: row.uid ? shape(row) : null, erasureCutoff: row.erasure_cutoff } : null;
}

/**
 * A per-request external fence; caller MUST also prove the subject and
 * session in the application's primary D1 and recheck after async effects.
 * This function cannot grant access if the independent DB is sealed,
 * unavailable, lacks the owner, or differs from current main D1 evidence.
 */
export async function requireIndependentOwnerFence(fenceDb, subject, purpose = 'fitness', expectedRecoveryGeneration = null) {
  try {
    if (!validFence(subject) || !['fitness', 'rights', 'erasure', 'terminal'].includes(purpose)) {
      throw new IndependentFenceUnavailableError();
    }
    const current = await readRegistry(fenceDb, subject.uid, purpose === 'rights');
    const floor = current?.owner;
    const expected = purpose === 'erasure' && floor?.status === 'blocked'
      ? { ...subject, status: 'blocked' } : subject;
    if (expectedRecoveryGeneration !== null) requireOpenGeneration(current, expectedRecoveryGeneration);
    if (current?.mode !== 'open' || !matches(floor, expected)) {
      throw new IndependentFenceUnavailableError();
    }
    if (purpose === 'fitness' ? subject.status !== 'active'
      : subject.status !== 'withdrawn'
        || (purpose === 'rights' && current.erasureCutoff !== 0)
        || (purpose === 'erasure' && subject.erasedBeforeRevision >= subject.consentRevision)
        || (purpose === 'terminal'
          && (subject.consentRevision < 2 || subject.erasedBeforeRevision !== subject.consentRevision))) {
      throw new IndependentFenceUnavailableError();
    }
    return true;
  } catch {
    throw new IndependentFenceUnavailableError();
  }
}

// A generation change invalidates an in-flight runtime proof even if the
// registry has already reopened. Check it in the write itself and on readback.
function requireOpenGeneration(registry, expected = null) {
  if (registry?.mode !== 'open' || !Number.isSafeInteger(registry.generation)
    || registry.generation < 1 || (expected !== null && registry.generation !== expected)) {
    throw new IndependentFenceUnavailableError();
  }
  return registry.generation;
}

// Used by operations whose authority spans asynchronous application or
// provider work. A fresh open state alone cannot validate an old proof.
export async function readOpenRecoveryGeneration(db, expected = null) {
  try {
    const row = await primary(db).prepare('SELECT mode, generation FROM recovery_control WHERE singleton = 1').first();
    return requireOpenGeneration(row, expected);
  } catch {
    throw new IndependentFenceUnavailableError();
  }
}

async function applyTransition(db, before, after, generation = null) {
  const result = await primary(db).prepare(`UPDATE recovery_owner_fences SET
    status = ?, consent_revision = ?, fence_epoch = ?,
    erased_before_revision = ?, change_seq = change_seq + 1
    WHERE uid = ? AND status = ? AND consent_revision = ?
      AND fence_epoch = ? AND erased_before_revision = ?
      AND (? IS NULL OR EXISTS (SELECT 1 FROM recovery_control
        WHERE singleton = 1 AND mode = 'open' AND generation = ?))
    RETURNING uid`).bind(after.status, after.consentRevision,
    after.fenceEpoch, after.erasedBeforeRevision,
    before.uid, before.status, before.consentRevision,
    before.fenceEpoch, before.erasedBeforeRevision, generation, generation).first();
  if (result?.uid === before.uid) return;
  throw new IndependentFenceUnavailableError();
}

function matches(row, expected) {
  return !!row && row.uid === expected.uid && row.status === expected.status
    && row.consentRevision === expected.consentRevision
    && row.fenceEpoch === expected.fenceEpoch
    && row.erasedBeforeRevision === expected.erasedBeforeRevision;
}

// Called only after verified provider authentication, before provisioning the
// application health subject. An ambiguous write is reconciled by primary
// readback; it never creates an active/consented owner.
export async function enrollIndependentOwner(fenceDb, uid, epoch = 1, { requireOpen = false } = {}) {
  try {
    if (!validUid(uid) || epoch !== 1) {
      throw new IndependentFenceUnavailableError();
    }
    const expected = {
      uid, status: 'pending', consentRevision: 0, fenceEpoch: epoch, erasedBeforeRevision: 0,
    };
    const existing = await readRegistry(fenceDb, uid);
    if (!existing || !['sealed', 'open'].includes(existing.mode)
      || (requireOpen && existing.mode !== 'open')) {
      throw new IndependentFenceUnavailableError();
    }
    const generation = requireOpen ? requireOpenGeneration(existing) : null;
    if (existing.owner && !matches(existing.owner, expected)) {
      throw new IndependentFenceUnavailableError();
    }
    if (!existing.owner) {
      try {
        await primary(fenceDb).prepare(`INSERT INTO recovery_owner_fences
          (uid,status,consent_revision,fence_epoch,erased_before_revision,change_seq)
          SELECT ?,'pending',0,1,0,1 WHERE ? IS NULL OR EXISTS (
            SELECT 1 FROM recovery_control WHERE singleton = 1 AND mode = 'open' AND generation = ?
          )`).bind(uid, generation, generation).run();
      } catch {
        // A concurrent enrollment may have committed, but only the primary
        // readback below can distinguish it from an unavailable write.
      }
    }
    const readback = await readRegistry(fenceDb, uid);
    if (requireOpen) requireOpenGeneration(readback, generation);
    if (!matches(readback?.owner, expected)) {
      throw new IndependentFenceUnavailableError();
    }
    return expected;
  } catch {
    throw new IndependentFenceUnavailableError();
  }
}

// Call ONLY after an authoritative primary SQL read of first accepted consent.
// A D1 commit can precede this registry advancement; that gap is denied access.
export async function recordVerifiedInitialConsent(appDb, fenceDb, uid, { requireOpen = false } = {}) {
  try {
    if (!validUid(uid)) throw new IndependentFenceUnavailableError();
    const generation = requireOpen ? requireOpenGeneration(await readRegistry(fenceDb, uid)) : null;
    const verified = await primary(appDb).prepare(`SELECT s.uid, s.status,
      s.consent_revision, s.fence_epoch, s.erased_before_revision
      FROM sync_subjects s JOIN health_consent_acceptances c ON c.uid = s.uid
      JOIN auth_principals p ON p.uid = s.uid
      WHERE s.uid = ? AND s.status = 'active'
        AND s.consent_revision = 1 AND s.erased_before_revision = 0
        AND c.consent_revision = 1 AND c.over_18_confirmed = 1
        AND p.status = 'active' AND p.verified_at_ms IS NOT NULL
        AND p.auth_epoch = s.fence_epoch`).bind(uid).first();
    if (!verified) throw new IndependentFenceUnavailableError();
    const next = shape(verified);
    const previous = { ...next, status: 'pending', consentRevision: 0 };
    const registry = await readRegistry(fenceDb, uid);
    if (requireOpen) requireOpenGeneration(registry, generation);
    const existing = registry?.owner;
    if (!matches(existing, next)) {
      if (!matches(existing, previous)) throw new IndependentFenceUnavailableError();
      try { await applyTransition(fenceDb, previous, next, generation); }
      catch {
        // A concurrent write or lost reply can only be reconciled from the
        // primary, under the same open generation for runtime callers.
        const readback = await readRegistry(fenceDb, uid);
        if (requireOpen) requireOpenGeneration(readback, generation);
        if (!matches(readback?.owner, next)) throw new IndependentFenceUnavailableError();
      }
    }
    if (requireOpen) {
      const readback = await readRegistry(fenceDb, uid);
      requireOpenGeneration(readback, generation);
      if (!matches(readback?.owner, next)) throw new IndependentFenceUnavailableError();
    }
    return next;
  } catch {
    throw new IndependentFenceUnavailableError();
  }
}

/**
 * This deny MUST become durable in the independent D1 BEFORE the application
 * D1 accepts any revocation request. If the second write fails, leave this
 * owner blocked until trusted reconciliation; never roll the deny back.
 */
export async function armIndependentHealthWithdrawal(fenceDb, activeSubject) {
  try {
    if (!validFence(activeSubject) || activeSubject.status !== 'active'
      || activeSubject.consentRevision < 1) throw new IndependentFenceUnavailableError();
    const next = { ...activeSubject, status: 'blocked' };
    const pending = { ...activeSubject, status: 'pending', consentRevision: 0 };
    // If first consent committed only in the application D1, let withdrawal
    // win without briefly promoting the pending floor to active.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = (await readRegistry(fenceDb, activeSubject.uid))?.owner;
      if (matches(current, next)) return next;
      if (!matches(current, activeSubject) && !matches(current, pending)) {
        throw new IndependentFenceUnavailableError();
      }
      try {
        await applyTransition(fenceDb, current, next);
        return next;
      } catch { /* Re-read after an ambiguous write or concurrent promotion. */ }
    }
    if (matches((await readRegistry(fenceDb, activeSubject.uid))?.owner, next)) return next;
    throw new IndependentFenceUnavailableError();
  } catch {
    throw new IndependentFenceUnavailableError();
  }
}

// Do not release rights unless the application SQL has independently
// persisted the withdrawal and a matching erasure job.
export async function recordVerifiedHealthWithdrawal(appDb, fenceDb, uid) {
  try {
    if (!validUid(uid)) throw new IndependentFenceUnavailableError();
    const row = await primary(appDb).prepare(`SELECT s.uid, s.status,
      s.consent_revision, s.fence_epoch, s.erased_before_revision
      FROM sync_subjects s JOIN health_erasure_jobs j ON j.uid = s.uid
      WHERE s.uid = ? AND s.status = 'withdrawn'
        AND j.consent_revision = s.consent_revision
        AND j.fence_epoch = s.fence_epoch
        AND j.status IN ('pending','processing')`).bind(uid).first();
    const next = shape(row);
    if (!validFence(next)) throw new IndependentFenceUnavailableError();
    const prev = { ...next, status: 'blocked' };
    const old = (await readRegistry(fenceDb, uid))?.owner;
    if (!matches(old, next)) {
      if (!matches(old, prev)) throw new IndependentFenceUnavailableError();
      try { await applyTransition(fenceDb, prev, next); }
      catch {
        if (!matches((await readRegistry(fenceDb, uid))?.owner, next)) throw new IndependentFenceUnavailableError();
      }
    }
    return next;
  } catch {
    throw new IndependentFenceUnavailableError();
  }
}

// Record the terminal floor only after the primary has proven every final
// effect. A failed independent write leaves the owner denied, not completed.
export async function recordVerifiedTerminalErasure(appDb, fenceDb, uid, expectedGeneration = null, expectedRecoveryGeneration = null) {
  try {
    if (!validUid(uid)) throw new IndependentFenceUnavailableError();
    const generation = requireOpenGeneration(await readRegistry(fenceDb, uid), expectedRecoveryGeneration);
    const row = await primary(appDb).prepare(`SELECT s.uid, s.status,
      s.consent_revision, s.fence_epoch, s.erased_before_revision
      FROM sync_subjects s
      JOIN health_erasure_finalizations f ON f.uid = s.uid
      JOIN health_erasure_jobs j ON j.uid = f.uid
        AND j.consent_revision = f.consent_revision
      WHERE s.uid = ? AND s.status = 'withdrawn'
        AND j.status = 'complete' AND j.phase = 'awaiting-keys'
        AND j.fence_epoch = f.fence_epoch AND j.lease_epoch = f.lease_epoch
        AND j.lease_token = f.lease_token
        AND j.completed_at_ms = f.completed_at_ms
        AND j.erased_before_revision = f.erased_before_revision
        AND j.key_disposition = f.key_disposition
        AND s.consent_revision = f.erased_before_revision
        AND s.fence_epoch = f.fence_epoch + 1
        AND s.erased_before_revision = f.erased_before_revision
        AND f.erased_before_revision = f.consent_revision + 1
        AND EXISTS (SELECT 1 FROM sync_state r
          WHERE r.uid = s.uid AND r.revision = f.sync_revision_at_erasure)
        AND NOT EXISTS (SELECT 1 FROM cloud_account_keys k WHERE k.uid = s.uid)
        AND NOT EXISTS (SELECT 1 FROM sync_documents d WHERE d.uid = s.uid)
        AND NOT EXISTS (SELECT 1 FROM sync_receipts r WHERE r.uid = s.uid)
        AND NOT EXISTS (SELECT 1 FROM sync_replica_mutations m WHERE m.uid = s.uid)
        AND NOT EXISTS (SELECT 1 FROM sync_replicas r WHERE r.uid = s.uid)
        AND (
          (f.key_disposition = 'destroyed' AND EXISTS (
            SELECT 1 FROM cloud_key_issuance i WHERE i.uid = s.uid
              AND i.consent_revision = f.consent_revision AND i.issued_at_ms = f.key_issued_at_ms
          ))
          OR (f.key_disposition = 'never-issued' AND NOT EXISTS (
            SELECT 1 FROM cloud_key_issuance i WHERE i.uid = s.uid AND i.consent_revision = f.consent_revision
          ))
        )
    `).bind(uid).first();
    const next = shape(row);
    if (!validFence(next) || next.consentRevision < 2
      || (expectedGeneration && (expectedGeneration.uid !== uid
        || expectedGeneration.consent_revision !== next.consentRevision - 1
        || expectedGeneration.fence_epoch !== next.fenceEpoch - 1))) {
      throw new IndependentFenceUnavailableError();
    }
    const registry = await readRegistry(fenceDb, uid);
    requireOpenGeneration(registry, generation);
    const old = registry?.owner;
    // This is already the exact primary readback after the application proof.
    // A transition or an ambiguous write still requires a fresh readback.
    if (matches(old, next)) return next;
    {
      const before = {
        uid, status: old?.status, consentRevision: next.consentRevision - 1,
        fenceEpoch: next.fenceEpoch - 1, erasedBeforeRevision: old?.erasedBeforeRevision,
      };
      if (!matches(old, before) || !['blocked', 'withdrawn'].includes(before.status)) {
        throw new IndependentFenceUnavailableError();
      }
      try { await applyTransition(fenceDb, before, next, generation); }
      catch { /* Only the exact primary readback below proves the result. */ }
    }
    const readback = await readRegistry(fenceDb, uid);
    requireOpenGeneration(readback, generation);
    if (!matches(readback?.owner, next)) throw new IndependentFenceUnavailableError();
    return next;
  } catch {
    throw new IndependentFenceUnavailableError();
  }
}
