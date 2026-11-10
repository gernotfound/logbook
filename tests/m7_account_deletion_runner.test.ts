import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => {
  class NonRetryableDeletionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NonRetryableDeletionError';
    }
  }
  return {
    NonRetryableDeletionError,
    acquireDeletionLease: vi.fn(),
    assertDeletionLease: vi.fn(),
    DeletionLeaseLostError: class DeletionLeaseLostError extends Error {},
    deleteAccountKeyAfterVerification: vi.fn(),
    deleteAuthUserLast: vi.fn(),
    deletePrivateCollectionPage: vi.fn(),
    deleteUserRoot: vi.fn(),
    markDeletionComplete: vi.fn(),
    markDeletionFailed: vi.fn(),
    markVerifying: vi.fn(),
    parkDeletion: vi.fn(),
    readDeletionStatus: vi.fn(),
    revokeAccountAccess: vi.fn(),
    verifyNoAccountResidue: vi.fn(),
  };
});

vi.mock('../server/accountDeletion/jobStore', () => mocked);

import {
  ACCOUNT_DELETION_INTERACTIVE_BUDGET_MS,
  ACCOUNT_DELETION_INTERACTIVE_SAFETY_BUFFER_MS,
} from '../server/accountDeletion/budget';
import { processAccountDeletion } from '../server/accountDeletion/runner';
import { PRIVATE_ACCOUNT_COLLECTIONS } from '../server/accountDeletion/types';

describe('M7 native account deletion runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [
      mocked.acquireDeletionLease,
      mocked.assertDeletionLease,
      mocked.deleteAccountKeyAfterVerification,
      mocked.deleteAuthUserLast,
      mocked.deleteUserRoot,
      mocked.markDeletionComplete,
      mocked.markDeletionFailed,
      mocked.markVerifying,
      mocked.parkDeletion,
      mocked.revokeAccountAccess,
      mocked.verifyNoAccountResidue,
    ]) fn.mockResolvedValue(undefined);
    mocked.acquireDeletionLease.mockResolvedValue(true);
    mocked.deletePrivateCollectionPage.mockResolvedValue(0);
  });

  it('revokes access, drains every private collection, verifies residue, and deletes Auth last', async () => {
    const order: string[] = [];
    const pageCount = new Map<string, number>();
    mocked.revokeAccountAccess.mockImplementation(async () => { order.push('revoke'); });
    mocked.deletePrivateCollectionPage.mockImplementation(async (_uid, name: string) => {
      order.push(`collection:${name}`);
      const seen = pageCount.get(name) ?? 0;
      pageCount.set(name, seen + 1);
      return seen === 0 ? 1 : 0;
    });
    mocked.deleteUserRoot.mockImplementation(async () => { order.push('root'); });
    mocked.markVerifying.mockImplementation(async () => { order.push('mark-verifying'); });
    mocked.verifyNoAccountResidue.mockImplementation(async (_uid, allowKey?: boolean) => { order.push(allowKey ? 'verify-before-key' : 'verify-after-key'); });
    mocked.deleteAccountKeyAfterVerification.mockImplementation(async () => { order.push('retire-key'); });
    mocked.deleteAuthUserLast.mockImplementation(async () => { order.push('auth'); });
    mocked.markDeletionComplete.mockImplementation(async () => { order.push('complete'); });

    await expect(processAccountDeletion('uid-a', Date.now() + 60_000, { leaseOwner: 'lease-a' })).resolves.toBe('complete');

    expect(mocked.acquireDeletionLease).toHaveBeenCalledWith('uid-a', 'lease-a', expect.any(Number));
    for (const name of PRIVATE_ACCOUNT_COLLECTIONS) {
      expect(pageCount.get(name)).toBe(2);
    }
    expect(order.indexOf('revoke')).toBeLessThan(order.indexOf('root'));
    expect(order.indexOf('verify-before-key')).toBeLessThan(order.indexOf('retire-key'));
    expect(order.indexOf('retire-key')).toBeLessThan(order.indexOf('verify-after-key'));
    expect(order.indexOf('verify-after-key')).toBeLessThan(order.indexOf('auth'));
    expect(order.at(-1)).toBe('complete');
    expect(mocked.markDeletionFailed).not.toHaveBeenCalled();
  });

  it('starts real cleanup with the canonical five-second interactive budget', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    try {
      await expect(processAccountDeletion(
        'uid-interactive',
        100_000 + ACCOUNT_DELETION_INTERACTIVE_BUDGET_MS,
        {
          leaseOwner: 'lease-interactive',
          safetyBufferMs: ACCOUNT_DELETION_INTERACTIVE_SAFETY_BUFFER_MS,
        },
      )).resolves.toBe('complete');

      expect(mocked.acquireDeletionLease).toHaveBeenCalledWith(
        'uid-interactive',
        'lease-interactive',
        100_000 + ACCOUNT_DELETION_INTERACTIVE_BUDGET_MS,
      );
      expect(mocked.revokeAccountAccess).toHaveBeenCalledWith('uid-interactive');
      expect(mocked.markDeletionComplete).toHaveBeenCalledWith('uid-interactive', 'lease-interactive');
    } finally {
      now.mockRestore();
    }
  });

  it('fails closed and never deletes Auth when unexpected private data is found', async () => {
    mocked.verifyNoAccountResidue.mockRejectedValueOnce(
      new mocked.NonRetryableDeletionError('Unexpected residual collection: legacy_private.'),
    );

    await expect(processAccountDeletion('uid-b', Date.now() + 60_000, { leaseOwner: 'lease-b' })).resolves.toBe('failed');

    expect(mocked.deleteAccountKeyAfterVerification).not.toHaveBeenCalled();
    expect(mocked.deleteAuthUserLast).not.toHaveBeenCalled();
    expect(mocked.markDeletionComplete).not.toHaveBeenCalled();
    expect(mocked.markDeletionFailed).toHaveBeenCalledWith(
      'uid-b',
      'verification',
      expect.objectContaining({ message: 'Unexpected residual collection: legacy_private.' }),
      false,
      'lease-b',
    );
  });

  it('marks transient collection failures retryable without advancing to root or Auth', async () => {
    mocked.deletePrivateCollectionPage.mockRejectedValueOnce(new Error('transient Firestore failure'));

    await expect(processAccountDeletion('uid-c', Date.now() + 60_000, { leaseOwner: 'lease-c' })).resolves.toBe('failed');

    expect(mocked.deleteUserRoot).not.toHaveBeenCalled();
    expect(mocked.deleteAuthUserLast).not.toHaveBeenCalled();
    expect(mocked.markDeletionFailed).toHaveBeenCalledWith(
      'uid-c',
      'collection:history_months',
      expect.objectContaining({ message: 'transient Firestore failure' }),
      true,
      'lease-c',
    );
  });


  it('fails closed when wrapped-key retirement fails and resumes on a later attempt', async () => {
    mocked.deleteAccountKeyAfterVerification.mockRejectedValueOnce(new Error('key storage unavailable'));
    await expect(processAccountDeletion('uid-key', Date.now() + 60_000, {
      leaseOwner: 'lease-key',
    })).resolves.toBe('failed');

    expect(mocked.verifyNoAccountResidue).toHaveBeenCalledWith('uid-key', true);
    expect(mocked.verifyNoAccountResidue).not.toHaveBeenCalledWith('uid-key');
    expect(mocked.deleteAuthUserLast).not.toHaveBeenCalled();
    expect(mocked.markDeletionComplete).not.toHaveBeenCalled();
    expect(mocked.markDeletionFailed).toHaveBeenCalledWith(
      'uid-key', 'verification', expect.any(Error), true, 'lease-key',
    );

    await expect(processAccountDeletion('uid-key', Date.now() + 60_000, {
      leaseOwner: 'lease-key-retry',
    })).resolves.toBe('complete');
    expect(mocked.deleteAuthUserLast).toHaveBeenCalledTimes(1);
    expect(mocked.markDeletionComplete).toHaveBeenCalledWith('uid-key', 'lease-key-retry');
  });

  it('never deletes Auth if a final residue check fails after key retirement', async () => {
    mocked.verifyNoAccountResidue
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Unexpected private residue'));

    await expect(processAccountDeletion('uid-residue', Date.now() + 60_000, {
      leaseOwner: 'lease-residue',
    })).resolves.toBe('failed');

    expect(mocked.deleteAccountKeyAfterVerification).toHaveBeenCalledOnce();
    expect(mocked.deleteAuthUserLast).not.toHaveBeenCalled();
    expect(mocked.markDeletionComplete).not.toHaveBeenCalled();
  });

  it('retries after an interrupted completion write without reporting a false success', async () => {
    mocked.markDeletionComplete.mockRejectedValueOnce(new Error('Firestore unavailable after Auth delete'));
    await expect(processAccountDeletion('uid-auth', Date.now() + 60_000, {
      leaseOwner: 'lease-auth',
    })).resolves.toBe('failed');
    expect(mocked.deleteAuthUserLast).toHaveBeenCalledOnce();
    expect(mocked.markDeletionFailed).toHaveBeenCalledWith(
      'uid-auth', 'auth', expect.any(Error), true, 'lease-auth',
    );

    await expect(processAccountDeletion('uid-auth', Date.now() + 60_000, {
      leaseOwner: 'lease-auth-retry',
    })).resolves.toBe('complete');
    // The real Admin boundary treats auth/user-not-found as idempotent success.
    expect(mocked.deleteAuthUserLast).toHaveBeenCalledTimes(2);
    expect(mocked.markDeletionComplete).toHaveBeenCalledTimes(2);
    expect(mocked.markDeletionComplete).toHaveBeenLastCalledWith('uid-auth', 'lease-auth-retry');
  });

  it('does no destructive work when another invocation owns the lease', async () => {
    mocked.acquireDeletionLease.mockResolvedValueOnce(false);

    await expect(processAccountDeletion('uid-d', Date.now() + 60_000, { leaseOwner: 'lease-d' })).resolves.toBe('busy');

    expect(mocked.revokeAccountAccess).not.toHaveBeenCalled();
    expect(mocked.deletePrivateCollectionPage).not.toHaveBeenCalled();
    expect(mocked.deleteAuthUserLast).not.toHaveBeenCalled();
  });


  it('stops immediately when a worker loses its lease during a suspended page delete', async () => {
    mocked.deletePrivateCollectionPage.mockRejectedValueOnce(new mocked.DeletionLeaseLostError());

    await expect(processAccountDeletion('uid-stale', Date.now() + 60_000, {
      leaseOwner: 'lease-stale',
    })).resolves.toBe('busy');

    expect(mocked.deleteUserRoot).not.toHaveBeenCalled();
    expect(mocked.deleteAuthUserLast).not.toHaveBeenCalled();
    expect(mocked.markDeletionFailed).not.toHaveBeenCalled();
  });

  it('does not mark failure when lease ownership changes after an external verification', async () => {
    mocked.assertDeletionLease.mockRejectedValueOnce(new mocked.DeletionLeaseLostError());
    await expect(processAccountDeletion('uid-old', Date.now() + 60_000, {
      leaseOwner: 'lease-old',
    })).resolves.toBe('busy');
    expect(mocked.markDeletionFailed).not.toHaveBeenCalled();
  });

  it('refuses to start when the invocation budget is already inside the safety buffer', async () => {
    await expect(processAccountDeletion('uid-e', Date.now() + 1_000, { leaseOwner: 'lease-e' })).resolves.toBe('pending');
    expect(mocked.acquireDeletionLease).not.toHaveBeenCalled();
  });

  it('rejects an invalid caller safety buffer before acquiring a destructive lease', async () => {
    await expect(processAccountDeletion('uid-f', Date.now() + 60_000, {
      leaseOwner: 'lease-f',
      safetyBufferMs: Number.NaN,
    })).rejects.toThrow('Invalid account deletion safety buffer.');
    expect(mocked.acquireDeletionLease).not.toHaveBeenCalled();
  });
});
