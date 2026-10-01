import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

const state = vi.hoisted(() => ({
  docs: new Set<string>(),
  batchSizes: [] as number[],
  jobUpdates: [] as unknown[],
  jobData: new Map<string, Record<string, any>>(),
  deleteUser: vi.fn(),
  revokeRefreshTokens: vi.fn(),
  projectedQueries: [] as string[],
}));

function millis(value: unknown): number | null {
  if (value && typeof value === 'object' && 'toMillis' in value
    && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

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
  const query = (options: {
    filterId?: string;
    dueBefore?: number;
    count?: number;
    orderField?: string;
    direction?: string;
  } = {}): any => ({
    where(field: unknown, operator: string, value: unknown) {
      if (operator === '==') return query({ ...options, filterId: String(value) });
      if (field === 'nextAttemptAt' && operator === '<=') {
        const cutoff = millis(value);
        if (cutoff === null) throw new Error('Invalid nextAttemptAt cutoff');
        return query({ ...options, dueBefore: cutoff });
      }
      throw new Error('Unexpected query');
    },
    orderBy(field: string, direction: string) {
      return query({ ...options, orderField: field, direction });
    },
    select() {
      state.projectedQueries.push(path);
      return query(options);
    },
    limit(nextCount: number) {
      return query({ ...options, count: nextCount });
    },
    async get() {
      const prefix = `${path}/`;
      let paths = [...state.docs]
        .filter(candidate => candidate.startsWith(prefix) && candidate.slice(prefix.length).split('/').length === 1)
        .filter(candidate => options.filterId === undefined || candidate === `${path}/${options.filterId}`)
        .filter(candidate => {
          if (options.dueBefore === undefined) return true;
          const due = millis(state.jobData.get(candidate)?.nextAttemptAt);
          return due !== null && due <= options.dueBefore;
        });
      if (options.orderField === 'nextAttemptAt') {
        paths = paths.sort((a, b) =>
          (millis(state.jobData.get(a)?.nextAttemptAt) ?? Number.POSITIVE_INFINITY)
          - (millis(state.jobData.get(b)?.nextAttemptAt) ?? Number.POSITIVE_INFINITY));
      }
      paths = paths.slice(0, options.count ?? Number.POSITIVE_INFINITY);
      return {
        empty: paths.length === 0,
        size: paths.length,
        docs: paths.map(candidate => ({
          ref: fakeDocument(candidate),
          data: () => state.jobData.get(candidate) ?? {},
        })),
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
      delete: (ref: { path: string }) => {
        state.docs.delete(ref.path);
        state.jobData.delete(ref.path);
      },
    };
    return callback(transaction);
  },
  batch() {
    const deletes: string[] = [];
    const updates: Array<{ path?: string; data: Record<string, any> }> = [];
    return {
      delete(ref: { path: string }) {
        deletes.push(ref.path);
      },
      update(ref: { path?: string }, data: Record<string, any>) {
        state.jobUpdates.push(data);
        updates.push({ path: ref.path, data });
      },
      async commit() {
        state.batchSizes.push(deletes.length);
        for (const path of deletes) {
          state.docs.delete(path);
          state.jobData.delete(path);
        }
        for (const update of updates) {
          if (update.path) {
            state.jobData.set(update.path, {
              ...(state.jobData.get(update.path) ?? {}),
              ...update.data,
            });
          }
        }
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
  listRecoverableDeletionJobs,
  markDeletionComplete,
  markDeletionFailed,
  readDeletionStatusWithRecoveryCredential,
  registerDeletionRecoveryCredential,
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
    expect(persisted.receiptHashes).toEqual([hashReceipt(firstReceipt), hashReceipt(secondReceipt)]);
  });

  it('rejects an unbounded growth of recovery receipts without invalidating existing devices', async () => {
    const receipts = Array.from({ length: 32 }, (_, index) =>
      Buffer.alloc(32, index + 1).toString('base64url')
    );
    for (const receipt of receipts) await createOrRefreshDeletionJob('u', receipt);
    const extraReceipt = Buffer.alloc(32, 99).toString('base64url');
    await expect(createOrRefreshDeletionJob('u', extraReceipt))
      .rejects.toThrow('Numero massimo di dispositivi di recovery raggiunto');
    await expect(readAuthorizedDeletionJob('u', receipts[0])).resolves.not.toBeNull();
    await expect(readAuthorizedDeletionJob('u', receipts.at(-1)!)).resolves.not.toBeNull();
    await expect(readAuthorizedDeletionJob('u', extraReceipt)).resolves.toBeNull();
  });

  it('preregisters a device credential as a hash and preserves proof through the completed tombstone', async () => {
    const credential = Buffer.alloc(32, 7).toString('base64url');
    const receipt = Buffer.alloc(32, 8).toString('base64url');

    await registerDeletionRecoveryCredential('u', credential);
    const registration = state.jobData.get('account_deletion_recovery/u')!;
    expect(registration.credentialHashes).toEqual([hashReceipt(credential)]);
    expect(JSON.stringify(registration)).not.toContain(credential);

    await createOrRefreshDeletionJob('u', receipt);
    await expect(readDeletionStatusWithRecoveryCredential('u', credential))
      .resolves.toMatchObject({ uid: 'u', status: 'requested' });

    await markDeletionComplete('u');
    expect(state.docs.has('account_deletion_recovery/u')).toBe(false);
    await expect(readDeletionStatusWithRecoveryCredential('u', credential))
      .resolves.toMatchObject({ uid: 'u', status: 'complete' });
  });

  it('selects only due recovery jobs so non-retryable failures cannot starve later work', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    for (let index = 0; index < 30; index++) {
      const path = `account_deletions/nonretryable-${index}`;
      state.docs.add(path);
      state.jobData.set(path, {
        uid: `nonretryable-${index}`,
        status: 'failed',
        retryable: false,
        attempts: 1,
      });
    }
    for (const [uid, offset] of [['late', -10], ['first', -30], ['second', -20]] as const) {
      const path = `account_deletions/${uid}`;
      state.docs.add(path);
      state.jobData.set(path, {
        uid,
        status: 'requested',
        attempts: 0,
        nextAttemptAt: Timestamp.fromMillis(now.toMillis() + offset),
      });
    }

    await expect(listRecoverableDeletionJobs(2, now)).resolves.toEqual([
      expect.objectContaining({ uid: 'first' }),
      expect.objectContaining({ uid: 'second' }),
    ]);
  });

  it('backs off retryable failures and removes non-retryable failures from automatic recovery eligibility', async () => {
    const retryPath = 'account_deletions/retry';
    state.docs.add(retryPath);
    state.jobData.set(retryPath, {
      uid: 'retry',
      status: 'deleting',
      attempts: 3,
      nextAttemptAt: Timestamp.fromMillis(1),
    });
    await markDeletionFailed('retry', 'root', new Error('temporary'), true);
    expect(millis(state.jobData.get(retryPath)!.nextAttemptAt)).toBeGreaterThan(Date.now());

    const stopPath = 'account_deletions/stop';
    state.docs.add(stopPath);
    state.jobData.set(stopPath, {
      uid: 'stop',
      status: 'deleting',
      attempts: 1,
      nextAttemptAt: Timestamp.fromMillis(1),
    });
    await markDeletionFailed('stop', 'verification', new Error('manual'), false);

    const due = await listRecoverableDeletionJobs(20, Timestamp.fromMillis(Date.now() + 10 * 60 * 60 * 1000));
    expect(due.map(job => job.uid)).not.toContain('stop');
  });

  it('starts the 30-day tombstone retention window only after deletion is complete', async () => {
    state.docs.add('account_deletions/u');
    state.jobData.set('account_deletions/u', {
      uid: 'u',
      status: 'verifying',
      attempts: 1,
      receiptHash: hashReceipt('A'.repeat(43)),
    });
    await markDeletionComplete('u');

    const update = state.jobUpdates.at(-1) as {
      status?: string;
      updatedAt?: { toMillis: () => number };
      purgeAfter?: { toMillis: () => number };
      purgeEligibleAt?: { toMillis: () => number };
    };
    expect(update.status).toBe('complete');
    expect(update.updatedAt).toBeDefined();
    expect(update.purgeAfter).toBeDefined();
    expect(update.purgeEligibleAt?.toMillis()).toBe(update.purgeAfter?.toMillis());
    expect(update.purgeAfter!.toMillis() - update.updatedAt!.toMillis())
      .toBe(ACCOUNT_DELETION_COMPLETED_RETENTION_MS);
  });
});
