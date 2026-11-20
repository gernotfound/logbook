import { Timestamp } from 'firebase-admin/firestore';

type Entry = Record<string, unknown>;
export type HealthErasureMockFixture = {
  records: Map<string, Entry>;
  failQueryOnce: string;
  pauseQuery: null | { path: string; entered: () => void; resume: Promise<void> };
  transactionCount: number;
};

// This fake preserves write atomicity but does not simulate Firestore's
// optimistic read-version retries. The lease tests exercise explicit fences.
export function makeHealthErasureAdminMock(fixture: HealthErasureMockFixture) {
  const getSnapshot = (path: string) => {
    const data = fixture.records.get(path);
    return { exists: data !== undefined, data: () => data,
      id: path.split('/').at(-1), ref: document(path) };
  };
  const collection = (path: string) => ({
    id: path.split('/').at(-1),
    doc: (id: string) => document(path + '/' + id),
    // Match the Admin SDK's showMissing=true behavior for orphan parent refs.
    listDocuments: async () => {
      const prefix = path + '/';
      const ids = new Set([...fixture.records.keys()]
        .filter(key => key.startsWith(prefix))
        .map(key => key.slice(prefix.length).split('/')[0]));
      return [...ids].map(id => document(prefix + id));
    },
    ...query(path, []),
  });
  function query(path: string, constraints: Array<[string, string, unknown]>, max = 1000, after: { path: string; time: number } | null = null) {
    return {
      where: (field: string, op: string, value: unknown) => query(path, [...constraints, [field, op, value]], max, after),
      limit: (count: number) => query(path, constraints, count, after),
      select: () => query(path, constraints, max, after),
      orderBy: () => query(path, constraints, max, after),
      startAfter: (snapshot: { ref: { path: string }; data: () => Entry | undefined }) => {
        const timestamp = snapshot.data()?.purgeAfter;
        return query(path, constraints, max, {
          path: snapshot.ref.path, time: timestamp instanceof Timestamp ? timestamp.toMillis() : 0,
        });
      },
      get: async () => {
        if (fixture.pauseQuery?.path === path) {
          const pause = fixture.pauseQuery;
          fixture.pauseQuery = null;
          pause.entered();
          await pause.resume;
        }
        if (fixture.failQueryOnce === path) {
          fixture.failQueryOnce = '';
          throw new Error('Injected Firestore outage');
        }
        const depth = path.split('/').length + 1;
        const docs = [...fixture.records.keys()].filter(key => {
          if (!key.startsWith(path + '/') || key.split('/').length !== depth) return false;
          const data = fixture.records.get(key)!;
          return constraints.every(([field, op, value]) => {
            if (op === '==') return data[field] === value;
            if (op === 'in' && Array.isArray(value)) return value.includes(data[field]);
            if (op === '<=' && value instanceof Timestamp && data[field] instanceof Timestamp) {
              return (data[field] as Timestamp).toMillis() <= value.toMillis();
            }
            return false;
          });
        }).sort((left, right) => {
          const a = fixture.records.get(left)?.purgeAfter;
          const b = fixture.records.get(right)?.purgeAfter;
          const timeA = a instanceof Timestamp ? a.toMillis() : 0;
          const timeB = b instanceof Timestamp ? b.toMillis() : 0;
          return timeA - timeB || left.localeCompare(right);
        });
        const eligible = after ? docs.filter(key => {
          const timestamp = fixture.records.get(key)?.purgeAfter;
          const time = timestamp instanceof Timestamp ? timestamp.toMillis() : 0;
          return time > after.time || (time === after.time && key > after.path);
        }) : docs;
        const paged = eligible.slice(0, max).map(key => getSnapshot(key));
        return { docs: paged, size: paged.length, empty: paged.length === 0 };
      },
    };
  }
  function document(path: string) {
    return {
      path,
      get: async () => getSnapshot(path),
      collection: (name: string) => collection(path + '/' + name),
      listCollections: async () => {
        const depth = path.split('/').length + 2;
        const names = new Set([...fixture.records.keys()]
          .filter(key => key.startsWith(path + '/') && key.split('/').length >= depth)
          .map(key => key.split('/')[path.split('/').length]));
        return [...names].map(name => collection(path + '/' + name));
      },
    };
  }
  const db = {
    collection,
    runTransaction: async (callback: (tx: any) => Promise<unknown>) => {
      fixture.transactionCount++;
      const staged: Array<() => void> = [];
      const tx = {
        get: async (ref: { path: string }) => getSnapshot(ref.path),
        create: (ref: { path: string }, data: Entry) => {
          if (fixture.records.has(ref.path)) throw new Error('Already exists');
          staged.push(() => fixture.records.set(ref.path, { ...data }));
        },
        set: (ref: { path: string }, data: Entry) => {
          staged.push(() => fixture.records.set(ref.path, { ...data }));
        },
        update: (ref: { path: string }, patch: Entry) => {
          if (!fixture.records.has(ref.path)) throw new Error('Missing document');
          staged.push(() => fixture.records.set(ref.path, { ...fixture.records.get(ref.path), ...patch }));
        },
        delete: (ref: { path: string }) => staged.push(() => { fixture.records.delete(ref.path); }),
      };
      const result = await callback(tx);
      staged.forEach(apply => apply());
      return result;
    },
  };
  return { adminDb: () => db };
}

export const consentPath = (uid: string) => 'health_consent_withdrawals/' + uid;
export const markerPath = (uid: string) => 'health_data_erasures/' + uid;

export function resetHealthErasureFixture(fixture: HealthErasureMockFixture): void {
  fixture.records.clear();
  fixture.transactionCount = 0;
  fixture.failQueryOnce = '';
  fixture.pauseQuery = null;
  fixture.records.set(consentPath('a'), { uid: 'a', revision: 3, status: 'withdrawn' });
  fixture.records.set(consentPath('b'), { uid: 'b', revision: 3, status: 'withdrawn' });
  fixture.records.set('users/a', { profile: { height: 170 } });
  fixture.records.set('users/a/history_months/2026-09', { history: [1] });
  fixture.records.set('users/a/nutrition_months/2026-09', { nutrition: [2] });
  fixture.records.set('users/a/sync_control/state', { replicas: {} });
  // KMS only wraps a per-owner key. The envelope is server-owned and must
  // survive partial page failures, then be destroyed on completed erasure.
  fixture.records.set('user_data_keys/a', { uid: 'a', format: 'thelogbook-wrapped-account-key', version: 1, ciphertext: 'wrapped-a' });
  fixture.records.set('user_data_keys/b', { uid: 'b', format: 'thelogbook-wrapped-account-key', version: 1, ciphertext: 'wrapped-b' });
  fixture.records.set('users/b', { profile: { height: 180 } });
  fixture.records.set('users/b/history_months/2026-09', { history: [5] });
}
