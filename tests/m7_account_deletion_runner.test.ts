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

import { processAccountDeletion } from '../server/accountDeletion/runner';
import { PRIVATE_ACCOUNT_COLLECTIONS } from '../server/accountDeletion/types';

describe('M7 native account deletion runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [
      mocked.acquireDeletionLease,
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
    mocked.verifyNoAccountResidue.mockImplementation(async () => { order.push('verify'); });
    mocked.deleteAuthUserLast.mockImplementation(async () => { order.push('auth'); });
    mocked.markDeletionComplete.mockImplementation(async () => { order.push('complete'); });

    await expect(processAccountDeletion('uid-a', Date.now() + 60_000, 'lease-a')).resolves.toBe('complete');

    expect(mocked.acquireDeletionLease).toHaveBeenCalledWith('uid-a', 'lease-a', expect.any(Number));
    for (const name of PRIVATE_ACCOUNT_COLLECTIONS) {
      expect(pageCount.get(name)).toBe(2);
    }
    expect(order.indexOf('revoke')).toBeLessThan(order.indexOf('root'));
    expect(order.indexOf('verify')).toBeLessThan(order.indexOf('auth'));
    expect(order.at(-1)).toBe('complete');
    expect(mocked.markDeletionFailed).not.toHaveBeenCalled();
  });

  it('fails closed and never deletes Auth when unexpected private data is found', async () => {
    mocked.verifyNoAccountResidue.mockRejectedValueOnce(
      new mocked.NonRetryableDeletionError('Unexpected residual collection: legacy_private.'),
    );

    await expect(processAccountDeletion('uid-b', Date.now() + 60_000, 'lease-b')).resolves.toBe('failed');

    expect(mocked.deleteAuthUserLast).not.toHaveBeenCalled();
    expect(mocked.markDeletionComplete).not.toHaveBeenCalled();
    expect(mocked.markDeletionFailed).toHaveBeenCalledWith(
      'uid-b',
      'verification',
      expect.objectContaining({ message: 'Unexpected residual collection: legacy_private.' }),
      false,
    );
  });

  it('marks transient collection failures retryable without advancing to root or Auth', async () => {
    mocked.deletePrivateCollectionPage.mockRejectedValueOnce(new Error('transient Firestore failure'));

    await expect(processAccountDeletion('uid-c', Date.now() + 60_000, 'lease-c')).resolves.toBe('failed');

    expect(mocked.deleteUserRoot).not.toHaveBeenCalled();
    expect(mocked.deleteAuthUserLast).not.toHaveBeenCalled();
    expect(mocked.markDeletionFailed).toHaveBeenCalledWith(
      'uid-c',
      'collection:history_months',
      expect.objectContaining({ message: 'transient Firestore failure' }),
      true,
    );
  });

  it('does no destructive work when another invocation owns the lease', async () => {
    mocked.acquireDeletionLease.mockResolvedValueOnce(false);

    await expect(processAccountDeletion('uid-d', Date.now() + 60_000, 'lease-d')).resolves.toBe('busy');

    expect(mocked.revokeAccountAccess).not.toHaveBeenCalled();
    expect(mocked.deletePrivateCollectionPage).not.toHaveBeenCalled();
    expect(mocked.deleteAuthUserLast).not.toHaveBeenCalled();
  });

  it('refuses to start when the invocation budget is already inside the safety buffer', async () => {
    await expect(processAccountDeletion('uid-e', Date.now() + 1_000, 'lease-e')).resolves.toBe('pending');
    expect(mocked.acquireDeletionLease).not.toHaveBeenCalled();
  });
});
