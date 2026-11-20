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
import { readHealthConsentState, recordHealthConsentReacceptance, recordHealthConsentWithdrawal } from '../../server/healthConsent/withdrawal';
import { LEGAL_VERSIONS } from '../../src/lib/legalVersions';
import { resetHealthErasureFixture, consentPath, markerPath } from './healthErasureJobFixture';

beforeEach(() => resetHealthErasureFixture(fixture));

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

  it('avoids three no-op page transactions while preserving the final lease-fenced erasure', async () => {
    fixture.records.delete('users/a/history_months/2026-09');
    fixture.records.delete('users/a/nutrition_months/2026-09');
    fixture.records.delete('users/a/sync_control/state');
    await createHealthDataErasureJob('a');
    const transactionsBefore = fixture.transactionCount;

    expect(await processHealthDataErasure('a', Date.now() + 30_000)).toBe('complete');
    // Acquire lease, delete root, complete erasure: no transaction for empty pages.
    expect(fixture.transactionCount - transactionsBefore).toBe(3);
    expect(fixture.records.has('users/a')).toBe(false);
    expect(fixture.records.has('user_data_keys/a')).toBe(false);
  });

  it.each([
    ['unknown status', { status: 'unsupported' }],
    ['noninteger attempts', { attempts: 'invalid' }],
    ['negative attempts', { attempts: -1 }],
  ])('rejects a malformed %s before acquiring a destructive lease', async (_label, patch) => {
    await createHealthDataErasureJob('a');
    Object.assign(fixture.records.get(markerPath('a'))!, patch);

    await expect(processHealthDataErasure('a', Date.now() + 30_000)).rejects.toThrow('Job cancellazione non valido.');
    expect(fixture.records.get(markerPath('a'))).toMatchObject(patch);
    expect(fixture.records.has('users/a/history_months/2026-09')).toBe(true);
    expect(fixture.records.has('user_data_keys/a')).toBe(true);
  });

  it('never retries a failed job unless retryability is explicitly authorized', async () => {
    await createHealthDataErasureJob('a');
    const job = fixture.records.get(markerPath('a'))!;
    job.status = 'failed';
    delete job.retryable;

    expect(await processHealthDataErasure('a', Date.now() + 30_000)).toBe('busy');
    expect(fixture.records.get(markerPath('a'))).toMatchObject({ status: 'failed', attempts: 0 });
    expect(fixture.records.has('users/a/history_months/2026-09')).toBe(true);
    expect(fixture.records.has('user_data_keys/a')).toBe(true);
  });

  it.each(['active-consent', 'wrong-revision'] as const)(
    'refuses destructive work when the queued consent has %s', async scenario => {
      await createHealthDataErasureJob('a');
      const consent = fixture.records.get(consentPath('a'))!;
      if (scenario === 'active-consent') consent.status = 'active';
      else consent.revision = 4;

      expect(await processHealthDataErasure('a', Date.now() + 30_000)).toBe('failed');
      expect(fixture.records.get(markerPath('a'))).toMatchObject({
        status: 'failed', retryable: false,
      });
      expect(fixture.records.has('users/a/history_months/2026-09')).toBe(true);
      expect(fixture.records.has('user_data_keys/a')).toBe(true);
      expect(fixture.records.has('users/b')).toBe(true);
    },
  );

  it('does not delete data when a queued erasure no longer belongs to its consent owner', async () => {
    await createHealthDataErasureJob('a');
    fixture.records.get(consentPath('a'))!.uid = 'other-account';

    expect(await processHealthDataErasure('a', Date.now() + 30_000)).toBe('failed');
    expect(await readHealthDataErasureStatus('a')).toMatchObject({
      status: 'failed', complete: false, retryable: false, localPurgeAuthorized: false,
    });
    expect(fixture.records.has('users/a')).toBe(true);
    expect(fixture.records.has('users/a/history_months/2026-09')).toBe(true);
    expect(fixture.records.has('user_data_keys/a')).toBe(true);
    expect(fixture.records.get(consentPath('a'))?.revision).toBe(3);
  });

  it('preserves the cloud key if consent ownership changes during a leased erasure', async () => {
    await createHealthDataErasureJob('a');
    let onEntered!: () => void;
    let allowResume!: () => void;
    const entered = new Promise<void>(resolve => { onEntered = resolve; });
    const resume = new Promise<void>(resolve => { allowResume = resolve; });
    fixture.pauseQuery = { path: 'users/a/history_months', entered: onEntered, resume };
    const running = processHealthDataErasure('a', Date.now() + 30_000);
    await entered;
    fixture.records.get(consentPath('a'))!.uid = 'other-account';
    allowResume();

    expect(await running).toBe('failed');
    expect(await readHealthDataErasureStatus('a')).toMatchObject({
      status: 'failed', complete: false, retryable: false, localPurgeAuthorized: false,
    });
    expect(fixture.records.has('user_data_keys/a')).toBe(true);
    expect(fixture.records.has('users/a/history_months/2026-09')).toBe(true);
    expect(fixture.records.get(consentPath('a'))?.revision).toBe(3);
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

  it.each([
    ['known', 'users/a/history_months/2026-09/legacy_private/secret'],
    ['unknown', 'users/a/undocumented/ghost/deep/secret'],
  ])('fails closed when %s subcollections outlive missing parent documents', async (_kind, residualPath) => {
    fixture.records.set(residualPath, { medical: 'retained for inspection' });
    await createHealthDataErasureJob('a');

    expect(await processHealthDataErasure('a', Date.now() + 30_000)).toBe('failed');
    expect(await readHealthDataErasureStatus('a')).toMatchObject({
      status: 'failed', complete: false, localPurgeAuthorized: false, retryable: false,
    });
    expect(fixture.records.has(residualPath)).toBe(true);
    expect(fixture.records.has('user_data_keys/a')).toBe(true);
    expect(fixture.records.get(consentPath('a'))).toMatchObject({ status: 'withdrawn', revision: 3 });
  });

  it('keeps local purge blocked when a completed erasure still has an unexpected ADK residue', async () => {
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 30000)).toBe('complete');
    expect((await readHealthDataErasureStatus('a'))?.localPurgeAuthorized).toBe(true);
    fixture.records.get(consentPath('a'))!.uid = 'other-owner';
    expect((await readHealthDataErasureStatus('a'))?.localPurgeAuthorized).toBe(false);
    fixture.records.get(consentPath('a'))!.uid = 'a';
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
});
