import { readOpenRecoveryGeneration } from '../recovery/independent-owner-fence.mjs';
import { readKindeInactivityCandidates } from './kinde-inactivity-candidates.mjs';
import { recordKindeInactivityErasureIntent } from './kinde-inactivity-enqueue.mjs';

/** @typedef {{policyGeneration: number, recoveryGeneration: number, after: NonNullable<Parameters<typeof readKindeInactivityCandidates>[1]>}} EnqueueCursor */

/**
 * One bounded traversal step for the future inactivity enqueue scheduler.
 * A separate durable scheduler must own this cursor and its lease; never
 * persist it in the diagnostic checkpoint. The SQL decision, not the
 * traversal cursor, authorizes the owner freeze. No cleanup is performed.
 * @param {Parameters<typeof readKindeInactivityCandidates>[0]} db
 * @param {Parameters<typeof readOpenRecoveryGeneration>[0]} recoveryDb
 * @param {number} policyGeneration
 * @param {number} recoveryGeneration external trusted pin
 * @param {EnqueueCursor | null} [cursor]
 */
export async function scanKindeInactivityEnqueueStep(db, recoveryDb, policyGeneration, recoveryGeneration, cursor = null) {
  if (!db || !recoveryDb || db === recoveryDb
    || !Number.isSafeInteger(policyGeneration) || policyGeneration < 1
    || !Number.isSafeInteger(recoveryGeneration) || recoveryGeneration < 1
    || (cursor !== null && (cursor.policyGeneration !== policyGeneration
      || cursor.recoveryGeneration !== recoveryGeneration || !cursor.after))) {
    throw new Error('kinde-inactivity-enqueue-scanner-unavailable');
  }
  async function requireCurrentPolicy() {
    await readOpenRecoveryGeneration(recoveryDb, recoveryGeneration);
    const control = await db.withSession('first-primary').prepare(
      'SELECT mode, generation FROM kinde_inactivity_control WHERE singleton = 1',
    ).bind().first();
    if (control?.mode !== 'enabled' || control.generation !== policyGeneration) {
      throw new Error('kinde-inactivity-enqueue-scanner-unavailable');
    }
    await readOpenRecoveryGeneration(recoveryDb, recoveryGeneration);
  }

  await requireCurrentPolicy();
  const page = await readKindeInactivityCandidates(db, cursor?.after ?? null, policyGeneration);
  if (page.candidates.some(candidate => candidate.generation !== policyGeneration)) {
    throw new Error('kinde-inactivity-enqueue-scanner-unavailable');
  }
  const candidate = page.candidates[0];
  const intent = candidate
    ? await recordKindeInactivityErasureIntent(db, recoveryDb, candidate, recoveryGeneration)
    : null;
  await requireCurrentPolicy();

  // At most one decision per invocation. Never skip the unprocessed suffix
  // of a page, including when the first candidate is no longer eligible.
  const after = page.candidates.length > 1
    ? { uid: candidate.uid, lastRecordedAtMs: candidate.lastRecordedAtMs }
    : page.nextCursor;
  return {
    decision: candidate ? (intent ? 'recorded' : 'not-recorded') : 'none',
    nextCursor: after === null ? null : { policyGeneration, recoveryGeneration, after },
  };
}
