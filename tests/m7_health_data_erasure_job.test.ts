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

  it('fails closed on an unknown nested collection and preserves the wrapped key', async () => {
    fixture.records.set('users/a/unrecognized_records/one', { data: 'unexpected' });
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 30000)).toBe('failed');
    expect(await readHealthDataErasureStatus('a')).toMatchObject({
      status: 'failed', complete: false, localPurgeAuthorized: false,
    });
    expect(fixture.records.has('users/a/unrecognized_records/one')).toBe(true);
    expect(fixture.records.has('user_data_keys/a')).toBe(true);
    expect(fixture.records.get(consentPath('a'))).toMatchObject({ status: 'withdrawn', revision: 3 });
  });

  it('keeps local purge blocked when a completed erasure still has an unexpected ADK residue', async () => {
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 30000)).toBe('complete');
    expect((await readHealthDataErasureStatus('a'))?.localPurgeAuthorized).toBe(true);
    fixture.records.set('user_data_keys/a', { uid: 'a', ciphertext: 'unexpected' });
    expect(await readHealthDataErasureStatus('a')).toMatchObject({
      complete: true, localPurgeAuthorized: false,
    });
    expect(fixture.records.has('user_data_keys/b')).toBe(true);
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
    // The transactional update replaces the document; reload the committed receipt.
    fixture.records.get(markerPath('a'))!.purgeAfter = Timestamp.fromMillis(Date.now() - 1);
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30000)).toBe(1);
    expect(fixture.records.has(markerPath('a'))).toBe(false);
    expect(fixture.records.has(consentPath('a'))).toBe(true);
  });

  it('scans beyond a full page of ineligible expired receipts without starving later valid ones', async () => {
    const expired = Timestamp.fromMillis(Date.now() - 60_000);
    for (let i = 0; i < 100; i++) {
      const uid = 'invalid-' + String(i).padStart(3, '0');
      fixture.records.set(markerPath(uid), {
        uid, status: 'complete', consentRevision: 3, purgeAfter: expired,
      });
    }
    fixture.records.set(markerPath('valid'), {
      uid: 'valid', status: 'complete', consentRevision: 3, purgeAfter: expired,
    });
    fixture.records.set(consentPath('valid'), { uid: 'valid', status: 'withdrawn', revision: 4, erasedBeforeRevision: 3 });
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30_000)).toBe(1);
    expect(fixture.records.has(markerPath('valid'))).toBe(false);
    expect(fixture.records.has(markerPath('invalid-000'))).toBe(true);
  });

  it('makes bounded progress across cron runs when expired receipts lack epoch proof', async () => {
    const expired = Timestamp.fromMillis(Date.now() - 60_000);
    for (let i = 0; i < 201; i++) {
      const uid = 'invalid-' + String(i).padStart(3, '0');
      fixture.records.set(markerPath(uid), {
        uid, status: 'complete', consentRevision: 3, purgeAfter: expired,
      });
    }
    fixture.records.set(markerPath('zz-valid'), {
      uid: 'zz-valid', status: 'complete', consentRevision: 3, purgeAfter: expired,
    });
    fixture.records.set(consentPath('zz-valid'), {
      uid: 'zz-valid', status: 'withdrawn', revision: 4, erasedBeforeRevision: 3,
    });

    // The first run cannot inspect all 201 invalid records within its scan cap.
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30_000)).toBe(0);
    expect(fixture.records.has(markerPath('zz-valid'))).toBe(true);
    expect(fixture.records.get(markerPath('invalid-000'))?.status).toBe('complete');
    expect((fixture.records.get(markerPath('invalid-000'))!.purgeAfter as Timestamp).toMillis())
      .toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    expect(fixture.records.get(markerPath('invalid-200'))?.purgeAfter).toEqual(expired);

    // A fresh invocation must reach the valid owner instead of rescanning 200 blocked receipts.
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30_000)).toBe(1);
    expect(fixture.records.has(markerPath('zz-valid'))).toBe(false);
    expect(fixture.records.has(markerPath('invalid-000'))).toBe(true);
    expect(fixture.records.has(markerPath('invalid-200'))).toBe(true);
    expect(fixture.records.get(consentPath('zz-valid'))?.erasedBeforeRevision).toBe(3);
  });

  it('keeps a blocked receipt and deletes it only after epoch proof is repaired', async () => {
    const expired = Timestamp.fromMillis(Date.now() - 60_000);
    fixture.records.set(markerPath('blocked'), {
      uid: 'blocked', status: 'complete', consentRevision: 3, purgeAfter: expired,
    });
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30_000)).toBe(0);
    const deferred = fixture.records.get(markerPath('blocked'))!;
    expect(deferred.status).toBe('complete');
    expect((deferred.purgeAfter as Timestamp).toMillis()).toBeGreaterThan(Date.now());

    fixture.records.set(consentPath('blocked'), {
      uid: 'blocked', status: 'withdrawn', revision: 4, erasedBeforeRevision: 3,
    });
    // Simulate the deferred retry window expiring; the proof now authorizes retirement.
    deferred.purgeAfter = expired;
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30_000)).toBe(1);
    expect(fixture.records.has(markerPath('blocked'))).toBe(false);
  });

  it('leaves receipts unchanged after a retention query failure, then safely retries', async () => {
    const expired = Timestamp.fromMillis(Date.now() - 60_000);
    fixture.records.set(markerPath('blocked'), {
      uid: 'blocked', status: 'complete', consentRevision: 3, purgeAfter: expired,
    });
    fixture.failQueryOnce = 'health_data_erasures';
    await expect(purgeExpiredCompletedHealthErasures(Date.now() + 30_000))
      .rejects.toThrow('Injected Firestore outage');
    expect(fixture.records.get(markerPath('blocked'))?.purgeAfter).toEqual(expired);
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30_000)).toBe(0);
    expect(fixture.records.has(markerPath('blocked'))).toBe(true);
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
