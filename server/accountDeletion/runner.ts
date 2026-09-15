import { randomUUID } from 'node:crypto';
import {
  acquireDeletionLease,
  deleteAuthUserLast,
  deletePrivateCollectionPage,
  deleteUserRoot,
  markDeletionComplete,
  markDeletionFailed,
  markVerifying,
  NonRetryableDeletionError,
  parkDeletion,
  readDeletionStatus,
  revokeAccountAccess,
  verifyNoAccountResidue,
} from './jobStore';
import { PRIVATE_ACCOUNT_COLLECTIONS, type AccountDeletionPublicStatus } from './types';

const SAFETY_BUFFER_MS = 8_000;

export type DeletionRunResult = 'complete' | 'pending' | 'failed' | 'busy';

function outOfBudget(deadlineMs: number): boolean {
  return Date.now() + SAFETY_BUFFER_MS >= deadlineMs;
}

export async function processAccountDeletion(
  uid: string,
  deadlineMs: number,
  leaseOwner = randomUUID(),
): Promise<DeletionRunResult> {
  if (outOfBudget(deadlineMs)) return 'pending';
  const acquired = await acquireDeletionLease(uid, leaseOwner, deadlineMs);
  if (!acquired) return 'busy';

  let phase = 'revoking';
  try {
    if (outOfBudget(deadlineMs)) {
      await parkDeletion(uid, 'deleting', { phase: 'revoking' });
      return 'pending';
    }
    await revokeAccountAccess(uid);

    for (const name of PRIVATE_ACCOUNT_COLLECTIONS) {
      phase = `collection:${name}`;
      let deletedBatches = 0;
      for (;;) {
        if (outOfBudget(deadlineMs)) {
          await parkDeletion(uid, 'deleting', { phase: 'collection', collection: name, deletedBatches });
          return 'pending';
        }
        const deleted = await deletePrivateCollectionPage(uid, name, deletedBatches + 1);
        if (deleted === 0) break;
        deletedBatches += 1;
      }
    }

    phase = 'root';
    if (outOfBudget(deadlineMs)) {
      await parkDeletion(uid, 'deleting', { phase: 'root' });
      return 'pending';
    }
    await deleteUserRoot(uid);

    phase = 'verification';
    await markVerifying(uid);
    if (outOfBudget(deadlineMs)) {
      await parkDeletion(uid, 'verifying', { phase: 'verifying' });
      return 'pending';
    }
    await verifyNoAccountResidue(uid);

    phase = 'auth';
    if (outOfBudget(deadlineMs)) {
      await parkDeletion(uid, 'verifying', { phase: 'auth' });
      return 'pending';
    }
    await deleteAuthUserLast(uid);
    await markDeletionComplete(uid);
    return 'complete';
  } catch (error) {
    const retryable = !(error instanceof NonRetryableDeletionError);
    try {
      await markDeletionFailed(uid, phase, error, retryable);
    } catch {
      // Preserve the original failure: a later poll/cron can recover an expired lease.
    }
    return 'failed';
  }
}

export async function progressAndReadStatus(
  uid: string,
  receiptToken: string,
  deadlineMs: number,
): Promise<AccountDeletionPublicStatus | null> {
  const before = await readDeletionStatus(uid, receiptToken);
  if (!before) return null;
  if (before.status === 'complete' || (before.status === 'failed' && before.retryable === false)) return before;

  await processAccountDeletion(uid, deadlineMs);
  return readDeletionStatus(uid, receiptToken);
}
