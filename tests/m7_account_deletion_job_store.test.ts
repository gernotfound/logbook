import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  docs: new Set<string>(),
  jobData: new Map<string, any>(),
  batchSizes: [] as number[],
  jobUpdates: [] as unknown[],
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
    },
    async update(data: unknown) {
      state.jobUpdates.push(data);
      state.jobData.set(path, { ...(state.jobData.get(path) ?? {}), ...(data as Record<string, unknown>) });
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
  async runTransaction(work: (transaction: any) => Promise<any>) {
    const deleted: string[] = [];
    const updates: Array<{ path: string; data: Record<string, unknown> }> = [];
    const created: Array<{ path: string; data: unknown }> = [];
    const result = await work({
      get: (ref: any) => ref.get(),
      create: (ref: any, data: unknown) => created.push({ path: ref.path, data }),
      delete: (ref: any) => deleted.push(ref.path),
      update: (ref: any, data: Record<string, unknown>) => updates.push({ path: ref.path, data }),
    });
    // Apply only when the whole transaction succeeds, as Firestore does.
    for (const item of created) {
      state.docs.add(item.path);
      state.jobData.set(item.path, item.data);
    }
    for (const path of deleted) state.docs.delete(path);
    for (const item of updates) {
      state.jobUpdates.push(item.data);
      state.jobData.set(item.path, { ...(state.jobData.get(item.path) ?? {}), ...item.data });
    }
    if (deleted.length) state.batchSizes.push(deleted.length);
    return result;
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
  DeletionLeaseLostError,
  acquireDeletionLease,
  parkDeletion,
  markDeletionFailed,
  createOrRefreshDeletionJob,
  deleteAuthUserLast,
  deletePrivateCollectionPage,
  hashReceipt,
  markDeletionComplete,
  readAuthorizedDeletionJob,
  readDeletionStatus,
  validateReceipt,
  verifyNoAccountResidue,
} from '../server/accountDeletion/jobStore';
import { ACCOUNT_DELETION_COMPLETED_RETENTION_MS } from '../server/accountDeletion/retention';

describe('M7 native deletion job store', () => {
  beforeEach(() => {
    state.docs.clear();
    state.jobData.clear();
    state.batchSizes.length = 0;
    state.jobUpdates.length = 0;
    state.projectedQueries.length = 0;
    vi.clearAllMocks();
    state.deleteUser.mockResolvedValue(undefined);
    state.revokeRefreshTokens.mockResolvedValue(undefined);
  });

  it('drains arbitrarily large collections by repeatedly deleting at most 400 documents', async () => {
    state.docs.add('account_deletions/u');
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
    state.docs.add('account_deletions/u');

    await expect(verifyNoAccountResidue('u')).resolves.toBeUndefined();

    expect(state.projectedQueries).toContain('users');
    expect(state.projectedQueries).toContain('users/u/history_months');
    expect(state.projectedQueries).toContain('users/u/nutrition_months');
    expect(state.projectedQueries).toContain('users/u/sync_control');
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

    await acquireDeletionLease('u', 'worker-auth', Date.now() + 60_000);
    await expect(deleteAuthUserLast('u', 'worker-auth')).resolves.toBeUndefined();
    expect(state.deleteUser).toHaveBeenCalledWith('u');
  });

  it('validates opaque receipts and persists only their hash server-side', () => {
    const receipt = 'A'.repeat(43);
    expect(validateReceipt(receipt)).toBe(receipt);
    expect(hashReceipt(receipt)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashReceipt(receipt)).not.toContain(receipt);
    expect(() => validateReceipt('short')).toThrow('Ricevuta di cancellazione non valida.');
  });

  it('keeps independently issued deletion receipts valid for the same in-flight job', async () => {
    const receiptA = 'A'.repeat(43);
    const receiptB = 'B'.repeat(43);

    await createOrRefreshDeletionJob('u', receiptA);
    await createOrRefreshDeletionJob('u', receiptB);

    expect(await readAuthorizedDeletionJob('u', receiptA)).toMatchObject({ uid: 'u', status: 'requested' });
    expect(await readAuthorizedDeletionJob('u', receiptB)).toMatchObject({ uid: 'u', status: 'requested' });
    expect(await readDeletionStatus('u', receiptA)).toMatchObject({ uid: 'u', status: 'requested' });
    expect(await readDeletionStatus('u', receiptB)).toMatchObject({ uid: 'u', status: 'requested' });

    const stored = state.jobData.get('account_deletions/u') as { receiptHash: string; receiptHashes?: string[] };
    expect(stored.receiptHash).toBe(hashReceipt(receiptA));
    expect(stored.receiptHashes).toContain(hashReceipt(receiptB));
    expect(JSON.stringify(stored)).not.toContain(receiptA);
    expect(JSON.stringify(stored)).not.toContain(receiptB);
  });

  it('keeps the original receipt stable while bounding additional recovery proofs', async () => {
    const receipts = Array.from({ length: 24 }, (_, index) =>
      String.fromCharCode(65 + (index % 26)).repeat(42) + String(index % 10)
    );

    for (const receipt of receipts) await createOrRefreshDeletionJob('u', receipt);

    const stored = state.jobData.get('account_deletions/u') as { receiptHash: string; receiptHashes?: string[] };
    expect(stored.receiptHash).toBe(hashReceipt(receipts[0]));
    expect(stored.receiptHashes?.length ?? 0).toBeLessThanOrEqual(15);
    expect(await readAuthorizedDeletionJob('u', receipts[0])).not.toBeNull();
    expect(await readAuthorizedDeletionJob('u', receipts.at(-1)!)).not.toBeNull();
  });


  it('fences a stale worker out of document deletion, park, failure and completion', async () => {
    state.docs.add('account_deletions/u');
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
    state.docs.add('account_deletions/u');
    await acquireDeletionLease('u', 'worker-B', Date.now() + 60_000);
    await markDeletionComplete('u', 'worker-B');
    await expect(markDeletionFailed('u', 'root', new Error('late'), true, 'worker-B'))
      .rejects.toBeInstanceOf(DeletionLeaseLostError);
    await expect(parkDeletion('u', 'deleting', { phase: 'root' }, 'worker-B'))
      .rejects.toBeInstanceOf(DeletionLeaseLostError);
    expect(state.jobData.get('account_deletions/u').status).toBe('complete');
  });

  it('starts the 30-day tombstone retention window only after deletion is complete', async () => {
    state.docs.add('account_deletions/u');
    await acquireDeletionLease('u', 'worker-complete', Date.now() + 60_000);
    await markDeletionComplete('u', 'worker-complete');

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
