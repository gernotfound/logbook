import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  docs: new Set<string>(),
  batchSizes: [] as number[],
  jobUpdates: [] as unknown[],
  deleteUser: vi.fn(),
  revokeRefreshTokens: vi.fn(),
}));

function fakeDocument(path: string): any {
  return {
    path,
    id: path.split('/').at(-1),
    async get() {
      return { exists: state.docs.has(path), data: () => ({}) };
    },
    async delete() {
      state.docs.delete(path);
    },
    async update(data: unknown) {
      state.jobUpdates.push(data);
    },
    collection(name: string) {
      return fakeCollection(`${path}/${name}`);
    },
    async listCollections() {
      const prefix = `${path}/`;
      const names = new Set<string>();
      for (const candidate of state.docs) {
        if (!candidate.startsWith(prefix)) continue;
        const tail = candidate.slice(prefix.length).split('/');
        if (tail.length >= 2) names.add(tail[0]);
      }
      return [...names].map(name => fakeCollection(`${path}/${name}`));
    },
  };
}

function fakeCollection(path: string): any {
  return {
    path,
    id: path.split('/').at(-1),
    doc(id: string) {
      return fakeDocument(`${path}/${id}`);
    },
    limit(count: number) {
      return {
        async get() {
          const prefix = `${path}/`;
          const paths = [...state.docs]
            .filter(candidate => candidate.startsWith(prefix) && candidate.slice(prefix.length).split('/').length === 1)
            .slice(0, count);
          return {
            empty: paths.length === 0,
            size: paths.length,
            docs: paths.map(candidate => ({ ref: fakeDocument(candidate) })),
          };
        },
      };
    },
  };
}

const fakeDb = vi.hoisted(() => ({
  collection(name: string) {
    return fakeCollection(name);
  },
  batch() {
    const deletes: string[] = [];
    return {
      delete(ref: { path: string }) {
        deletes.push(ref.path);
      },
      update(_ref: unknown, data: unknown) {
        state.jobUpdates.push(data);
      },
      async commit() {
        state.batchSizes.push(deletes.length);
        for (const path of deletes) state.docs.delete(path);
      },
    };
  },
}));

vi.mock('../server/accountDeletion/firebaseAdmin', () => ({
  adminDb: () => fakeDb,
  adminAuth: () => ({
    deleteUser: state.deleteUser,
    revokeRefreshTokens: state.revokeRefreshTokens,
  }),
}));

import {
  NonRetryableDeletionError,
  deleteAuthUserLast,
  deletePrivateCollectionPage,
  hashReceipt,
  markDeletionComplete,
  validateReceipt,
  verifyNoAccountResidue,
} from '../server/accountDeletion/jobStore';
import { ACCOUNT_DELETION_COMPLETED_RETENTION_MS } from '../server/accountDeletion/retention';

describe('M7 native deletion job store', () => {
  beforeEach(() => {
    state.docs.clear();
    state.batchSizes.length = 0;
    state.jobUpdates.length = 0;
    vi.clearAllMocks();
    state.deleteUser.mockResolvedValue(undefined);
    state.revokeRefreshTokens.mockResolvedValue(undefined);
  });

  it('drains arbitrarily large collections by repeatedly deleting at most 400 documents', async () => {
    state.docs.add('account_deletions/u');
    for (let i = 0; i < 950; i++) state.docs.add(`users/u/history_months/doc-${i}`);

    let batches = 0;
    for (;;) {
      const deleted = await deletePrivateCollectionPage('u', 'history_months', batches + 1);
      if (deleted === 0) break;
      batches += 1;
    }

    expect(state.batchSizes).toEqual([400, 400, 150]);
    expect([...state.docs].filter(path => path.startsWith('users/u/history_months/'))).toHaveLength(0);
  });

  it('fails closed on an unexpected residual private subcollection', async () => {
    state.docs.add('account_deletions/u');
    state.docs.add('users/u/legacy_private/residual');

    await expect(verifyNoAccountResidue('u')).rejects.toBeInstanceOf(NonRetryableDeletionError);
    await expect(verifyNoAccountResidue('u')).rejects.toThrow('Unexpected residual collection: legacy_private.');
  });

  it('treats an already-missing Firebase Auth user as idempotent success', async () => {
    state.docs.add('account_deletions/u');
    state.deleteUser.mockRejectedValueOnce(Object.assign(new Error('already deleted'), { code: 'auth/user-not-found' }));

    await expect(deleteAuthUserLast('u')).resolves.toBeUndefined();
    expect(state.deleteUser).toHaveBeenCalledWith('u');
  });

  it('validates opaque receipts and persists only their hash server-side', () => {
    const receipt = 'A'.repeat(43);
    expect(validateReceipt(receipt)).toBe(receipt);
    expect(hashReceipt(receipt)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashReceipt(receipt)).not.toContain(receipt);
    expect(() => validateReceipt('short')).toThrow('Ricevuta di cancellazione non valida.');
  });

  it('starts the 30-day tombstone retention window only after deletion is complete', async () => {
    await markDeletionComplete('u');

    const update = state.jobUpdates.at(-1) as {
      status?: string;
      updatedAt?: { toMillis: () => number };
      purgeAfter?: { toMillis: () => number };
    };
    expect(update.status).toBe('complete');
    expect(update.updatedAt).toBeDefined();
    expect(update.purgeAfter).toBeDefined();
    expect(update.purgeAfter!.toMillis() - update.updatedAt!.toMillis())
      .toBe(ACCOUNT_DELETION_COMPLETED_RETENTION_MS);
  });
});
