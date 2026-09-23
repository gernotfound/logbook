import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

type TelemetryName = 'telemetry_errors' | 'telemetry_events' | 'telemetry_anomalies';
type TelemetryDoc = { id: string; expireAt: Timestamp };
type UserRecord = { id: string; telemetry: Record<TelemetryName, TelemetryDoc[]> };

const state = vi.hoisted(() => ({
  users: [] as UserRecord[],
  cursor: null as string | null,
  deleted: [] as string[],
  stateWrites: 0,
}));

function userRef(uid: string) {
  return {
    id: uid,
    path: `users/${uid}`,
    collection(name: TelemetryName) {
      return {
        where(field: string, operator: string, value: Timestamp) {
          if (field !== 'expireAt' || operator !== '<=') {
            throw new Error('Unexpected telemetry retention query');
          }
          return {
            limit(count: number) {
              return {
                async get() {
                  const user = state.users.find(item => item.id === uid);
                  const docs = (user?.telemetry[name] ?? [])
                    .filter(item => item.expireAt.toMillis() <= value.toMillis())
                    .slice(0, count)
                    .map(item => ({
                      id: item.id,
                      ref: { path: `users/${uid}/${name}/${item.id}` },
                    }));
                  return { empty: docs.length === 0, size: docs.length, docs };
                },
              };
            },
          };
        },
      };
    },
  };
}

function userQuery(cursor: string | null, limitCount: number) {
  return {
    startAfter(nextCursor: string) {
      return userQuery(nextCursor, limitCount);
    },
    limit(nextLimit: number) {
      return userQuery(cursor, nextLimit);
    },
    async get() {
      const docs = [...state.users]
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter(user => cursor === null || user.id > cursor)
        .slice(0, limitCount)
        .map(user => ({ id: user.id, ref: userRef(user.id) }));
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  };
}

const fakeDb = vi.hoisted(() => ({
  collection(name: string) {
    if (name === 'users') {
      return {
        orderBy() {
          return userQuery(null, Number.MAX_SAFE_INTEGER);
        },
      };
    }
    if (name === 'maintenance') {
      return {
        doc(id: string) {
          if (id !== 'telemetry_retention') throw new Error('Unexpected maintenance document');
          return {
            async get() {
              return {
                exists: state.cursor !== null,
                data: () => state.cursor === null ? undefined : { lastCompletedUserId: state.cursor },
              };
            },
            async set(data: { lastCompletedUserId: string | null }) {
              state.cursor = data.lastCompletedUserId;
              state.stateWrites += 1;
            },
          };
        },
      };
    }
    throw new Error(`Unexpected collection: ${name}`);
  },
  batch() {
    const paths: string[] = [];
    return {
      delete(ref: { path: string }) {
        paths.push(ref.path);
      },
      async commit() {
        for (const path of paths) {
          const [, uid, collectionName, docId] = path.split('/');
          const user = state.users.find(item => item.id === uid);
          if (!user) continue;
          const name = collectionName as TelemetryName;
          user.telemetry[name] = user.telemetry[name].filter(item => item.id !== docId);
          state.deleted.push(path);
        }
      },
    };
  },
}));

vi.mock('../server/accountDeletion/firebaseAdmin', () => ({
  adminDb: () => fakeDb,
}));

import { purgeExpiredTelemetry } from '../server/telemetryRetention';

function telemetry(
  errors: TelemetryDoc[] = [],
  events: TelemetryDoc[] = [],
  anomalies: TelemetryDoc[] = [],
): Record<TelemetryName, TelemetryDoc[]> {
  return {
    telemetry_errors: errors,
    telemetry_events: events,
    telemetry_anomalies: anomalies,
  };
}

describe('M7 telemetry retention sweep', () => {
  beforeEach(() => {
    state.users = [];
    state.cursor = null;
    state.deleted = [];
    state.stateWrites = 0;
  });

  it('deletes only expired telemetry across private user subcollections', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    state.users = [{
      id: 'a',
      telemetry: telemetry(
        [
          { id: 'old-error', expireAt: Timestamp.fromMillis(now.toMillis() - 1) },
          { id: 'fresh-error', expireAt: Timestamp.fromMillis(now.toMillis() + 60_000) },
        ],
        [{ id: 'old-event', expireAt: Timestamp.fromMillis(now.toMillis() - 1) }],
        [{ id: 'old-anomaly', expireAt: Timestamp.fromMillis(now.toMillis()) }],
      ),
    }];

    const result = await purgeExpiredTelemetry(Date.now() + 60_000, now);

    expect(result).toEqual({ usersScanned: 1, documentsDeleted: 3, completedCycle: true });
    expect(state.deleted).toEqual([
      'users/a/telemetry_errors/old-error',
      'users/a/telemetry_events/old-event',
      'users/a/telemetry_anomalies/old-anomaly',
    ]);
    expect(state.users[0].telemetry.telemetry_errors.map(item => item.id)).toEqual(['fresh-error']);
    expect(state.cursor).toBeNull();
  });

  it('resumes after the last completed user and resets the cursor after a full cycle', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    state.cursor = 'a';
    state.users = [
      { id: 'a', telemetry: telemetry([{ id: 'old-a', expireAt: Timestamp.fromMillis(now.toMillis() - 1) }]) },
      { id: 'b', telemetry: telemetry([{ id: 'old-b', expireAt: Timestamp.fromMillis(now.toMillis() - 1) }]) },
    ];

    const result = await purgeExpiredTelemetry(Date.now() + 60_000, now);

    expect(result).toEqual({ usersScanned: 1, documentsDeleted: 1, completedCycle: true });
    expect(state.deleted).toEqual(['users/b/telemetry_errors/old-b']);
    expect(state.users[0].telemetry.telemetry_errors).toHaveLength(1);
    expect(state.cursor).toBeNull();
  });

  it('preserves the cursor and performs no destructive work when the cron budget is exhausted', async () => {
    const now = Timestamp.fromMillis(2_000_000_000_000);
    state.cursor = 'a';
    state.users = [
      { id: 'b', telemetry: telemetry([{ id: 'old-b', expireAt: Timestamp.fromMillis(now.toMillis() - 1) }]) },
    ];

    const result = await purgeExpiredTelemetry(Date.now() + 1_000, now);

    expect(result).toEqual({ usersScanned: 0, documentsDeleted: 0, completedCycle: false });
    expect(state.deleted).toEqual([]);
    expect(state.cursor).toBe('a');
    expect(state.stateWrites).toBe(1);
  });
});
