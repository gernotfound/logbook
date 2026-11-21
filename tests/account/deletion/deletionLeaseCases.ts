import { describe, expect, it } from 'vitest';
import type { DeletionJobStoreTestContext } from './m7_account_deletion_job_store.test';

export function registerDeletionLeaseCases({
  state, stageDeletionJob, NonRetryableDeletionError, DeletionLeaseLostError,
  createOrRefreshDeletionJob, acquireDeletionLease, deletePrivateCollectionPage,
  deleteUserRoot, deleteAccountKeyAfterVerification, deleteAuthUserLast,
  markDeletionComplete,
}: DeletionJobStoreTestContext): void {
  describe('owner-scoped deletion lease and health-erasure serialization', () => {
  it('serializes an in-flight health erasure before acquiring the account deletion lease', async () => {
    state.docs.add('health_data_erasures/u');
    await createOrRefreshDeletionJob('u', 'A'.repeat(43));

    const blocked = [
      { uid: 'u', status: 'requested' },
      { uid: 'u', status: 'deleting' },
      { uid: 'u', status: 'verifying' },
      { uid: 'u', status: 'failed', retryable: true },
    ];
    for (const [index, healthJob] of blocked.entries()) {
      state.jobData.set('health_data_erasures/u', healthJob);
      expect(await acquireDeletionLease('u', 'account-worker', Date.now() + 60_000)).toBe(false);
      expect(state.jobData.get('account_deletions/u')).toMatchObject({ status: 'requested', attempts: 0 });
      expect(state.jobUpdates).toHaveLength(index + 1);
      expect(Object.keys(state.jobUpdates[index] as object)).toEqual(['updatedAt']);
    }

    state.jobData.set('health_data_erasures/u', { uid: 'u', status: 'complete' });
    expect(await acquireDeletionLease('u', 'account-worker', Date.now() + 60_000)).toBe(true);
    expect(state.jobData.get('account_deletions/u')).toMatchObject({
      status: 'deleting', leaseOwner: 'account-worker',
    });
  });

  it('allows account deletion after a non-retryable erasure failure, without blocking other owners', async () => {
    state.docs.add('health_data_erasures/another-owner');
    state.jobData.set('health_data_erasures/another-owner', { uid: 'another-owner', status: 'deleting' });
    await createOrRefreshDeletionJob('u', 'A'.repeat(43));
    expect(await acquireDeletionLease('u', 'account-worker', Date.now() + 60_000)).toBe(true);

    await createOrRefreshDeletionJob('other', 'B'.repeat(43));
    state.docs.add('health_data_erasures/other');
    state.jobData.set('health_data_erasures/other', { uid: 'other', status: 'failed', retryable: false });
    expect(await acquireDeletionLease('other', 'other-worker', Date.now() + 60_000)).toBe(true);
  });

  it('fails closed when a same-owner erasure receipt has an unrecognized identity or status', async () => {
    await createOrRefreshDeletionJob('u', 'A'.repeat(43));
    state.docs.add('health_data_erasures/u');
    state.jobData.set('health_data_erasures/u', { uid: 'different', status: 'complete' });
    expect(await acquireDeletionLease('u', 'worker', Date.now() + 60_000)).toBe(false);
    state.jobData.set('health_data_erasures/u', { uid: 'u', status: 'unknown' });
    expect(await acquireDeletionLease('u', 'worker', Date.now() + 60_000)).toBe(false);
    expect(state.jobUpdates).toHaveLength(2);
    expect(state.jobUpdates.every(update => Object.keys(update as object).join() === 'updatedAt')).toBe(true);
  });

  it('refuses an account deletion lease when the persisted job belongs to a different UID', async () => {
    stageDeletionJob('u');
    state.jobData.set('account_deletions/u', { uid: 'another-owner', status: 'requested', attempts: 0 });
    state.docs.add('users/u/history_months/survivor');
    state.docs.add('user_data_keys/u');
    await expect(acquireDeletionLease('u', 'worker', Date.now() + 60_000))
      .rejects.toBeInstanceOf(NonRetryableDeletionError);
    expect(state.jobUpdates).toHaveLength(0);
    expect(state.docs.has('users/u/history_months/survivor')).toBe(true);
    expect(state.docs.has('user_data_keys/u')).toBe(true);
    expect(state.revokeRefreshTokens).not.toHaveBeenCalled();
    expect(state.deleteUser).not.toHaveBeenCalled();
  });

  it('fences every destructive transaction if the job owner changes after lease acquisition', async () => {
    stageDeletionJob('u');
    state.docs.add('users/u/history_months/survivor');
    state.docs.add('user_data_keys/u');
    expect(await acquireDeletionLease('u', 'worker', Date.now() + 60_000)).toBe(true);
    const job = state.jobData.get('account_deletions/u');
    state.jobData.set('account_deletions/u', { ...job, uid: 'another-owner' });
    const writesBefore = state.jobUpdates.length;

    await expect(deletePrivateCollectionPage('u', 'history_months', 1, 'worker'))
      .rejects.toBeInstanceOf(DeletionLeaseLostError);
    await expect(deleteUserRoot('u', 'worker')).rejects.toBeInstanceOf(DeletionLeaseLostError);
    await expect(deleteAccountKeyAfterVerification('u', 'worker'))
      .rejects.toBeInstanceOf(DeletionLeaseLostError);
    await expect(deleteAuthUserLast('u', 'worker')).rejects.toBeInstanceOf(DeletionLeaseLostError);
    await expect(markDeletionComplete('u', 'worker')).rejects.toBeInstanceOf(DeletionLeaseLostError);

    expect(state.jobUpdates).toHaveLength(writesBefore);
    expect(state.docs.has('users/u/history_months/survivor')).toBe(true);
    expect(state.docs.has('user_data_keys/u')).toBe(true);
    expect(state.deleteUser).not.toHaveBeenCalled();
  });

  });
}
