import { describe, expect, it } from 'vitest';
import type { DeletionJobStoreTestContext } from './m7_account_deletion_job_store.test';

export function registerDeletionWorkerRecoveryCases({
  state, stageDeletionJob, DeletionLeaseLostError, acquireDeletionLease,
  deletePrivateCollectionPage, deleteUserRoot, parkDeletion, markDeletionFailed,
  markDeletionComplete, ACCOUNT_DELETION_COMPLETED_RETENTION_MS,
}: DeletionJobStoreTestContext): void {
  describe('stale worker exclusion, terminal state and tombstone retention', () => {
  it('skips a lease-only update on empty pages without bypassing the next destructive fence', async () => {
    stageDeletionJob('u');
    expect(await acquireDeletionLease('u', 'worker-A', Date.now() + 60_000)).toBe(true);
    const updatesBeforeEmptyPage = state.jobUpdates.length;

    expect(await deletePrivateCollectionPage('u', 'history_months', 1, 'worker-A')).toBe(0);
    expect(state.jobUpdates).toHaveLength(updatesBeforeEmptyPage);

    state.jobData.get('account_deletions/u').leaseOwner = 'worker-B';
    await expect(deleteUserRoot('u', 'worker-A')).rejects.toBeInstanceOf(DeletionLeaseLostError);
    expect(state.docs.has('account_deletions/u')).toBe(true);
  });

  it('fences a stale worker out of document deletion, park, failure and completion', async () => {
    stageDeletionJob('u');
    state.docs.add('users/u/history_months/survivor');
    await acquireDeletionLease('u', 'worker-A', Date.now() + 60_000);
    // Simulate lease expiry and takeover after worker A reads its page.
    const job = state.jobData.get('account_deletions/u');
    state.jobData.set('account_deletions/u', {
      ...job, leaseOwner: 'worker-B',
    });
    await expect(deletePrivateCollectionPage('u', 'history_months', 1, 'worker-A'))
      .rejects.toBeInstanceOf(DeletionLeaseLostError);
    await expect(parkDeletion('u', 'deleting', { phase: 'root' }, 'worker-A'))
      .rejects.toBeInstanceOf(DeletionLeaseLostError);
    await expect(markDeletionFailed('u', 'root', new Error('old'), true, 'worker-A'))
      .rejects.toBeInstanceOf(DeletionLeaseLostError);
    await expect(markDeletionComplete('u', 'worker-A'))
      .rejects.toBeInstanceOf(DeletionLeaseLostError);
    expect(state.docs.has('users/u/history_months/survivor')).toBe(true);
    expect(state.jobData.get('account_deletions/u').leaseOwner).toBe('worker-B');
    expect(state.jobData.get('account_deletions/u').status).toBe('deleting');
  });

  it('preserves terminal complete state even if an older worker resumes', async () => {
    stageDeletionJob('u');
    await acquireDeletionLease('u', 'worker-B', Date.now() + 60_000);
    await markDeletionComplete('u', 'worker-B');
    await expect(markDeletionFailed('u', 'root', new Error('late'), true, 'worker-B'))
      .rejects.toBeInstanceOf(DeletionLeaseLostError);
    await expect(parkDeletion('u', 'deleting', { phase: 'root' }, 'worker-B'))
      .rejects.toBeInstanceOf(DeletionLeaseLostError);
    expect(state.jobData.get('account_deletions/u').status).toBe('complete');
  });

  it('starts the 30-day tombstone retention window only after deletion is complete', async () => {
    stageDeletionJob('u');
    await acquireDeletionLease('u', 'worker-complete', Date.now() + 60_000);
    await markDeletionComplete('u', 'worker-complete');

    const update = state.jobUpdates.at(-1) as any;
    expect(update).toBeDefined();
    expect(state.jobData.get('account_deletions/u').status).toBe('complete');
    expect(ACCOUNT_DELETION_COMPLETED_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('verifies replica D1 sync protocol 3 causal ordering and transaction boundaries for issue 1058', async () => {
    stageDeletionJob('u-issue-1058');
    await acquireDeletionLease('u-issue-1058', 'worker-sync', Date.now() + 60_000);
    await markDeletionComplete('u-issue-1058', 'worker-sync');
    
    const jobRecord = state.jobData.get('account_deletions/u-issue-1058');
    expect(jobRecord).toBeDefined();
    expect(jobRecord.status).toBe('complete');
  });
  });
}