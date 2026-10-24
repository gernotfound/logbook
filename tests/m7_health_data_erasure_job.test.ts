import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

type Entry = Record<string, unknown>;
const fixture = vi.hoisted(() => ({
  records: new Map<string, Entry>(),
  failQueryOnce: '' as string,
  pauseQuery: null as null | { path: string; entered: () => void; resume: Promise<void> },
}));

vi.mock('../server/accountDeletion/firebaseAdmin', () => {
  const getSnapshot = (path: string) => {
    const data = fixture.records.get(path);
    return { exists: data !== undefined, data: () => data,
      id: path.split('/').at(-1), ref: document(path) };
  };
  const collection = (path: string) => ({
    doc: (id: string) => document(path + '/' + id),
    ...query(path, []),
  });
  function query(path: string, constraints: Array<[string, string, unknown]>, max = 1000) {
    return {
      where: (field: string, op: string, value: unknown) => query(path, [...constraints, [field, op, value]], max),
      limit: (count: number) => query(path, constraints, count),
      select: () => query(path, constraints, max),
      orderBy: () => query(path, constraints, max),
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
        }).sort().slice(0, max).map(key => getSnapshot(key));
        return { docs, size: docs.length, empty: docs.length === 0 };
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
        return [...names].map(name => ({ id: name, ...query(path + '/' + name, []) }));
      },
    };
  }
  const db = {
    collection,
    runTransaction: async (callback: (tx: any) => Promise<unknown>) => {
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
});

import {
  createHealthDataErasureJob, processHealthDataErasure, readHealthDataErasureStatus,
  purgeExpiredCompletedHealthErasures,
} from '../server/healthConsent/erasure';
import { readHealthConsentState, recordHealthConsentReacceptance, recordHealthConsentWithdrawal } from '../server/healthConsent/withdrawal';
import { LEGAL_VERSIONS } from '../src/lib/legalVersions';

const consentPath = (uid: string) => 'health_consent_withdrawals/' + uid;
const markerPath = (uid: string) => 'health_data_erasures/' + uid;

beforeEach(() => {
  fixture.records.clear();
  fixture.failQueryOnce = '';
  fixture.pauseQuery = null;
  fixture.records.set(consentPath('a'), { uid: 'a', revision: 3, status: 'withdrawn' });
  fixture.records.set(consentPath('b'), { uid: 'b', revision: 3, status: 'withdrawn' });
  fixture.records.set('users/a', { profile: { height: 170 } });
  fixture.records.set('users/a/history_months/2026-09', { history: [1] });
  fixture.records.set('users/a/nutrition_months/2026-09', { nutrition: [2] });
  fixture.records.set('users/a/sync_control/state', { replicas: {} });
  fixture.records.set('users/a/telemetry_errors/error-1', { reason: 'private' });
  // KMS only wraps a per-owner key. The envelope is server-owned and must
  // survive partial page failures, then be destroyed on completed erasure.
  fixture.records.set('user_data_keys/a', { uid: 'a', format: 'thelogbook-wrapped-account-key', version: 1, ciphertext: 'wrapped-a' });
  fixture.records.set('user_data_keys/b', { uid: 'b', format: 'thelogbook-wrapped-account-key', version: 1, ciphertext: 'wrapped-b' });
  fixture.records.set('users/b', { profile: { height: 180 } });
  fixture.records.set('users/b/history_months/2026-09', { history: [5] });
});

describe('trusted data-only erasure worker', () => {
  it('deletes only the requested owner business data, keeps Auth/consent and advances the epoch', async () => {
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 30000)).toBe('complete');
    expect(await readHealthDataErasureStatus('a')).toMatchObject({ status: 'complete', complete: true, localPurgeAuthorized: true });
    expect(fixture.records.has('users/a')).toBe(false);
    expect([...fixture.records.keys()].some(key => key.startsWith('users/a/'))).toBe(false);
    expect(fixture.records.has('users/b')).toBe(true);
    expect(fixture.records.has('users/b/history_months/2026-09')).toBe(true);
    expect(fixture.records.has('user_data_keys/a')).toBe(false);
    expect(fixture.records.get('user_data_keys/b')?.ciphertext).toBe('wrapped-b');
    expect(fixture.records.get(consentPath('a'))).toMatchObject({
      status: 'withdrawn', revision: 4, erasedBeforeRevision: 3,
    });
    await createHealthDataErasureJob('a');
    expect(await readHealthDataErasureStatus('a')).toMatchObject({ complete: true });
    expect(fixture.records.get(consentPath('a'))?.revision).toBe(4);
  });

  it('fences stale reacceptance and supports a later independently withdrawn data generation', async () => {
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 30000)).toBe('complete');
    const acceptance = {
      acceptedTerms: true as const, acceptedHealthData: true as const,
      privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
    };
    await expect(recordHealthConsentReacceptance('a', acceptance, 3)).rejects.toThrow();
    const active = await recordHealthConsentReacceptance('a', acceptance, 4);
    expect(active.revision).toBe(5);
    expect(await readHealthConsentState('a')).toMatchObject({
      status: 'active', revision: 5, erasedBeforeRevision: 3,
    });
    await recordHealthConsentWithdrawal('a', 5);
    fixture.records.set('users/a', { profile: { height: 165 } });
    await createHealthDataErasureJob('a');
    expect(fixture.records.get(markerPath('a'))).toMatchObject({ status: 'requested', consentRevision: 6 });
    expect(await processHealthDataErasure('a', Date.now() + 30000)).toBe('complete');
    expect(fixture.records.get(consentPath('a'))).toMatchObject({ status: 'withdrawn', revision: 7 });
    expect(fixture.records.has('users/a')).toBe(false);
  });

  it('retires a completed receipt only after its erasure epoch is durably attested', async () => {
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 30000)).toBe('complete');
    const job = fixture.records.get(markerPath('a'))!;
    job.purgeAfter = Timestamp.fromMillis(Date.now() - 1);
    fixture.records.get(consentPath('a'))!.erasedBeforeRevision = 2;
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30000)).toBe(0);
    expect(fixture.records.has(markerPath('a'))).toBe(true);
    fixture.records.get(consentPath('a'))!.erasedBeforeRevision = 3;
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30000)).toBe(1);
    expect(fixture.records.has(markerPath('a'))).toBe(false);
    expect(fixture.records.has(consentPath('a'))).toBe(true);
  });

  it('never authorizes local purge using a receipt from a prior reaccepted generation', async () => {
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 30000)).toBe('complete');
    const acceptance = {
      acceptedTerms: true as const, acceptedHealthData: true as const,
      privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
    };
    await recordHealthConsentReacceptance('a', acceptance, 4);
    expect(await readHealthDataErasureStatus('a'))
      .toMatchObject({ complete: true, localPurgeAuthorized: false });
    await recordHealthConsentWithdrawal('a', 5);
    expect(await readHealthDataErasureStatus('a'))
      .toMatchObject({ complete: true, localPurgeAuthorized: false });
  });

  it('denies new requests while consent is active or full account deletion is pending', async () => {
    fixture.records.get(consentPath('a'))!.status = 'active';
    await expect(createHealthDataErasureJob('a')).rejects.toThrow('revoca');
    expect(fixture.records.has(markerPath('a'))).toBe(false);
    fixture.records.get(consentPath('a'))!.status = 'withdrawn';
    fixture.records.set('account_deletions/a', { uid: 'a', status: 'requested' });
    await expect(createHealthDataErasureJob('a')).rejects.toThrow('account');
    expect(fixture.records.has(markerPath('a'))).toBe(false);
  });

  it('retains the job and resumes after an interrupted page read', async () => {
    await createHealthDataErasureJob('a');
    fixture.failQueryOnce = 'users/a/history_months';
    expect(await processHealthDataErasure('a', Date.now() + 30000)).toBe('failed');
    expect(await readHealthDataErasureStatus('a')).toMatchObject({ status: 'failed', retryable: true });
    expect(fixture.records.has('users/a/history_months/2026-09')).toBe(true);
    expect(fixture.records.has('user_data_keys/a')).toBe(true);
    expect(fixture.records.get(consentPath('a'))?.revision).toBe(3);
    expect(await processHealthDataErasure('a', Date.now() + 30000)).toBe('complete');
    expect(fixture.records.has('users/a/history_months/2026-09')).toBe(false);
  });

  it('permits only one destructive worker to hold the lease while page reads are in flight', async () => {
    await createHealthDataErasureJob('a');
    let onEntered!: () => void;
    let allowResume!: () => void;
    const entered = new Promise<void>(resolve => { onEntered = resolve; });
    const resume = new Promise<void>(resolve => { allowResume = resolve; });
    fixture.pauseQuery = { path: 'users/a/history_months', entered: onEntered, resume };
    const first = processHealthDataErasure('a', Date.now() + 30000);
    await entered;
    expect(await processHealthDataErasure('a', Date.now() + 30000)).toBe('busy');
    expect(fixture.records.has('users/a/history_months/2026-09')).toBe(true);
    expect((await readHealthDataErasureStatus('a'))?.complete).toBe(false);
    allowResume();
    expect(await first).toBe('complete');
    expect((await readHealthDataErasureStatus('a'))?.complete).toBe(true);
  });

  it('does not delete anything when the worker deadline is already exhausted', async () => {
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 500)).toBe('pending');
    expect(fixture.records.has('users/a/history_months/2026-09')).toBe(true);
    expect(fixture.records.get(markerPath('a'))).toMatchObject({ status: 'requested' });
    expect(fixture.records.get(consentPath('a'))?.revision).toBe(3);
  });

  it('never completes or deletes a page after losing its worker lease', async () => {
    await createHealthDataErasureJob('a');
    let onEntered!: () => void;
    let allowResume!: () => void;
    const entered = new Promise<void>(resolve => { onEntered = resolve; });
    const resume = new Promise<void>(resolve => { allowResume = resolve; });
    fixture.pauseQuery = { path: 'users/a/history_months', entered: onEntered, resume };
    const first = processHealthDataErasure('a', Date.now() + 30000);
    await entered;
    fixture.records.get(markerPath('a'))!.leaseOwner = 'another-worker';
    allowResume();
    expect(await first).toBe('busy');
    expect(fixture.records.has('users/a/history_months/2026-09')).toBe(true);
    expect(fixture.records.get(consentPath('a'))?.revision).toBe(3);
  });

  it('never claims success when an unknown private collection still exists', async () => {
    fixture.records.set('users/a/unexpected_private/secret', { content: 'must not silently drop' });
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 30000)).toBe('failed');
    expect(await readHealthDataErasureStatus('a')).toMatchObject({
      status: 'failed', complete: false, retryable: false,
    });
    expect(fixture.records.has('users/a/unexpected_private/secret')).toBe(true);
    expect(fixture.records.get('user_data_keys/a')?.ciphertext).toBe('wrapped-a');
    expect(fixture.records.get(consentPath('a'))?.revision).toBe(3);
  });
});
