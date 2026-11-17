import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  active: [] as Array<{ id: string; updated: number; status?: string; retryable?: boolean }>,
  failed: [] as Array<{ id: string; updated: number; status?: string; retryable?: boolean }>,
  healthBusy: new Set<string>(),
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
      // Apply the actual Firestore predicates supplied by production. A
      // missing or broadened where() must change the rows returned here.
      const rows = [
        ...state.active.map(item => ({ ...item, status: item.status ?? 'requested', retryable: item.retryable ?? false })),
        ...state.failed.map(item => ({ ...item, status: item.status ?? 'failed', retryable: item.retryable ?? true })),
      ];
      const filtered = rows.filter(item => filters.every(([field, op, value]) => {
        if (field === 'status' && op === 'in' && Array.isArray(value)) return value.includes(item.status);
        if (field === 'status' && op === '==') return item.status === value;
        if (field === 'retryable' && op === '==') return item.retryable === value;
        throw new Error('Unsupported Firestore query predicate: ' + field + ' ' + op);
      }));
      const docs = filtered.sort((a, b) => a.updated - b.updated).slice(0, count)
        .map(item => ({ id: item.id, data: () => ({
          uid: item.id, status: item.status,
          retryable: item.retryable, attempts: 1, updatedAt: { toMillis: () => item.updated },
        }) }));
      return { docs, empty: docs.length === 0 };
    } }; },
  };
}

vi.mock('../../../server/accountDeletion/firebaseAdmin', () => ({
  adminDb: () => ({
    collection: (name: string) => ({
      ...query(),
      doc: (id: string) => ({
        id,
        async get() {
          if (name === 'health_data_erasures') {
            return { exists: state.healthBusy.has(id), data: () => ({ uid: id, status: 'deleting' }) };
          }
          const item = [...state.active, ...state.failed].find(row => row.id === id);
          return { exists: !!item, data: () => item && ({
            uid: id, status: item.status ?? 'requested', attempts: 0,
            updatedAt: { toMillis: () => item.updated },
          }) };
        },
      }),
    }),
    async runTransaction(work: (transaction: any) => Promise<any>) {
      const writes: Array<{ id: string; updatedAt: number }> = [];
      const result = await work({
        get: (ref: any) => ref.get(),
        update: (ref: any, value: { updatedAt: { toMillis(): number } }) =>
          writes.push({ id: ref.id, updatedAt: value.updatedAt.toMillis() }),
      });
      for (const write of writes) {
        const item = [...state.active, ...state.failed].find(row => row.id === write.id);
        if (item) item.updated = write.updatedAt;
      }
      return result;
    },
  }),
  adminAuth: () => ({}),
}));
import { acquireDeletionLease, listRecoverableDeletionJobs } from '../../../server/accountDeletion/jobStore';

describe('account deletion recovery fairness', () => {
  it('processes the next eligible candidate after 25 health-blocked jobs are deferred', async () => {
    state.active = Array.from({ length: 25 }, (_, i) => ({ id: 'busy-' + i, updated: 100 + i }));
    state.active.push({ id: 'eligible', updated: 200 });
    state.failed = [];
    state.healthBusy = new Set(state.active.slice(0, 25).map(item => item.id));

    const first = await listRecoverableDeletionJobs(25);
    expect(first).toHaveLength(25);
    expect(first.every(job => state.healthBusy.has(job.uid))).toBe(true);
    for (const job of first) {
      expect(await acquireDeletionLease(job.uid, 'recovery', Date.now() + 60_000)).toBe(false);
    }
    const next = await listRecoverableDeletionJobs(25);
    expect(next[0].uid).toBe('eligible');
    expect(state.active.slice(0, 25).every(item => item.status === undefined)).toBe(true);
    state.healthBusy.clear();
  });

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

  it('excludes completed and non-retryable jobs even when they are older', async () => {
    state.active = [
      { id: 'completed', updated: 1, status: 'complete' },
      { id: 'active', updated: 4 },
    ];
    state.failed = [
      { id: 'blocked', updated: 2, retryable: false },
      { id: 'retry', updated: 3 },
    ];
    const jobs = await listRecoverableDeletionJobs(25);
    expect(jobs.map(job => job.uid)).toEqual(['retry', 'active']);
  });
});
