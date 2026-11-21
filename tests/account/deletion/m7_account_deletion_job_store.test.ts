import { beforeEach, describe, vi } from 'vitest';
import { registerDeletionLeaseCases } from './deletionLeaseCases';
import { registerDeletionResidueCases } from './deletionResidueCases';
import { registerDeletionReceiptCases } from './deletionReceiptCases';
import { registerDeletionWorkerRecoveryCases } from './deletionWorkerRecoveryCases';

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
    // Include nonexistent parent refs with descendants, like Firestore showMissing.
    async listDocuments() {
      const prefix = path + '/';
      const ids = new Set([...state.docs]
        .filter(candidate => candidate.startsWith(prefix))
        .map(candidate => candidate.slice(prefix.length).split('/')[0]));
      return [...ids].map(id => fakeDocument(prefix + id));
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

vi.mock('../../../server/accountDeletion/firebaseAdmin', () => ({
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
  deleteAccountKeyAfterVerification,
  deleteAuthUserLast,
  deletePrivateCollectionPage,
  deleteUserRoot,
  hashReceipt,
  markDeletionComplete,
  readAuthorizedDeletionJob,
  readDeletionStatus,
  readDeletionStatusForUid,
  validateReceipt,
  verifyNoAccountResidue,
} from '../../../server/accountDeletion/jobStore';
import { ACCOUNT_DELETION_COMPLETED_RETENTION_MS } from '../../../server/accountDeletion/retention';

function stageDeletionJob(uid: string) {
  const path = 'account_deletions/' + uid;
  state.docs.add(path);
  state.jobData.set(path, { uid, status: 'requested', attempts: 0 });
}


const context = {
  state, stageDeletionJob, NonRetryableDeletionError, DeletionLeaseLostError,
  acquireDeletionLease, parkDeletion, markDeletionFailed, createOrRefreshDeletionJob,
  deleteAccountKeyAfterVerification, deleteAuthUserLast, deletePrivateCollectionPage,
  deleteUserRoot, hashReceipt, markDeletionComplete, readAuthorizedDeletionJob,
  readDeletionStatus, readDeletionStatusForUid, validateReceipt,
  verifyNoAccountResidue, ACCOUNT_DELETION_COMPLETED_RETENTION_MS,
};
export type DeletionJobStoreTestContext = typeof context;

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

  registerDeletionLeaseCases(context);
  registerDeletionResidueCases(context);
  registerDeletionReceiptCases(context);
  registerDeletionWorkerRecoveryCases(context);
});
