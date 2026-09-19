import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

const state = vi.hoisted(() => ({
  docs: [] as Array<{ path: string; data: Record<string, unknown> }>,
  deleted: [] as string[],
  committed: 0,
}));

const fakeDb = vi.hoisted(() => ({
  collection(name: string) {
    return {
      where(field: string, operator: string, value: { toMillis: () => number }) {
        if (name !== 'account_deletions' || field !== 'purgeAfter' || operator !== '<=') {
          throw new Error('Unexpected retention query');
        }
        return {
          limit(count: number) {
            return {
              async get() {
                const cutoff = value.toMillis();
                const docs = state.docs
                  .filter(item => {
                    const purgeAfter = item.data.purgeAfter;
                    return Boolean(
                      purgeAfter
                      && typeof purgeAfter === 'object'
                      && 'toMillis' in purgeAfter
                      && typeof (purgeAfter as { toMillis?: unknown }).toMillis === 'function'
                      && (purgeAfter as { toMillis: () => number }).toMillis() <= cutoff,
                    );
                  })
                  .slice(0, count)
                  .map(item => ({
                    ref: { path: item.path },
                    data: () => item.data,
                  }));
                return { empty: docs.length === 0, docs };
              },
            };
          },
        };
      },
    };
  },
  batch() {
    const deletes: string[] = [];
    return {
      delete(ref: { path: string }) {
        deletes.push(ref.path);
      },
      async commit() {
        state.committed += 1;
        state.deleted.push(...deletes);
        state.docs = state.docs.filter(item => !deletes.includes(item.path));
      },
    };
  },
}));

vi.mock('../server/accountDeletion/firebaseAdmin', () => ({
  adminDb: () => fakeDb,
}));

import {
  ACCOUNT_DELETION_COMPLETED_RETENTION_MS,
  completedDeletionPurgeAfter,
  purgeExpiredCompletedDeletionJobs,
} from '../server/accountDeletion/retention';

describe('M7 completed account deletion retention', () => {
  beforeEach(() => {
    state.docs = [];
    state.deleted = [];
    state.committed = 0;
  });

  it('schedules completed tombstones exactly 30 days after completion', () => {
    const now = Timestamp.fromMillis(1_700_000_000_000);
    expect(completedDeletionPurgeAfter(now).toMillis())
      .toBe(now.toMillis() + ACCOUNT_DELETION_COMPLETED_RETENTION_MS);
  });

  it('deletes only expired complete tombstones and preserves every other job', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    state.docs = [
      {
        path: 'account_deletions/expired-complete',
        data: { status: 'complete', purgeAfter: Timestamp.fromMillis(now.toMillis() - 1) },
      },
      {
        path: 'account_deletions/future-complete',
        data: { status: 'complete', purgeAfter: Timestamp.fromMillis(now.toMillis() + 60_000) },
      },
      {
        path: 'account_deletions/corrupt-active',
        data: { status: 'deleting', purgeAfter: Timestamp.fromMillis(now.toMillis() - 1) },
      },
      {
        path: 'account_deletions/no-expiry',
        data: { status: 'complete' },
      },
    ];

    await expect(purgeExpiredCompletedDeletionJobs(400, now)).resolves.toBe(1);

    expect(state.deleted).toEqual(['account_deletions/expired-complete']);
    expect(state.docs.map(item => item.path)).toEqual([
      'account_deletions/future-complete',
      'account_deletions/corrupt-active',
      'account_deletions/no-expiry',
    ]);
    expect(state.committed).toBe(1);
  });

  it('does not commit a batch when no eligible tombstone is due', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    state.docs = [
      {
        path: 'account_deletions/active',
        data: { status: 'verifying', purgeAfter: Timestamp.fromMillis(now.toMillis() - 1) },
      },
    ];

    await expect(purgeExpiredCompletedDeletionJobs(400, now)).resolves.toBe(0);
    expect(state.deleted).toEqual([]);
    expect(state.committed).toBe(0);
  });
});
