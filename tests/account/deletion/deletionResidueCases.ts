import { describe, expect, it } from 'vitest';
import type { DeletionJobStoreTestContext } from './m7_account_deletion_job_store.test';

export function registerDeletionResidueCases({
  state, stageDeletionJob, NonRetryableDeletionError, DeletionLeaseLostError,
  acquireDeletionLease, deletePrivateCollectionPage, deleteUserRoot,
  deleteAccountKeyAfterVerification, deleteAuthUserLast, verifyNoAccountResidue,
}: DeletionJobStoreTestContext): void {
  describe('bounded Firestore page cleanup, encrypted key and private residue guards', () => {
  it('drains arbitrarily large collections by repeatedly deleting at most 400 documents', async () => {
    stageDeletionJob('u');
    for (let i = 0; i < 950; i++) state.docs.add(`users/u/history_months/doc-${i}`);

    await acquireDeletionLease('u', 'worker-page', Date.now() + 60_000);
    let batches = 0;
    for (;;) {
      const deleted = await deletePrivateCollectionPage('u', 'history_months', batches + 1, 'worker-page');
      if (deleted === 0) break;
      batches += 1;
    }

    expect(state.batchSizes).toEqual([400, 400, 150]);
    expect([...state.docs].filter(path => path.startsWith('users/u/history_months/'))).toHaveLength(0);
    expect(state.projectedQueries.filter(path => path === 'users/u/history_months').length).toBeGreaterThanOrEqual(3);
  });

  it('uses reference-only projections when verifying account deletion residue', async () => {
    stageDeletionJob('u');

    await expect(verifyNoAccountResidue('u')).resolves.toBeUndefined();

    expect(state.projectedQueries).toContain('users');
    expect(state.projectedQueries).toContain('users/u/history_months');
    expect(state.projectedQueries).toContain('users/u/nutrition_months');
    expect(state.projectedQueries).toContain('users/u/sync_control');
  });

  it('removes the server-only session marker under the deletion lease', async () => {
    stageDeletionJob('u');
    state.docs.add('session_revocations/u');
    state.docs.add('user_data_keys/u');
    state.docs.add('user_data_keys/another-owner');
    state.docs.add('health_consent_withdrawals/u');
    state.docs.add('health_consent_withdrawals/another-owner');
    state.docs.add('users/u');
    await acquireDeletionLease('u', 'worker-root', Date.now() + 60_000);
    await deleteUserRoot('u', 'worker-root');
    expect(state.docs.has('session_revocations/u')).toBe(false);
    expect(state.docs.has('user_data_keys/u')).toBe(true);
    await expect(verifyNoAccountResidue('u', true)).resolves.toBeUndefined();
    await deleteAccountKeyAfterVerification('u', 'worker-root');
    expect(state.docs.has('user_data_keys/u')).toBe(false);
    expect(state.docs.has('user_data_keys/another-owner')).toBe(true);
    expect(state.docs.has('health_consent_withdrawals/u')).toBe(false);
    expect(state.docs.has('health_consent_withdrawals/another-owner')).toBe(true);
    expect(state.docs.has('users/u')).toBe(false);
    await expect(verifyNoAccountResidue('u')).resolves.toBeUndefined();
  });

  it('preserves the account key if an unexpected private collection blocks deletion', async () => {
    stageDeletionJob('u');
    state.docs.add('user_data_keys/u');
    state.docs.add('users/u/unknown_private/2026-11');
    await acquireDeletionLease('u', 'worker-residue', Date.now() + 60_000);
    await deleteUserRoot('u', 'worker-residue');
    await expect(verifyNoAccountResidue('u', true)).rejects.toThrow('Unexpected residual collection');
    expect(state.docs.has('user_data_keys/u')).toBe(true);
  });

  it.each([
    ['known', 'users/u/history_months/2026-09/private_nested/secret'],
    ['unknown', 'users/u/unknown_private/missing_parent/deep/secret'],
  ])('refuses to verify %s orphan nested documents before retiring the account key', async (_kind, residualPath) => {
    stageDeletionJob('u');
    state.docs.add('user_data_keys/u');
    state.docs.add(residualPath);

    await expect(verifyNoAccountResidue('u', true)).rejects.toBeInstanceOf(NonRetryableDeletionError);
    expect(state.docs.has(residualPath)).toBe(true);
    expect(state.docs.has('user_data_keys/u')).toBe(true);
  });

  it('cannot retire a cloud key after losing the deletion lease', async () => {
    stageDeletionJob('u');
    state.docs.add('user_data_keys/u');
    await acquireDeletionLease('u', 'worker-original', Date.now() + 60_000);
    await expect(deleteAccountKeyAfterVerification('u', 'worker-other')).rejects.toBeInstanceOf(DeletionLeaseLostError);
    expect(state.docs.has('user_data_keys/u')).toBe(true);
  });

  it('removes account activity under the deletion lease and refuses residual activity', async () => {
    stageDeletionJob('u');
    state.docs.add('account_activity/u');
    await acquireDeletionLease('u', 'worker-activity', Date.now() + 60_000);
    await deleteUserRoot('u', 'worker-activity');
    expect(state.docs.has('account_activity/u')).toBe(false);
    await expect(verifyNoAccountResidue('u', true)).resolves.toBeUndefined();

    state.docs.add('account_activity/u');
    await expect(verifyNoAccountResidue('u', true)).rejects.toThrow('Account activity marker still exists');
  });

  it('does not verify account deletion while a revocation marker remains', async () => {
    state.docs.add('session_revocations/u');
    await expect(verifyNoAccountResidue('u')).rejects.toThrow(
      'Session revocation marker still exists after deletion.',
    );
  });

  it('refuses complete deletion while a top-level wrapped account data key remains', async () => {
    state.docs.add('user_data_keys/u');
    await expect(verifyNoAccountResidue('u')).rejects.toThrow(
      'Wrapped account data key remains after deletion.',
    );
  });

  it('fails closed when the health consent marker remains', async () => {
    state.docs.add('health_consent_withdrawals/u');
    await expect(verifyNoAccountResidue('u')).rejects.toThrow('Health consent marker remains after account deletion.');
  });

  it('preserves root and consent if another worker owns the lease', async () => {
    stageDeletionJob('u');
    state.docs.add('users/u');
    state.docs.add('health_consent_withdrawals/u');
    await acquireDeletionLease('u', 'worker-A', Date.now() + 60_000);
    const job = state.jobData.get('account_deletions/u');
    state.jobData.set('account_deletions/u', { ...job, leaseOwner: 'worker-B' });
    await expect(deleteUserRoot('u', 'worker-A')).rejects.toBeInstanceOf(DeletionLeaseLostError);
    expect(state.docs.has('users/u')).toBe(true);
    expect(state.docs.has('health_consent_withdrawals/u')).toBe(true);
  });

  it('fails closed when the user root document still exists', async () => {
    stageDeletionJob('u');
    state.docs.add('users/u');

    await expect(verifyNoAccountResidue('u')).rejects.toThrow('User root document still exists after deletion.');
    expect(state.projectedQueries).toContain('users');
  });

  it('fails closed on an unexpected residual private subcollection', async () => {
    stageDeletionJob('u');
    state.docs.add('users/u/legacy_private/residual');

    await expect(verifyNoAccountResidue('u')).rejects.toBeInstanceOf(NonRetryableDeletionError);
    await expect(verifyNoAccountResidue('u')).rejects.toThrow('Unexpected residual collection: legacy_private.');
  });

  it('treats an already-missing Firebase Auth user as idempotent success', async () => {
    stageDeletionJob('u');
    state.deleteUser.mockRejectedValueOnce(Object.assign(new Error('already deleted'), { code: 'auth/user-not-found' }));

    await acquireDeletionLease('u', 'worker-auth', Date.now() + 60_000);
    await expect(deleteAuthUserLast('u', 'worker-auth')).resolves.toBeUndefined();
    expect(state.deleteUser).toHaveBeenCalledWith('u');
  });

  });
}
