import { beforeEach, describe, expect, it, vi } from 'vitest';

type Entry = Record<string, unknown>;
const fixture = vi.hoisted(() => ({
  records: new Map<string, Entry>(),
  failQueryOnce: '' as string,
  pauseQuery: null as null | { path: string; entered: () => void; resume: Promise<void> },
  transactionCount: 0,
}));

vi.mock('../../server/accountDeletion/firebaseAdmin', async () => {
  const { makeHealthErasureAdminMock } = await import('./healthErasureJobFixture');
  return makeHealthErasureAdminMock(fixture);
});

import { createHealthDataErasureJob, processHealthDataErasure, readHealthDataErasureStatus } from '../../server/healthConsent/erasure';
import { resetHealthErasureFixture, consentPath, markerPath } from './healthErasureJobFixture';

beforeEach(() => resetHealthErasureFixture(fixture));

describe('trusted data-only erasure lease and interrupted recovery', () => {
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
    expect(fixture.records.has('users/a')).toBe(false);
    expect(fixture.records.has('user_data_keys/a')).toBe(false);
    expect(fixture.records.get(consentPath('a'))).toMatchObject({
      uid: 'a', status: 'withdrawn', revision: 4, erasedBeforeRevision: 3,
    });
    expect(fixture.records.get('user_data_keys/b')?.ciphertext).toBe('wrapped-b');
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
    expect(fixture.records.get('user_data_keys/a')?.ciphertext).toBe('wrapped-a');
    expect(fixture.records.get(markerPath('a'))?.attempts).toBe(1);
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

  it('fences page deletion if the leased job is reassigned to a foreign UID', async () => {
    await createHealthDataErasureJob('a');
    let onEntered!: () => void;
    let allowResume!: () => void;
    const entered = new Promise<void>(resolve => { onEntered = resolve; });
    const resume = new Promise<void>(resolve => { allowResume = resolve; });
    fixture.pauseQuery = { path: 'users/a/history_months', entered: onEntered, resume };
    const running = processHealthDataErasure('a', Date.now() + 30_000);
    await entered;
    fixture.records.get(markerPath('a'))!.uid = 'other-account';
    allowResume();

    expect(await running).toBe('busy');
    expect(fixture.records.has('users/a/history_months/2026-09')).toBe(true);
    expect(fixture.records.has('user_data_keys/a')).toBe(true);
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
    expect(fixture.records.get(markerPath('a'))?.leaseOwner).toBe('another-worker');
    expect(fixture.records.get(markerPath('a'))?.attempts).toBe(1);
    expect(fixture.records.get('user_data_keys/a')?.ciphertext).toBe('wrapped-a');
    expect(fixture.records.has('users/a')).toBe(true);
    expect(fixture.records.has('users/b')).toBe(true);
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
