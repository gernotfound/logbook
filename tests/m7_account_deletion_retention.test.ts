import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

const state = vi.hoisted(() => ({
  jobs: [] as Array<{ id: string; data: Record<string, unknown> }>,
  devices: new Set<string>(),
  failUid: '' as string,
  deleted: [] as string[],
}));

const fakeDb = vi.hoisted(() => ({
  collection(name: string) {
    if (name === 'account_deletion_devices') return {
      doc: (uid: string) => ({ id: uid, path: 'account_deletion_devices/' + uid }),
    };
    if (name !== 'account_deletions') throw new Error('Unexpected collection');
    return {
      where() { return this; },
      limit(count: number) { return { async get() {
        const docs = state.jobs.filter(job => job.data.status === 'complete'
          && (job.data.purgeAfter as Timestamp)?.toMillis() <= Date.now())
          .slice(0, count).map(job => ({ id: job.id, ref: { id: job.id, path: 'account_deletions/' + job.id }, data: () => job.data }));
        return { docs, empty: docs.length === 0 };
      } }; },
    };
  },
  async runTransaction(work: (tx: any) => Promise<unknown>) {
    const paths: string[] = [];
    const tx = {
      async get(ref: { path: string; id: string }) {
        if (ref.path.startsWith('account_deletion_devices/')) return { exists: state.devices.has(ref.id) };
        const job = state.jobs.find(x => x.id === ref.id);
        return { exists: Boolean(job), data: () => job?.data };
      },
      delete(ref: { path: string }) { paths.push(ref.path); },
    };
    const result = await work(tx);
    if (paths.some(path => path.endsWith('/' + state.failUid)) && state.failUid) throw new Error('firestore unavailable');
    for (const path of paths) {
      state.deleted.push(path);
      if (path.startsWith('account_deletion_devices/')) state.devices.delete(path.split('/')[1]);
      else state.jobs = state.jobs.filter(x => x.id !== path.split('/')[1]);
    }
    return result;
  },
}));
vi.mock('../server/accountDeletion/firebaseAdmin', () => ({ adminDb: () => fakeDb }));
import { completedDeletionPurgeAfter, purgeExpiredCompletedDeletionJobs, ACCOUNT_DELETION_COMPLETED_RETENTION_MS } from '../server/accountDeletion/retention';

const OLD = Timestamp.fromMillis(2_000_000_000_000);
const EXPIRED = Timestamp.fromMillis(1);

describe('atomic completed account deletion retention', () => {
  beforeEach(() => {
    state.jobs = []; state.devices = new Set(); state.failUid = ''; state.deleted = [];
  });

  it('schedules tombstones 30 days after completion', () => {
    expect(completedDeletionPurgeAfter(OLD).toMillis()).toBe(OLD.toMillis() + ACCOUNT_DELETION_COMPLETED_RETENTION_MS);
  });

  it('deletes each expired completed tombstone and device registry together', async () => {
    state.jobs = [
      { id: 'a', data: { uid: 'a', status: 'complete', purgeAfter: EXPIRED } },
      { id: 'b', data: { uid: 'b', status: 'complete', purgeAfter: EXPIRED } },
      { id: 'pending', data: { uid: 'pending', status: 'deleting', purgeAfter: EXPIRED } },
    ];
    state.devices = new Set(['a', 'b', 'pending']);
    expect(await purgeExpiredCompletedDeletionJobs(400)).toBe(2);
    expect(state.deleted).toEqual([
      'account_deletion_devices/a', 'account_deletions/a',
      'account_deletion_devices/b', 'account_deletions/b',
    ]);
    expect(state.devices.has('pending')).toBe(true);
    expect(state.jobs.map(x => x.id)).toEqual(['pending']);
  });

  it('rolls back both deletions if transaction commit fails', async () => {
    state.jobs = [{ id: 'a', data: { uid: 'a', status: 'complete', purgeAfter: EXPIRED } }];
    state.devices.add('a'); state.failUid = 'a';
    await expect(purgeExpiredCompletedDeletionJobs()).rejects.toThrow('firestore unavailable');
    expect(state.deleted).toEqual([]);
    expect(state.devices.has('a')).toBe(true);
    expect(state.jobs).toHaveLength(1);
  });

  it('never deletes another owners registry when job UID is corrupt', async () => {
    state.jobs = [{ id: 'a', data: { uid: 'other', status: 'complete', purgeAfter: EXPIRED } }];
    state.devices.add('other');
    expect(await purgeExpiredCompletedDeletionJobs()).toBe(0);
    expect(state.deleted).toEqual([]);
    expect(state.devices.has('other')).toBe(true);
  });

  it('does no destructive work when budget is exhausted', async () => {
    state.jobs = [{ id: 'a', data: { uid: 'a', status: 'complete', purgeAfter: EXPIRED } }];
    expect(await purgeExpiredCompletedDeletionJobs(400, OLD, Date.now() + 1_000)).toBe(0);
    expect(state.deleted).toEqual([]);
  });
});
