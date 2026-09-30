import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  docs: new Set<string>(),
  batchSizes: [] as number[],
  jobUpdates: [] as unknown[],
  jobData: new Map<string, Record<string, any>>(),
  deleteUser: vi.fn(),
  revokeRefreshTokens: vi.fn(),
  projectedQueries: [] as string[],
}));

function fakeDocument(path: string): any {
  return {
    path,
    id: path.split('/').at(-1),
    async get() {
      return { exists: state.docs.has(path), data: () => state.jobData.get(path) ?? {} };
    },
    async delete() {
      state.docs.delete(path);
      state.jobData.delete(path);
    },
    async update(data: unknown) {
      state.jobUpdates.push(data);
      state.jobData.set(path, { ...(state.jobData.get(path) ?? {}), ...(data as Record<string, any>) });
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
  const query = (filterId?: string, count = Number.POSITIVE_INFINITY): any => ({
    where(_field: unknown, _operator: string, value: unknown) {
      return query(String(value), count);
    },
    select() {
      state.projectedQueries.push(path);
      return query(filterId, count);
    },
    limit(nextCount: number) {
      return query(filterId, nextCount);
    },
    async get() {
      const prefix = `${path}/`;
      const paths = [...state.docs]
        .filter(candidate => candidate.startsWith(prefix) && candidate.slice(prefix.length).split('/').length === 1)
        .filter(candidate => filterId === undefined || candidate === `${path}/${filterId}`)
        .slice(0, count);
      return {
        empty: paths.length === 0,
        size: paths.length,
        docs: paths.map(candidate => ({ ref: fakeDocument(candidate) })),
      };
    },
  });

  return {
    path,
    id: path.split('/').at(-1),
    doc(id: string) {
      return fakeDocument(`${path}/${id}`);
    },
    ...query(),
  };
}

const fakeDb = vi.hoisted(() => ({
  collection(name: string) {
    return fakeCollection(name);
  },
  async runTransaction(callback: (transaction: any) => unknown) {
    const transaction = {
      get: async (ref: { path: string }) => ({
        exists: state.docs.has(ref.path),
        data: () => state.jobData.get(ref.path) ?? {},
      }),
      create: (ref: { path: string }, data: Record<string, any>) => {
        state.docs.add(ref.path);
        state.jobData.set(ref.path, { ...data });
      },
      update: (ref: { path: string }, data: Record<string, any>) => {
        state.jobUpdates.push(data);
        state.jobData.set(ref.path, { ...(state.jobData.get(ref.path) ?? {}), ...data });
      },
    };
    return callback(transaction);
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

vi.mock('../functions/src/accountDeletion/firebaseAdmin', () => ({
  adminDb: () => fakeDb,
  adminAuth: () => ({
    deleteUser: state.deleteUser,
    revokeRefreshTokens: state.revokeRefreshTokens,
  }),
}));

import {
  NonRetryableDeletionError,
  createOrRefreshDeletionJob,
  readAuthorizedDeletionJob,
  deleteAuthUserLast,
  deletePrivateCollectionPage,
  hashReceipt,
  markDeletionComplete,
  validateReceipt,
  verifyNoAccountResidue,
} from '../functions/src/accountDeletion/jobStore';
import { ACCOUNT_DELETION_COMPLETED_RETENTION_MS } from '../functions/src/accountDeletion/retention';

describe('M7 native deletion job store', () => {
  beforeEach(() => {
    state.docs.clear();
    state.batchSizes.length = 0;
    state.jobUpdates.length = 0;
    state.jobData.clear();
    state.projectedQueries.length = 0;
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
    expect(state.projectedQueries.filter(path => path === 'users/u/history_months').length).toBeGreaterThanOrEqual(3);
  });

  it('uses reference-only projections when verifying account deletion residue', async () => {
    state.docs.add('account_deletions/u');

    await expect(verifyNoAccountResidue('u')).resolves.toBeUndefined();

    expect(state.projectedQueries).toContain('users');
    expect(state.projectedQueries).toContain('users/u/history_months');
    expect(state.projectedQueries).toContain('users/u/nutrition_months');
    expect(state.projectedQueries).toContain('users/u/telemetry_errors');
    expect(state.projectedQueries).toContain('users/u/telemetry_events');
    expect(state.projectedQueries).toContain('users/u/telemetry_anomalies');
  });

  it('fails closed when the user root document still exists', async () => {
    state.docs.add('account_deletions/u');
    state.docs.add('users/u');

    await expect(verifyNoAccountResidue('u')).rejects.toThrow('User root document still exists after deletion.');
    expect(state.projectedQueries).toContain('users');
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

  it('keeps recovery receipts from multiple authenticated devices valid for the same deletion job', async () => {
    const firstReceipt = 'A'.repeat(43);
    const secondReceipt = 'B'.repeat(43);

    await createOrRefreshDeletionJob('u', firstReceipt);
    await createOrRefreshDeletionJob('u', secondReceipt);

    await expect(readAuthorizedDeletionJob('u', firstReceipt)).resolves.not.toBeNull();
    await expect(readAuthorizedDeletionJob('u', secondReceipt)).resolves.not.toBeNull();

    const persisted = state.jobData.get('account_deletions/u')!;
    expect(persisted.receiptHash).toBe(hashReceipt(firstReceipt));
    expect(persisted.receiptHashes).toEqual([
      hashReceipt(firstReceipt),
      hashReceipt(secondReceipt),
    ]);
    expect(JSON.stringify(persisted)).not.toContain(firstReceipt);
    expect(JSON.stringify(persisted)).not.toContain(secondReceipt);
  });

  it('rejects an unbounded growth of recovery receipts without invalidating existing devices', async () => {
    const receipts = Array.from({ length: 32 }, (_, index) =>
      Buffer.alloc(32, index + 1).toString('base64url')
    );

    for (const receipt of receipts) {
      await createOrRefreshDeletionJob('u', receipt);
    }

    const extraReceipt = Buffer.alloc(32, 99).toString('base64url');
    await expect(createOrRefreshDeletionJob('u', extraReceipt))
      .rejects.toThrow('Numero massimo di dispositivi di recovery raggiunto');

    await expect(readAuthorizedDeletionJob('u', receipts[0])).resolves.not.toBeNull();
    await expect(readAuthorizedDeletionJob('u', receipts.at(-1)!)).resolves.not.toBeNull();
    await expect(readAuthorizedDeletionJob('u', extraReceipt)).resolves.toBeNull();

    const persisted = state.jobData.get('account_deletions/u')!;
    expect(persisted.receiptHashes).toHaveLength(32);
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
