import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

const state = vi.hoisted(() => ({
  jobs: [] as Array<{ id: string; data: Record<string, unknown> }>,
  devices: new Set<string>(),
  failUid: '' as string,
  deleted: [] as string[],
  updated: [] as Array<{ path: string; purgeAfter: Timestamp }>,
  onQuery: null as null | (() => void),
}));

const fakeDb = vi.hoisted(() => ({
  collection(name: string) {
    if (name === 'account_deletion_devices') return {
      doc: (uid: string) => ({ id: uid, path: 'account_deletion_devices/' + uid }),
    };
    if (name !== 'account_deletions') throw new Error('Unexpected collection');
    const millis = (value: unknown): number => value instanceof Timestamp ? value.toMillis() : Number.NaN;
    const query = (
      filters: Array<{ field: string; op: string; value: unknown }> = [],
      order: string | null = null,
      after: { id: string; expiry: number } | null = null,
    ): any => ({
      where(field: string, op: string, value: unknown) {
        return query([...filters, { field, op, value }], order, after);
      },
      orderBy(field: string) {
        if (field !== 'purgeAfter') throw new Error('Unsupported Firestore ordering');
        return query(filters, field, after);
      },
      // Firestore cursors carry the snapshot's ordered field values, even after
      // the document has been deleted by the preceding transaction.
      startAfter(document: { id: string; data: () => Record<string, unknown> }) {
        return query(filters, order, { id: document.id, expiry: millis(document.data().purgeAfter) });
      },
      limit(count: number) { return { async get() {
        if (order !== 'purgeAfter') throw new Error('Retention query must order by expiry');
        const matching = state.jobs.filter(job => filters.every(({ field, op, value }) => {
          if (field === 'status' && op === '==') return job.data.status === value;
          if (field === 'purgeAfter' && op === '<=') return millis(job.data.purgeAfter) <= millis(value);
          throw new Error('Unsupported Firestore query predicate: ' + field + ' ' + op);
        })).sort((left, right) =>
          millis(left.data.purgeAfter) - millis(right.data.purgeAfter) || left.id.localeCompare(right.id));
        const remaining = after ? matching.filter(job => {
          const expiry = millis(job.data.purgeAfter);
          return expiry > after.expiry || (expiry === after.expiry && job.id > after.id);
        }) : matching;
        const docs = remaining.slice(0, count).map(job => {
          // Firestore query snapshots are immutable, even if a transaction
          // changes the underlying document before the next page is fetched.
          const data = { ...job.data };
          return { id: job.id, ref: { id: job.id, path: 'account_deletions/' + job.id }, data: () => data };
        });
        const callback = state.onQuery;
        state.onQuery = null;
        callback?.();
        return { docs, empty: docs.length === 0 };
      } }; },
    });
    return query();
  },
  async runTransaction(work: (tx: any) => Promise<unknown>) {
    const operations: Array<{ kind: 'delete' | 'update'; path: string; data?: Record<string, unknown> }> = [];
    const tx = {
      async get(ref: { path: string; id: string }) {
        if (ref.path.startsWith('account_deletion_devices/')) return { exists: state.devices.has(ref.id) };
        const job = state.jobs.find(x => x.id === ref.id);
        return { exists: Boolean(job), data: () => job?.data };
      },
      delete(ref: { path: string }) { operations.push({ kind: 'delete', path: ref.path }); },
      update(ref: { path: string }, data: Record<string, unknown>) {
        operations.push({ kind: 'update', path: ref.path, data });
      },
    };
    const result = await work(tx);
    if (state.failUid && operations.some(op => op.path.endsWith('/' + state.failUid))) throw new Error('firestore unavailable');
    for (const operation of operations) {
      const { path } = operation;
      if (operation.kind === 'update') {
        const record = state.jobs.find(job => job.id === path.split('/')[1]);
        if (!record) throw new Error('Missing job for update');
        record.data = { ...record.data, ...operation.data };
        state.updated.push({ path, purgeAfter: operation.data!.purgeAfter as Timestamp });
      } else {
        state.deleted.push(path);
        if (path.startsWith('account_deletion_devices/')) state.devices.delete(path.split('/')[1]);
        else state.jobs = state.jobs.filter(x => x.id !== path.split('/')[1]);
      }
    }
    return result;
  },
}));
vi.mock('../server/accountDeletion/firebaseAdmin', () => ({ adminDb: () => fakeDb }));
import { completedDeletionPurgeAfter, purgeExpiredCompletedDeletionJobs, ACCOUNT_DELETION_COMPLETED_RETENTION_MS, type AccountDeletionRetentionPage } from '../server/accountDeletion/retention';

const OLD = Timestamp.fromMillis(2_000_000_000_000);
const EXPIRED = Timestamp.fromMillis(1);

describe('atomic completed account deletion retention', () => {
  beforeEach(() => {
    state.jobs = []; state.devices = new Set(); state.failUid = ''; state.deleted = [];
    state.updated = []; state.onQuery = null;
  });

  it('schedules tombstones 30 days after completion', () => {
    expect(completedDeletionPurgeAfter(OLD).toMillis()).toBe(OLD.toMillis() + ACCOUNT_DELETION_COMPLETED_RETENTION_MS);
  });

  it('deletes each expired completed tombstone and device registry together', async () => {
    state.jobs = [
      { id: 'a', data: { uid: 'a', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: EXPIRED } },
      { id: 'b', data: { uid: 'b', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: EXPIRED } },
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

  it('filters on the real query fields and purges in expiry order, not insertion order', async () => {
    const later = Timestamp.fromMillis(100);
    const future = Timestamp.fromMillis(Date.now() + 60_000);
    state.jobs = [
      { id: 'later', data: { uid: 'later', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: later } },
      { id: 'future', data: { uid: 'future', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: future } },
      { id: 'pending', data: { uid: 'pending', status: 'deleting', purgeAfter: EXPIRED } },
      { id: 'earlier', data: { uid: 'earlier', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: EXPIRED } },
    ];
    expect(await purgeExpiredCompletedDeletionJobs(400)).toBe(2);
    expect(state.deleted).toEqual([
      'account_deletions/earlier', 'account_deletions/later',
    ]);
    expect(state.jobs.map(job => job.id)).toEqual(['future', 'pending']);
  });

  it('rolls back both deletions if transaction commit fails', async () => {
    state.jobs = [{ id: 'a', data: { uid: 'a', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: EXPIRED } }];
    state.devices.add('a'); state.failUid = 'a';
    await expect(purgeExpiredCompletedDeletionJobs()).rejects.toThrow('firestore unavailable');
    expect(state.deleted).toEqual([]);
    expect(state.devices.has('a')).toBe(true);
    expect(state.jobs).toHaveLength(1);
  });

  it('never deletes another owners registry when job UID is corrupt', async () => {
    state.jobs = [{ id: 'a', data: { uid: 'other', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: EXPIRED } }];
    state.devices.add('other');
    expect(await purgeExpiredCompletedDeletionJobs()).toBe(0);
    expect(state.deleted).toEqual([]);
    expect(state.devices.has('other')).toBe(true);
  });

  it('walks past a full page of corrupt receipts without deleting another user registry', async () => {
    state.jobs = Array.from({ length: 400 }, (_, index) => ({
      id: `invalid-${String(index).padStart(3, '0')}`,
      data: { uid: 'another-user', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: EXPIRED },
    }));
    state.jobs.push({ id: 'valid', data: { uid: 'valid', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: EXPIRED } });
    state.devices.add('another-user');
    state.devices.add('valid');
    const progress: AccountDeletionRetentionPage = { scanned: 0 };
    expect(await purgeExpiredCompletedDeletionJobs(400, undefined, Infinity, progress)).toBe(0);
    expect(progress.scanned).toBe(400);
    expect(await purgeExpiredCompletedDeletionJobs(400, undefined, Infinity, progress)).toBe(1);
    expect(progress.scanned).toBe(1);
    expect(state.devices.has('another-user')).toBe(true);
    expect(state.devices.has('valid')).toBe(false);
    expect(state.jobs).toHaveLength(400);
  });

  it('continues past a deleted last-document cursor without skipping equal-expiry receipts', async () => {
    state.jobs = Array.from({ length: 401 }, (_, index) => ({
      id: `uid-${String(index).padStart(3, '0')}`,
      data: { uid: `uid-${String(index).padStart(3, '0')}`, status: 'complete', cursor: { phase: 'complete' }, purgeAfter: EXPIRED },
    }));
    const progress: AccountDeletionRetentionPage = { scanned: 0 };

    expect(await purgeExpiredCompletedDeletionJobs(400, undefined, Infinity, progress)).toBe(400);
    expect(progress.scanned).toBe(400);
    expect(state.jobs.map(job => job.id)).toEqual(['uid-400']);

    // The first page's last snapshot is gone from Firestore; the cursor must
    // still compare its purgeAfter plus document ID, not query for the old ID.
    expect(await purgeExpiredCompletedDeletionJobs(400, undefined, Infinity, progress)).toBe(1);
    expect(progress.scanned).toBe(1);
    expect(state.jobs).toEqual([]);
    expect(state.deleted.filter(path => path.startsWith('account_deletions/'))).toHaveLength(401);
  });


  it('retains a false complete status without the final worker cursor and defers its review', async () => {
    state.jobs = [{ id: 'unverified', data: {
      uid: 'unverified', status: 'complete', purgeAfter: EXPIRED,
      cursor: { phase: 'verifying' },
    } }];
    state.devices.add('unverified');
    expect(await purgeExpiredCompletedDeletionJobs(400)).toBe(0);
    expect(state.deleted).toEqual([]);
    expect(state.devices.has('unverified')).toBe(true);
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0].purgeAfter.toMillis()).toBeGreaterThan(Date.now());
    expect(await purgeExpiredCompletedDeletionJobs(400)).toBe(0);
    expect(state.updated).toHaveLength(1);
  });

  it('allows a valid expired owner beyond 400 corrupt receipts on the next cron run', async () => {
    state.jobs = Array.from({ length: 400 }, (_, i) => ({
      id: `invalid-${String(i).padStart(3, '0')}`,
      data: { uid: 'another-owner', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: EXPIRED },
    }));
    state.jobs.push({ id: 'valid', data: {
      uid: 'valid', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: EXPIRED,
    } });
    state.devices = new Set(['another-owner', 'valid']);
    expect(await purgeExpiredCompletedDeletionJobs(400)).toBe(0);
    expect(state.updated).toHaveLength(400);
    expect(state.deleted).toEqual([]);
    // A new invocation does not reuse the previous in-memory page cursor.
    expect(await purgeExpiredCompletedDeletionJobs(400)).toBe(1);
    expect(state.devices.has('another-owner')).toBe(true);
    expect(state.devices.has('valid')).toBe(false);
    expect(state.jobs.filter(job => job.id === 'valid')).toHaveLength(0);
    expect(state.jobs).toHaveLength(400);
  });

  it('rejects a stale query result when the job is no longer completed in the transaction', async () => {
    state.jobs = [{ id: 'owner', data: {
      uid: 'owner', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: EXPIRED,
    } }];
    state.devices.add('owner');
    state.onQuery = () => { state.jobs[0].data = { ...state.jobs[0].data, status: 'deleting' }; };
    expect(await purgeExpiredCompletedDeletionJobs()).toBe(0);
    expect(state.deleted).toEqual([]);
    expect(state.updated).toEqual([]);
    expect(state.devices.has('owner')).toBe(true);
  });

  it('leaves an unsafe receipt untouched on transaction failure, including its retry date', async () => {
    state.jobs = [{ id: 'broken', data: {
      uid: 'foreign', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: EXPIRED,
    } }];
    state.failUid = 'broken';
    await expect(purgeExpiredCompletedDeletionJobs()).rejects.toThrow('firestore unavailable');
    expect(state.jobs[0].data.purgeAfter).toEqual(EXPIRED);
    expect(state.updated).toEqual([]);
    expect(state.deleted).toEqual([]);
  });

  it('does no destructive work when budget is exhausted', async () => {
    state.jobs = [{ id: 'a', data: { uid: 'a', status: 'complete', cursor: { phase: 'complete' }, purgeAfter: EXPIRED } }];
    expect(await purgeExpiredCompletedDeletionJobs(400, OLD, Date.now() + 1_000)).toBe(0);
    expect(state.deleted).toEqual([]);
  });
});
