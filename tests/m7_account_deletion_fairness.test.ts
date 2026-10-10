import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  active: [] as Array<{ id: string; updated: number }>,
  failed: [] as Array<{ id: string; updated: number }>,
}));

function query(filters: Array<[string, string, unknown]> = [], sorted = false): any {
  return {
    where(field: string, op: string, value: unknown) { return query([...filters, [field, op, value]], sorted); },
    orderBy(field: string, direction: string) {
      if (field !== 'updatedAt' || direction !== 'asc') throw new Error('Recovery must sort on the server');
      return query(filters, true);
    },
    limit(count: number) { return { async get() {
      if (!sorted) throw new Error('limit-before-orderBy would starve old jobs');
      const failed = filters.some(([field, op, value]) => field === 'status' && op === '==' && value === 'failed');
      const pool = failed ? state.failed : state.active;
      const docs = [...pool].sort((a, b) => a.updated - b.updated).slice(0, count)
        .map(item => ({ id: item.id, data: () => ({
          uid: item.id, status: failed ? 'failed' : 'requested',
          retryable: failed, attempts: 1, updatedAt: { toMillis: () => item.updated },
        }) }));
      return { docs, empty: docs.length === 0 };
    } }; },
  };
}
vi.mock('../server/accountDeletion/firebaseAdmin', () => ({
  adminDb: () => ({ collection: () => query() }),
  adminAuth: () => ({}),
}));
import { listRecoverableDeletionJobs } from '../server/accountDeletion/jobStore';

describe('account deletion recovery fairness', () => {
  it('selects the 25 oldest jobs despite 60 eligible jobs and makes forward progress on successive runs', async () => {
    state.active = Array.from({ length: 30 }, (_, i) => ({ id: 'active-' + i, updated: 100 + i }));
    state.failed = Array.from({ length: 30 }, (_, i) => ({ id: 'retry-' + i, updated: 200 + i }));
    const seen = new Set<string>();
    for (let run = 0; run < 3; run += 1) {
      const jobs = await listRecoverableDeletionJobs(25);
      expect(jobs).toHaveLength(25);
      for (const job of jobs) {
        seen.add(job.uid);
        const item = [...state.active, ...state.failed].find(x => x.id === job.uid)!;
        item.updated = 10_000 + run * 100 + Number(job.uid.split('-').at(-1));
      }
    }
    expect(seen.size).toBe(60);
  });

  it('orders the retryable and active queues together by oldest timestamp', async () => {
    state.active = [{ id: 'active', updated: 200 }];
    state.failed = [{ id: 'retry', updated: 100 }];
    const jobs = await listRecoverableDeletionJobs(25);
    expect(jobs.map(x => x.uid)).toEqual(['retry', 'active']);
  });
});
