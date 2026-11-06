import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

const state = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  onQuery: null as null | (() => void),
  writes: [] as Array<{ kind: string; path: string }>,
}));

function doc(path: string) {
  return {
    path, id: path.split('/').at(-1)!,
    async get() {
      const data = state.docs.get(path);
      return { exists: data !== undefined, data: () => data };
    },
  };
}
class FakeQuery {
  constructor(
    private name: string,
    private cutoff = Number.POSITIVE_INFINITY,
    private limitCount = 100,
    private cursor: { id: string; data: () => Record<string, unknown> } | null = null,
  ) {}
  where(field: string, comparison: string, value: Timestamp) {
    expect(field).toBe('lastSeenAt');
    expect(comparison).toBe('<=');
    return new FakeQuery(this.name, value.toMillis(), this.limitCount, this.cursor);
  }
  orderBy(field: string, direction: string) {
    expect([field, direction]).toEqual(['lastSeenAt', 'asc']);
    return this;
  }
  limit(count: number) {
    return new FakeQuery(this.name, this.cutoff, count, this.cursor);
  }
  startAfter(cursor: { id: string; data: () => Record<string, unknown> }) {
    return new FakeQuery(this.name, this.cutoff, this.limitCount, cursor);
  }
  async get() {
    const docs = [...state.docs.entries()]
      .filter(([path, value]) => path.startsWith(this.name + '/') && path.split('/').length === 2
        && value.lastSeenAt instanceof Timestamp && value.lastSeenAt.toMillis() <= this.cutoff)
      .map(([path, value]) => ({ id: path.split('/')[1], data: () => value }))
      .sort((a, b) => (a.data().lastSeenAt as Timestamp).toMillis() - (b.data().lastSeenAt as Timestamp).toMillis()
        || a.id.localeCompare(b.id));
    const start = this.cursor ? docs.findIndex(x => x.id === this.cursor!.id) + 1 : 0;
    // In real Firestore a deleted snapshot still supplies an order-by cursor.
    const effectiveStart = this.cursor && start === 0
      ? docs.findIndex(x => (x.data().lastSeenAt as Timestamp).toMillis() > (this.cursor!.data().lastSeenAt as Timestamp).toMillis())
      : start;
    const page = docs.slice(Math.max(0, effectiveStart), Math.max(0, effectiveStart) + this.limitCount);
    const callback = state.onQuery;
    state.onQuery = null;
    callback?.();
    return { docs: page, size: page.length };
  }
}
vi.mock('../server/accountDeletion/firebaseAdmin', () => ({
  adminDb: () => ({
    collection(name: string) {
      return { doc: (id: string) => doc(name + '/' + id), where: (field: string, comparison: string, value: Timestamp) => new FakeQuery(name).where(field, comparison, value) };
    },
    async runTransaction<T>(fn: (tx: {
      get: (ref: ReturnType<typeof doc>) => Promise<unknown>;
      create: (ref: ReturnType<typeof doc>, data: Record<string, unknown>) => void;
      update: (ref: ReturnType<typeof doc>, data: Record<string, unknown>) => void;
      delete: (ref: ReturnType<typeof doc>) => void;
    }) => Promise<T>): Promise<T> {
      const operations: Array<{ kind: string; path: string; data?: Record<string, unknown> }> = [];
      const tx = {
        get: (ref: ReturnType<typeof doc>) => ref.get(),
        create: (ref: ReturnType<typeof doc>, data: Record<string, unknown>) => operations.push({ kind: 'create', path: ref.path, data }),
        update: (ref: ReturnType<typeof doc>, data: Record<string, unknown>) => operations.push({ kind: 'update', path: ref.path, data }),
        delete: (ref: ReturnType<typeof doc>) => operations.push({ kind: 'delete', path: ref.path }),
      };
      const result = await fn(tx);
      for (const operation of operations) {
        state.writes.push({ kind: operation.kind, path: operation.path });
        if (operation.kind === 'create') {
          if (state.docs.has(operation.path)) throw new Error('Document already exists');
          state.docs.set(operation.path, operation.data!);
        } else if (operation.kind === 'update') {
          if (!state.docs.has(operation.path)) throw new Error('Document missing');
          state.docs.set(operation.path, { ...state.docs.get(operation.path), ...operation.data });
        } else state.docs.delete(operation.path);
      }
      return result;
    },
  }),
  adminAuth: () => { throw new Error('No Auth mutation expected'); },
}));

import {
  AccountDeletionAlreadyScheduledError,
  inactivityCutoffMillis,
  queueInactiveAccountDeletions,
  recordAccountActivity,
} from '../server/accountInactivity';

const now = Timestamp.fromDate(new Date('2026-11-06T15:30:00.000Z'));
const old = Timestamp.fromDate(new Date('2025-11-05T15:30:00.000Z'));
const recent = Timestamp.fromDate(new Date('2026-11-05T15:30:00.000Z'));
const activity = (uid: string, lastSeenAt: Timestamp) =>
  state.docs.set('account_activity/' + uid, { uid, firstSeenAt: old, lastSeenAt });

describe('authenticated inactivity retention boundary', () => {
  beforeEach(() => {
    state.docs.clear();
    state.writes.length = 0;
    state.onQuery = null;
  });

  it('uses twelve calendar months, with leap-day clamping and exact UTC time', () => {
    expect(new Date(inactivityCutoffMillis(Date.parse('2028-02-29T12:40:01.000Z'))).toISOString())
      .toBe('2027-02-28T12:40:01.000Z');
    expect(new Date(inactivityCutoffMillis(Date.parse('2026-11-06T15:30:00.000Z'))).toISOString())
      .toBe('2025-11-06T15:30:00.000Z');
    expect(() => inactivityCutoffMillis(Number.NaN)).toThrow();
  });

  it('creates minimal server-time activity and throttles duplicate foreground requests', async () => {
    await recordAccountActivity('owner', old);
    expect(state.docs.get('account_activity/owner')).toEqual({
      uid: 'owner', firstSeenAt: old, lastSeenAt: old,
    });
    await recordAccountActivity('owner', Timestamp.fromMillis(old.toMillis() + 30_000));
    expect(state.writes).toHaveLength(1);
    await recordAccountActivity('owner', recent);
    expect(state.docs.get('account_activity/owner')?.lastSeenAt).toEqual(recent);
    expect(state.writes).toHaveLength(2);
    expect(state.writes.map(x => x.path)).toEqual(['account_activity/owner', 'account_activity/owner']);
  });

  it('rejects concurrent account-deletion fences without restoring activity', async () => {
    activity('owner', old);
    state.docs.set('account_deletions/owner', { uid: 'owner', status: 'requested' });
    await expect(recordAccountActivity('owner', now)).rejects.toBeInstanceOf(AccountDeletionAlreadyScheduledError);
    expect(state.docs.get('account_activity/owner')?.lastSeenAt).toEqual(old);
    expect(state.writes).toHaveLength(0);
  });

  it('fails closed when existing activity has foreign owner or a future timestamp', async () => {
    activity('owner', old);
    state.docs.set('account_activity/owner', { uid: 'foreign', lastSeenAt: old });
    await expect(recordAccountActivity('owner', now)).rejects.toThrow('Activity record invalid');
    activity('owner', Timestamp.fromMillis(now.toMillis() + 1000));
    await expect(recordAccountActivity('owner', now)).rejects.toThrow('Activity record invalid');
    expect(state.writes).toHaveLength(0);
  });

  it('does not schedule deletion from a partial or chronologically invalid activity record', async () => {
    state.docs.set('account_activity/missing-first', { uid: 'missing-first', lastSeenAt: old });
    state.docs.set('account_activity/inverted', {
      uid: 'inverted', firstSeenAt: now, lastSeenAt: old,
    });
    const outcome = await queueInactiveAccountDeletions(now);
    expect(outcome).toEqual({ scanned: 2, queued: 0 });
    expect(state.writes).toHaveLength(0);
    await expect(recordAccountActivity('missing-first', now)).rejects.toThrow('Activity record invalid');
    await expect(recordAccountActivity('inverted', now)).rejects.toThrow('Activity record invalid');
  });

  it('does not delete based on an absent activity record, Auth creation time or automatic sync', async () => {
    const result = await queueInactiveAccountDeletions(now);
    expect(result).toEqual({ scanned: 0, queued: 0 });
    expect(state.writes).toHaveLength(0);
  });

  it('queues only truly expired markers, with an atomic fence and opaque recovery receipt', async () => {
    activity('expired', old);
    activity('recent', recent);
    const outcome = await queueInactiveAccountDeletions(now);
    expect(outcome).toEqual({ scanned: 1, queued: 1 });
    const job = state.docs.get('account_deletions/expired')!;
    expect(job).toMatchObject({ uid: 'expired', reason: 'inactivity', status: 'requested', attempts: 0, inactivityLastSeenAt: old });
    expect(job.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(state.docs.has('account_activity/expired')).toBe(false);
    expect(state.docs.has('account_activity/recent')).toBe(true);
    expect(state.writes.slice(-2).map(x => [x.kind, x.path])).toEqual([
      ['delete', 'account_activity/expired'], ['create', 'account_deletions/expired'],
    ]);
    expect(await queueInactiveAccountDeletions(now)).toEqual({ scanned: 0, queued: 0 });
  });

  it('refuses a stale query result after an authenticated visit won the transaction race', async () => {
    activity('owner', old);
    state.onQuery = () => activity('owner', recent);
    expect(await queueInactiveAccountDeletions(now)).toEqual({ scanned: 1, queued: 0 });
    expect(state.docs.has('account_deletions/owner')).toBe(false);
    expect(state.docs.get('account_activity/owner')?.lastSeenAt).toEqual(recent);
  });

  it('skips an already queued manual deletion instead of overwriting its receipt', async () => {
    activity('owner', old);
    state.docs.set('account_deletions/owner', { uid: 'owner', status: 'requested', receiptHash: 'trusted' });
    expect(await queueInactiveAccountDeletions(now)).toEqual({ scanned: 1, queued: 0 });
    expect(state.docs.get('account_deletions/owner')?.receiptHash).toBe('trusted');
    expect(state.writes).toHaveLength(0);
  });

  it('skips malformed owners and continues on the following bounded query page', async () => {
    for (let i = 0; i < 12; i++) {
      state.docs.set('account_activity/invalid-' + i, { uid: 'foreign', lastSeenAt: old });
    }
    activity('eligible', Timestamp.fromMillis(old.toMillis() + 1));
    expect(await queueInactiveAccountDeletions(now, 12)).toEqual({ scanned: 13, queued: 1 });
    expect(state.docs.has('account_deletions/eligible')).toBe(true);
  });
});
