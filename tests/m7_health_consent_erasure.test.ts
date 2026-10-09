import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { PRIVATE_ACCOUNT_COLLECTIONS } from '../server/accountDeletion/types';

type StateDoc = Record<string, unknown>;
const dbState = vi.hoisted(() => ({
  documents: new Map<string, StateDoc>(),
  deletions: [] as string[],
  batchSizes: [] as number[],
  failsOnce: '',
}));

function documentRef(path: string) {
  return {
    path,
    id: path.split('/').at(-1),
    async get() {
      const value = dbState.documents.get(path);
      return { exists: value !== undefined, data: () => value };
    },
    collection(name: string) { return collectionRef(path + '/' + name); },
    async listCollections() {
      const prefix = path + '/';
      const names = new Set<string>();
      for (const candidate of dbState.documents.keys()) {
        if (!candidate.startsWith(prefix)) continue;
        const segments = candidate.slice(prefix.length).split('/');
        if (segments.length >= 2) names.add(segments[0]);
      }
      return [...names].map(name => collectionRef(prefix + name));
    },
  };
}

function collectionRef(path: string, max = Number.POSITIVE_INFINITY, statuses?: readonly string[]): any {
  const api = {
    doc(id: string) { return documentRef(path + '/' + id); },
    async listDocuments() {
      const prefix = path + '/';
      // Firestore returns missing ancestors when nested subcollections survive.
      const ids = new Set([...dbState.documents.keys()]
        .filter(key => key.startsWith(prefix))
        .map(key => key.slice(prefix.length).split('/')[0]));
      return [...ids].map(id => documentRef(prefix + id));
    },
    limit(count: number) { return collectionRef(path, count, statuses); },
    where(field: string, op: string, values: string[]) {
      if (field !== 'eraseStatus' || op !== 'in') throw new Error('Unexpected query.');
      return collectionRef(path, max, values);
    },
    select() { return collectionRef(path, max, statuses); },
    async get() {
      if (dbState.failsOnce === path) {
        dbState.failsOnce = '';
        throw new Error('Transient collection read error');
      }
      const prefix = path + '/';
      const docs = [...dbState.documents.keys()]
        .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .filter(key => !statuses || statuses.includes(String(dbState.documents.get(key)?.eraseStatus)))
        .slice(0, max).map(key => ({ id: key.split('/').at(-1), ref: documentRef(key) }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  };
  return api;
}

const mockDb = vi.hoisted(() => ({
  collection(name: string) { return collectionRef(name); },
  async runTransaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
    const ops: Array<{ kind: 'update' | 'set' | 'delete' | 'create'; path: string; data?: StateDoc }> = [];
    const result = await callback({
      get: (ref: ReturnType<typeof documentRef>) => ref.get(),
      update: (ref: ReturnType<typeof documentRef>, data: StateDoc) => ops.push({ kind: 'update', path: ref.path, data }),
      set: (ref: ReturnType<typeof documentRef>, data: StateDoc) => ops.push({ kind: 'set', path: ref.path, data }),
      create: (ref: ReturnType<typeof documentRef>, data: StateDoc) => ops.push({ kind: 'create', path: ref.path, data }),
      delete: (ref: ReturnType<typeof documentRef>) => ops.push({ kind: 'delete', path: ref.path }),
    });
    for (const op of ops) {
      if (op.kind === 'delete') {
        dbState.documents.delete(op.path);
        dbState.deletions.push(op.path);
      } else if (op.kind === 'update') {
        dbState.documents.set(op.path, { ...dbState.documents.get(op.path), ...op.data });
      } else dbState.documents.set(op.path, op.data ?? {});
    }
    const count = ops.filter(op => op.kind === 'delete').length;
    if (count) dbState.batchSizes.push(count);
    return result;
  },
}));

vi.mock('../server/accountDeletion/firebaseAdmin', () => ({ adminDb: () => mockDb }));

import { listPendingHealthErasures, processHealthErasure } from '../server/healthConsent/erasure';

function revoked(uid: string) {
  dbState.documents.set('health_consent_revocations/' + uid, {
    revokedAt: Timestamp.now(), eraseStatus: 'requested',
  });
  dbState.documents.set('users/' + uid, {
    _schemaVersion: 1, legalConsent: { hasAcceptedTerms: true, hasAcceptedHealthData: true, termsVersion: '1', privacyVersion: '1' },
    profile: { notes: 'sensitive' }, activeWorkout: { id: 'w' },
  });
}

describe('health withdrawal server erasure (Firebase Admin transactional mock)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.documents.clear();
    dbState.deletions.length = 0;
    dbState.batchSizes.length = 0;
    dbState.failsOnce = '';
  });

  it('drains all private collections by bounded pages, preserves account root and revocation fence', async () => {
    revoked('a');
    for (let i = 0; i < 450; i++) dbState.documents.set('users/a/history_months/doc-' + i, { training: 'private' });
    for (const name of PRIVATE_ACCOUNT_COLLECTIONS) dbState.documents.set('users/a/' + name + '/item', { health: true });

    await expect(processHealthErasure('a', Date.now() + 60_000)).resolves.toBe('complete');
    expect(dbState.batchSizes.every(size => size <= 200)).toBe(true);
    expect(dbState.deletions.length).toBe(456);
    expect([...dbState.documents.keys()].filter(path => path.startsWith('users/a/') && path !== 'users/a')).toEqual([]);
    expect(dbState.documents.get('users/a')).toEqual({
      _schemaVersion: 1,
      legalConsent: { hasAcceptedTerms: true, hasAcceptedHealthData: false, termsVersion: '1', privacyVersion: '1' },
    });
    expect(dbState.documents.get('health_consent_revocations/a')).toMatchObject({ eraseStatus: 'complete' });
    expect(dbState.documents.has('users/b')).toBe(false);
  });

  it('does not erase while account deletion owns the UID', async () => {
    revoked('a');
    dbState.documents.set('account_deletions/a', { status: 'requested' });
    await expect(processHealthErasure('a', Date.now() + 60_000)).resolves.toBe('busy');
    expect(dbState.documents.get('users/a')).toHaveProperty('profile');
    expect(dbState.deletions).toHaveLength(0);
  });

  it('refuses concurrent lease owners without touching account data', async () => {
    revoked('a');
    dbState.documents.set('health_consent_revocations/a', {
      eraseStatus: 'deleting', eraseLeaseOwner: 'another-worker',
      eraseLeaseUntil: Timestamp.fromMillis(Date.now() + 60_000),
    });
    await expect(processHealthErasure('a', Date.now() + 60_000)).resolves.toBe('busy');
    expect(dbState.documents.get('users/a')).toHaveProperty('activeWorkout');
  });

  it('retains a retryable failure and resumes an interrupted page safely', async () => {
    revoked('a');
    dbState.documents.set('users/a/history_months/h', { private: true });
    dbState.failsOnce = 'users/a/history_months';
    await expect(processHealthErasure('a', Date.now() + 60_000)).rejects.toThrow('Transient collection read error');
    expect(dbState.documents.get('health_consent_revocations/a')).toMatchObject({ eraseStatus: 'failed' });
    expect(dbState.documents.has('users/a/history_months/h')).toBe(true);
    await expect(processHealthErasure('a', Date.now() + 60_000)).resolves.toBe('complete');
    expect(dbState.documents.has('users/a/history_months/h')).toBe(false);
  });

  it('does not claim complete when unexpected nested private collections remain', async () => {
    revoked('a');
    dbState.documents.set('users/a/unknown_private/survivor', { private: true });
    await expect(processHealthErasure('a', Date.now() + 60_000)).rejects.toThrow('Unexpected private collection');
    expect(dbState.documents.get('health_consent_revocations/a')).toMatchObject({ eraseStatus: 'blocked' });
    expect(await listPendingHealthErasures()).toEqual([]);
    await expect(processHealthErasure('a', Date.now() + 60_000)).resolves.toBe('busy');
    expect(dbState.documents.has('users/a/unknown_private/survivor')).toBe(true);
  });

  it('blocks completion when a deleted monthly parent leaves a nested orphan', async () => {
    revoked('a');
    dbState.documents.set('users/a/history_months/2026-10', { private: true });
    dbState.documents.set('users/a/history_months/2026-10/nested/private', { health: true });

    await expect(processHealthErasure('a', Date.now() + 60_000)).rejects.toThrow('Unexpected private collection');
    expect(dbState.documents.get('health_consent_revocations/a')).toMatchObject({ eraseStatus: 'blocked' });
    expect(dbState.documents.has('users/a/history_months/2026-10')).toBe(false);
    expect(dbState.documents.has('users/a/history_months/2026-10/nested/private')).toBe(true);
  });

  it('blocks a private unknown collection with only a missing parent and nested data', async () => {
    revoked('a');
    dbState.documents.set('users/a/private_unknown/ghost/nested/private', { health: true });

    await expect(processHealthErasure('a', Date.now() + 60_000)).rejects.toThrow('Unexpected private collection');
    expect(dbState.documents.get('health_consent_revocations/a')).toMatchObject({ eraseStatus: 'blocked' });
  });

  it('returns pending without acquiring lease after the deadline', async () => {
    revoked('a');
    await expect(processHealthErasure('a', Date.now() + 200)).resolves.toBe('pending');
    expect(dbState.documents.get('health_consent_revocations/a')).toMatchObject({ eraseStatus: 'requested' });
  });

  it('finds pending and failed jobs, but not completed markers', async () => {
    revoked('a');
    revoked('b');
    dbState.documents.set('health_consent_revocations/b', { eraseStatus: 'complete' });
    expect(await listPendingHealthErasures()).toEqual(['a']);
  });
});
