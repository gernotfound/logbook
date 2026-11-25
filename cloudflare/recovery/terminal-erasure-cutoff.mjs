import { D1_NOW_MS } from '../sql/d1-time.mjs';
import {
  IndependentFenceUnavailableError, readOpenRecoveryGeneration, recordVerifiedTerminalErasure,
} from './independent-owner-fence.mjs';

const RECHECK_MS = 60_000;

// The caller must hold a current application lease in the key phase. The
// independent deny is one-way even if the next application write fails.
export async function armIndependentErasureCutoff(fenceDb, [uid, revision, epoch], generation) {
  const registry = fenceDb.withSession('first-primary');
  try {
    await registry.prepare(`
      INSERT INTO recovery_erasure_cutoffs (uid, consent_revision, fence_epoch)
      SELECT ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM recovery_control WHERE singleton = 1 AND mode = 'open' AND generation = ?
      ) AND NOT EXISTS (
        SELECT 1 FROM recovery_erasure_cutoffs
        WHERE uid = ? AND consent_revision = ? AND fence_epoch = ?
      )
    `).bind(uid, revision, epoch, generation, uid, revision, epoch).run();
  } catch {
    // The write may have committed. Only the independent primary can prove it.
  }
  const cutoff = await fenceDb.withSession('first-primary').prepare(`
    SELECT c.uid FROM recovery_erasure_cutoffs c
    JOIN recovery_owner_fences f ON f.uid = c.uid
    CROSS JOIN recovery_control r
    WHERE c.uid = ? AND c.consent_revision = ? AND c.fence_epoch = ?
      AND c.finalized = 0 AND r.singleton = 1 AND r.mode = 'open' AND r.generation = ?
      AND f.status IN ('blocked', 'withdrawn')
      AND f.consent_revision = c.consent_revision AND f.fence_epoch = c.fence_epoch
  `).bind(uid, revision, epoch, generation).first();
  if (cutoff?.uid !== uid) throw new IndependentFenceUnavailableError();
}

// A bounded retry runs on each scheduled invocation. Reserve the next
// attempt before crossing databases so an unavailable owner does not
// indefinitely hide other completed jobs. A missing proof stays pending.
export async function reconcileNextIndependentErasure(appDb, fenceDb, generation) {
  if (!appDb || !fenceDb || appDb === fenceDb
    || typeof appDb.withSession !== 'function' || typeof fenceDb.withSession !== 'function') {
    throw new IndependentFenceUnavailableError();
  }
  const registry = fenceDb.withSession('first-primary');
  await readOpenRecoveryGeneration(fenceDb, generation);
  const due = await registry.prepare(`
    UPDATE recovery_erasure_cutoffs SET next_check_ms = ${D1_NOW_MS} + ?
    WHERE (uid, consent_revision, fence_epoch) = (
      SELECT uid, consent_revision, fence_epoch FROM recovery_erasure_cutoffs
      WHERE finalized = 0 AND next_check_ms <= ${D1_NOW_MS}
        AND EXISTS (SELECT 1 FROM recovery_control WHERE singleton = 1 AND mode = 'open' AND generation = ?)
      ORDER BY next_check_ms, uid, consent_revision, fence_epoch LIMIT 1
    )
    RETURNING uid, consent_revision, fence_epoch
  `).bind(RECHECK_MS, generation).first();
  await readOpenRecoveryGeneration(fenceDb, generation);
  if (!due) return 'idle';
  // Only failures after reserving this specific retry are isolated. A failed
  // gate or ambiguous reservation still rejects the invocation immediately.
  try {
    const committed = await appDb.withSession('first-primary').prepare(`
      SELECT uid FROM health_erasure_finalizations
      WHERE uid = ? AND consent_revision = ? AND fence_epoch = ?
    `).bind(due.uid, due.consent_revision, due.fence_epoch).first();
    if (committed?.uid !== due.uid) {
      await readOpenRecoveryGeneration(fenceDb, generation);
      return 'pending';
    }
    await recordVerifiedTerminalErasure(appDb, fenceDb, due.uid, due, generation);
    return 'reconciled';
  } catch {
    // Only an owner-local failure can be isolated. A changed or unavailable
    // global gate must stop the invocation, not authorize a different owner.
    await readOpenRecoveryGeneration(fenceDb, generation);
    return 'blocked';
  }
}
