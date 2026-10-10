import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

type TelemetryName = 'telemetry_errors' | 'telemetry_events' | 'telemetry_anomalies';
type CommitBehavior = 'ok' | 'throw-before' | 'throw-after';

interface TelemetryDocRecord {
  id: string;
  path: string;
  expireAt?: Timestamp;
}

const TELEMETRY_COLLECTIONS: TelemetryName[] = [
  'telemetry_errors',
  'telemetry_events',
  'telemetry_anomalies',
];

const state = vi.hoisted(() => ({
  docs: {
    telemetry_errors: [] as TelemetryDocRecord[],
    telemetry_events: [] as TelemetryDocRecord[],
    telemetry_anomalies: [] as TelemetryDocRecord[],
  } satisfies Record<TelemetryName, TelemetryDocRecord[]>,
  deleted: [] as string[],
  listDocumentsCalls: 0,
  queryFailure: null as TelemetryName | null,
  commitBehavior: 'ok' as CommitBehavior,
  advanceMsPerQuery: 0,
}));

function asSnapshot(collectionName: TelemetryName, record: TelemetryDocRecord) {
  return {
    id: record.id,
    ref: { path: record.path },
    get(field: string) {
      if (field !== 'expireAt') throw new Error(`Unexpected field lookup: ${field}`);
      return record.expireAt;
    },
    __cursorCollection: collectionName,
    __cursorPath: record.path,
    __cursorExpireAtMillis: record.expireAt?.toMillis() ?? Number.NaN,
  };
}

function sortByRetentionOrder(left: TelemetryDocRecord, right: TelemetryDocRecord): number {
  const leftMs = left.expireAt?.toMillis() ?? Number.NaN;
  const rightMs = right.expireAt?.toMillis() ?? Number.NaN;
  if (leftMs < rightMs) return -1;
  if (leftMs > rightMs) return 1;
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function removeDocsByPath(paths: string[]) {
  for (const path of paths) {
    for (const collectionName of TELEMETRY_COLLECTIONS) {
      state.docs[collectionName] = state.docs[collectionName].filter(item => item.path !== path);
    }
    state.deleted.push(path);
  }
}

function collectionGroupQuery(collectionName: TelemetryName) {
  let nowFilter: Timestamp | null = null;
  let limitCount = Number.POSITIVE_INFINITY;
  const orderByFields: string[] = [];
  let startAfterCursor: {
    collection: TelemetryName;
    path: string;
    expireAtMillis: number;
  } | null = null;

  return {
    where(field: string, operator: string, value: Timestamp) {
      if (field !== 'expireAt' || operator !== '<=') {
        throw new Error('Unexpected collection-group query filter');
      }
      nowFilter = value;
      return this;
    },
    orderBy(field: string | { readonly _methodName?: string }, direction?: string) {
      if (field === 'expireAt') {
        if (direction !== 'asc') throw new Error('expireAt must be ordered ascending');
        orderByFields.push('expireAt');
        return this;
      }
      if (typeof field === 'object') {
        if (direction !== 'asc') throw new Error('documentId must be ordered ascending');
        orderByFields.push('__name__');
        return this;
      }
      throw new Error(`Unexpected orderBy field: ${String(field)}`);
    },
    limit(value: number) {
      limitCount = value;
      return this;
    },
    startAfter(snapshot: {
      __cursorCollection: TelemetryName;
      __cursorPath: string;
      __cursorExpireAtMillis: number;
    }) {
      startAfterCursor = {
        collection: snapshot.__cursorCollection,
        path: snapshot.__cursorPath,
        expireAtMillis: snapshot.__cursorExpireAtMillis,
      };
      return this;
    },
    async get() {
      if (!nowFilter) throw new Error('where(expireAt, <=, now) must be configured');
      if (orderByFields.join(',') !== 'expireAt,__name__') {
        throw new Error(`Unexpected orderBy sequence: ${orderByFields.join(',')}`);
      }
      if (state.queryFailure === collectionName) throw new Error(`Query failed for ${collectionName}`);

      if (state.advanceMsPerQuery > 0) {
        const currentNow = Date.now();
        vi.setSystemTime(currentNow + state.advanceMsPerQuery);
      }

      let rows = state.docs[collectionName]
        .filter(item => item.expireAt && item.expireAt.toMillis() <= nowFilter.toMillis())
        .sort(sortByRetentionOrder);

      if (startAfterCursor) {
        if (startAfterCursor.collection !== collectionName) throw new Error('Invalid cursor collection');
        rows = rows.filter(item => {
          const expireAtMillis = item.expireAt?.toMillis() ?? Number.NaN;
          if (expireAtMillis > startAfterCursor.expireAtMillis) return true;
          if (expireAtMillis < startAfterCursor.expireAtMillis) return false;
          return item.path > startAfterCursor.path;
        });
      }

      const docs = rows.slice(0, limitCount).map(item => asSnapshot(collectionName, item));
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  };
}

const fakeDb = vi.hoisted(() => ({
  collection(name: string) {
    if (name === 'users') {
      return {
        async listDocuments() {
          state.listDocumentsCalls += 1;
          throw new Error('Telemetry retention must not enumerate users');
        },
      };
    }
    if (name === 'maintenance') {
      return {
        doc() {
          throw new Error('Telemetry retention must not read or write cursor state');
        },
      };
    }
    throw new Error(`Unexpected collection() call: ${name}`);
  },
  collectionGroup(name: string) {
    if (!TELEMETRY_COLLECTIONS.includes(name as TelemetryName)) {
      throw new Error(`Unexpected collectionGroup() call: ${name}`);
    }
    return collectionGroupQuery(name as TelemetryName);
  },
  batch() {
    const paths: string[] = [];
    return {
      delete(ref: { path: string }) {
        paths.push(ref.path);
      },
      async commit() {
        if (state.commitBehavior === 'throw-before') {
          throw new Error('batch commit failed');
        }
        removeDocsByPath(paths);
        if (state.commitBehavior === 'throw-after') {
          throw new Error('batch commit acknowledgement lost');
        }
      },
    };
  },
}));

vi.mock('../server/accountDeletion/firebaseAdmin', () => ({
  adminDb: () => fakeDb,
}));

import { purgeExpiredTelemetry } from '../server/telemetryRetention';

function expiredDoc(path: string, now: Timestamp): TelemetryDocRecord {
  return { id: path.split('/').at(-1) ?? 'doc', path, expireAt: Timestamp.fromMillis(now.toMillis() - 1) };
}

function freshDoc(path: string, now: Timestamp): TelemetryDocRecord {
  return { id: path.split('/').at(-1) ?? 'doc', path, expireAt: Timestamp.fromMillis(now.toMillis() + 60_000) };
}

function noExpiryDoc(path: string): TelemetryDocRecord {
  return { id: path.split('/').at(-1) ?? 'doc', path };
}

describe('M7 telemetry retention sweep', () => {
  beforeEach(() => {
    state.docs.telemetry_errors = [];
    state.docs.telemetry_events = [];
    state.docs.telemetry_anomalies = [];
    state.deleted = [];
    state.listDocumentsCalls = 0;
    state.queryFailure = null;
    state.commitBehavior = 'ok';
    state.advanceMsPerQuery = 0;
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deletes only expired telemetry docs across all legacy collection groups', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    state.docs.telemetry_errors = [
      expiredDoc('users/a/telemetry_errors/old-error', now),
      freshDoc('users/a/telemetry_errors/fresh-error', now),
      noExpiryDoc('users/a/telemetry_errors/legacy-no-expiry'),
    ];
    state.docs.telemetry_events = [
      expiredDoc('users/a/telemetry_events/old-event', now),
      freshDoc('users/a/telemetry_events/fresh-event', now),
    ];
    state.docs.telemetry_anomalies = [expiredDoc('users/a/telemetry_anomalies/old-anomaly', now)];

    const result = await purgeExpiredTelemetry(Date.now() + 120_000, now);

    expect(result).toEqual({
      documentsScanned: 3,
      documentsDeleted: 3,
      unexpectedDocuments: 0,
      completedCycle: true,
    });
    expect(state.deleted).toEqual([
      'users/a/telemetry_errors/old-error',
      'users/a/telemetry_events/old-event',
      'users/a/telemetry_anomalies/old-anomaly',
    ]);
    expect(state.docs.telemetry_errors.map(item => item.path)).toEqual([
      'users/a/telemetry_errors/fresh-error',
      'users/a/telemetry_errors/legacy-no-expiry',
    ]);
    expect(state.listDocumentsCalls).toBe(0);
  });

  it('covers telemetry under missing user parents through collection-group reads', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    state.docs.telemetry_events = [expiredDoc('users/missing-parent/telemetry_events/old-event', now)];

    const result = await purgeExpiredTelemetry(Date.now() + 120_000, now);

    expect(result).toEqual({
      documentsScanned: 1,
      documentsDeleted: 1,
      unexpectedDocuments: 0,
      completedCycle: true,
    });
    expect(state.deleted).toEqual(['users/missing-parent/telemetry_events/old-event']);
  });

  it('processes more than one page and handles a page with exactly 400 docs', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    state.docs.telemetry_errors = Array.from({ length: 400 }, (_, index) =>
      expiredDoc(`users/page/telemetry_errors/exact-${index.toString().padStart(3, '0')}`, now)
    );

    const exactResult = await purgeExpiredTelemetry(Date.now() + 120_000, now);
    expect(exactResult).toEqual({
      documentsScanned: 400,
      documentsDeleted: 400,
      unexpectedDocuments: 0,
      completedCycle: true,
    });
    expect(state.docs.telemetry_errors).toHaveLength(0);

    state.docs.telemetry_errors = Array.from({ length: 401 }, (_, index) =>
      expiredDoc(`users/page/telemetry_errors/multi-${index.toString().padStart(3, '0')}`, now)
    );

    const multiPageResult = await purgeExpiredTelemetry(Date.now() + 120_000, now);
    expect(multiPageResult).toEqual({
      documentsScanned: 401,
      documentsDeleted: 401,
      unexpectedDocuments: 0,
      completedCycle: true,
    });
    expect(state.docs.telemetry_errors).toHaveLength(0);
  });

  it('keeps pagination stable when many documents share the same expireAt', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    const sameExpireAt = Timestamp.fromMillis(now.toMillis() - 1);
    state.docs.telemetry_events = Array.from({ length: 401 }, (_, index) => ({
      id: `same-expire-${index.toString().padStart(3, '0')}`,
      path: `users/user-${index.toString().padStart(3, '0')}/telemetry_events/same-expire-${index.toString().padStart(3, '0')}`,
      expireAt: sameExpireAt,
    }));

    const result = await purgeExpiredTelemetry(Date.now() + 120_000, now);

    expect(result).toEqual({
      documentsScanned: 401,
      documentsDeleted: 401,
      unexpectedDocuments: 0,
      completedCycle: true,
    });
    expect(state.docs.telemetry_events).toHaveLength(0);
  });

  it('stops when cron budget is exhausted and resumes safely in a later run', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    state.docs.telemetry_errors = Array.from({ length: 401 }, (_, index) =>
      expiredDoc(`users/resume/telemetry_errors/doc-${index.toString().padStart(3, '0')}`, now)
    );
    state.advanceMsPerQuery = 120_000;

    const interrupted = await purgeExpiredTelemetry(Date.now() + 6_000, now);
    expect(interrupted).toEqual({
      documentsScanned: 400,
      documentsDeleted: 400,
      unexpectedDocuments: 0,
      completedCycle: false,
    });

    state.advanceMsPerQuery = 0;
    const resumed = await purgeExpiredTelemetry(Date.now() + 120_000, now);
    expect(resumed).toEqual({
      documentsScanned: 1,
      documentsDeleted: 1,
      unexpectedDocuments: 0,
      completedCycle: true,
    });
    expect(state.docs.telemetry_errors).toHaveLength(0);
  });

  it('surfaces query failures instead of claiming a completed cycle', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    state.docs.telemetry_errors = [expiredDoc('users/a/telemetry_errors/old', now)];
    state.queryFailure = 'telemetry_errors';

    await expect(purgeExpiredTelemetry(Date.now() + 120_000, now))
      .rejects.toThrow('Query failed for telemetry_errors');
    expect(state.deleted).toEqual([]);
  });

  it('surfaces batch commit failures and retries idempotently after lost acknowledgements', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    state.docs.telemetry_errors = [expiredDoc('users/a/telemetry_errors/old', now)];

    state.commitBehavior = 'throw-before';
    await expect(purgeExpiredTelemetry(Date.now() + 120_000, now))
      .rejects.toThrow('batch commit failed');
    expect(state.deleted).toEqual([]);
    expect(state.docs.telemetry_errors).toHaveLength(1);

    state.commitBehavior = 'throw-after';
    await expect(purgeExpiredTelemetry(Date.now() + 120_000, now))
      .rejects.toThrow('batch commit acknowledgement lost');
    expect(state.deleted).toEqual(['users/a/telemetry_errors/old']);
    expect(state.docs.telemetry_errors).toHaveLength(0);

    state.commitBehavior = 'ok';
    const retry = await purgeExpiredTelemetry(Date.now() + 120_000, now);
    expect(retry).toEqual({
      documentsScanned: 0,
      documentsDeleted: 0,
      unexpectedDocuments: 0,
      completedCycle: true,
    });
  });

  it('skips unexpected paths, records them, and still advances to valid docs without looping forever', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    state.docs.telemetry_errors = [
      ...Array.from({ length: 400 }, (_, index) =>
        expiredDoc(`legacy-root/app/telemetry_errors/unexpected-${index.toString().padStart(3, '0')}`, now)
      ),
      expiredDoc('users/b/telemetry_errors/valid', now),
    ];

    const result = await purgeExpiredTelemetry(Date.now() + 120_000, now);

    expect(result).toEqual({
      documentsScanned: 401,
      documentsDeleted: 1,
      unexpectedDocuments: 400,
      completedCycle: false,
    });
    expect(state.deleted).toEqual(['users/b/telemetry_errors/valid']);
    expect(state.docs.telemetry_errors).toHaveLength(400);
  });

  it('marks cycle as incomplete when only unexpected expired paths are found', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    state.docs.telemetry_errors = Array.from({ length: 400 }, (_, index) =>
      expiredDoc(`legacy-root/app/telemetry_errors/unexpected-${index.toString().padStart(3, '0')}`, now)
    );

    const result = await purgeExpiredTelemetry(Date.now() + 120_000, now);

    expect(result).toEqual({
      documentsScanned: 400,
      documentsDeleted: 0,
      unexpectedDocuments: 400,
      completedCycle: false,
    });
    expect(state.deleted).toEqual([]);
    expect(state.docs.telemetry_errors).toHaveLength(400);
  });

  it('declares required collection-group indexes for expireAt retention queries', () => {
    const indexConfig = JSON.parse(
      readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'),
    ) as {
      indexes: Array<{
        collectionGroup: string;
        queryScope: string;
        fields: Array<{ fieldPath: string; order?: string }>;
      }>;
    };
    const expected = new Map<TelemetryName, string[]>([
      ['telemetry_errors', ['expireAt', '__name__']],
      ['telemetry_events', ['expireAt', '__name__']],
      ['telemetry_anomalies', ['expireAt', '__name__']],
    ]);

    for (const [collectionGroup, fieldPaths] of expected) {
      const index = indexConfig.indexes.find(item =>
        item.collectionGroup === collectionGroup && item.queryScope === 'COLLECTION_GROUP'
      );
      expect(index, `missing ${collectionGroup} collection-group index`).toBeDefined();
      expect(index?.fields.map(item => item.fieldPath)).toEqual(fieldPaths);
      expect(index?.fields.map(item => item.order)).toEqual(['ASCENDING', 'ASCENDING']);
    }
  });
});
