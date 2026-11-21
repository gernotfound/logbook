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

import { Timestamp } from 'firebase-admin/firestore';
import { createHealthDataErasureJob, processHealthDataErasure, readHealthDataErasureStatus, purgeExpiredCompletedHealthErasures } from '../../server/healthConsent/erasure';
import { recordHealthConsentReacceptance, recordHealthConsentWithdrawal } from '../../server/healthConsent/withdrawal';
import { LEGAL_VERSIONS } from '../../src/lib/legalVersions';
import { resetHealthErasureFixture, consentPath, markerPath } from './healthErasureJobFixture';

beforeEach(() => resetHealthErasureFixture(fixture));

describe('trusted data-only erasure receipt retention', () => {
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

  it.each([
    'foreign-consent-owner', 'missing-completion-epoch',
    'inconsistent-completion-epoch', 'consent-before-completion',
  ] as const)('preserves a receipt when retention proof has %s', async scenario => {
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 30_000)).toBe('complete');
    const job = fixture.records.get(markerPath('a'))!;
    const consent = fixture.records.get(consentPath('a'))!;
    const recordedJob = { ...job };
    const recordedConsent = { ...consent };
    const expired = Timestamp.fromMillis(Date.now() - 60_000);
    job.purgeAfter = expired;

    if (scenario === 'foreign-consent-owner') consent.uid = 'b';
    if (scenario === 'missing-completion-epoch') delete job.completedRevision;
    if (scenario === 'inconsistent-completion-epoch') job.completedRevision = 5;
    if (scenario === 'consent-before-completion') consent.revision = 3;

    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30_000)).toBe(0);
    expect(fixture.records.has(markerPath('a'))).toBe(true);
    expect((fixture.records.get(markerPath('a'))!.purgeAfter as Timestamp).toMillis())
      .toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

    // Repair the trusted evidence and retry after the deferral period.
    fixture.records.set(consentPath('a'), recordedConsent);
    fixture.records.set(markerPath('a'), { ...recordedJob, purgeAfter: expired });
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30_000)).toBe(1);
    expect(fixture.records.has(markerPath('a'))).toBe(false);
  });

  it.each([
    'orphaned-account-key', 'invalid-consent-status', 'active-without-new-epoch',
    'active-without-acceptance-proof',
  ] as const)('preserves an expired receipt with %s until the trusted state is repaired', async scenario => {
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 30_000)).toBe('complete');
    const consent = fixture.records.get(consentPath('a'))!;
    const validConsent = { ...consent };
    const expired = Timestamp.fromMillis(Date.now() - 60_000);
    fixture.records.get(markerPath('a'))!.purgeAfter = expired;
    if (scenario === 'orphaned-account-key') {
      fixture.records.set('user_data_keys/a', { uid: 'a', ciphertext: 'unexpected-residue' });
    } else if (scenario === 'active-without-acceptance-proof') {
      // A forged higher revision is not an explicit acceptance: the legal
      // evidence required by the trusted consent validator is missing.
      consent.status = 'active';
      consent.revision = 5;
    } else {
      consent.status = scenario === 'invalid-consent-status' ? 'unknown' : 'active';
    }

    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30_000)).toBe(0);
    expect(fixture.records.has(markerPath('a'))).toBe(true);
    expect((fixture.records.get(markerPath('a'))!.purgeAfter as Timestamp).toMillis())
      .toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

    fixture.records.set(consentPath('a'), validConsent);
    fixture.records.delete('user_data_keys/a');
    fixture.records.get(markerPath('a'))!.purgeAfter = expired;
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30_000)).toBe(1);
    expect(fixture.records.has(markerPath('a'))).toBe(false);
  });

  it('retires an old completed receipt after a newer explicit consent', async () => {
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 30_000)).toBe('complete');
    await recordHealthConsentReacceptance('a', {
      acceptedTerms: true, acceptedHealthData: true,
      privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
    }, 4);
    fixture.records.set('user_data_keys/a', { uid: 'a', ciphertext: 'new-generation-key' });
    fixture.records.get(markerPath('a'))!.purgeAfter = Timestamp.fromMillis(Date.now() - 60_000);
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30_000)).toBe(1);
    expect(fixture.records.has(markerPath('a'))).toBe(false);
    expect(fixture.records.get(consentPath('a'))).toMatchObject({
      uid: 'a', status: 'active', revision: 5, erasedBeforeRevision: 3,
    });
  });

  it('recovers owner-scoped completion proof after the 30-day receipt expires and never reenqueues it', async () => {
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 30_000)).toBe('complete');
    fixture.records.get(markerPath('a'))!.purgeAfter = Timestamp.fromMillis(Date.now() - 1);
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30_000)).toBe(1);
    expect(fixture.records.has(markerPath('a'))).toBe(false);
    expect(await readHealthDataErasureStatus('a')).toEqual({
      status: 'complete', complete: true, localPurgeAuthorized: true,
    });
    await createHealthDataErasureJob('a');
    expect(fixture.records.has(markerPath('a'))).toBe(false);
    expect(await recordHealthConsentWithdrawal('a', 3)).toEqual({ status: 'withdrawn', revision: 4 });
    expect(fixture.records.has(markerPath('a'))).toBe(false);
    expect(fixture.records.get(consentPath('a'))).toMatchObject({
      uid: 'a', status: 'withdrawn', revision: 4, erasedBeforeRevision: 3,
    });
  });

  it('rejects expired completion proof with a foreign owner, unexpected key or new consent cycle', async () => {
    await createHealthDataErasureJob('a');
    expect(await processHealthDataErasure('a', Date.now() + 30_000)).toBe('complete');
    fixture.records.get(markerPath('a'))!.purgeAfter = Timestamp.fromMillis(Date.now() - 1);
    expect(await purgeExpiredCompletedHealthErasures(Date.now() + 30_000)).toBe(1);

    fixture.records.set('user_data_keys/a', { uid: 'a', ciphertext: 'unexpected' });
    expect(await readHealthDataErasureStatus('a')).toBeNull();
    fixture.records.delete('user_data_keys/a');
    fixture.records.get(consentPath('a'))!.uid = 'other-owner';
    expect(await readHealthDataErasureStatus('a')).toBeNull();
    fixture.records.get(consentPath('a'))!.uid = 'a';
    fixture.records.get(consentPath('a'))!.revision = 6;
    expect(await readHealthDataErasureStatus('a')).toBeNull();
    fixture.records.get(consentPath('a'))!.revision = 4;

    const acceptance = {
      acceptedTerms: true as const, acceptedHealthData: true as const,
      privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
    };
    await recordHealthConsentReacceptance('a', acceptance, 4);
    expect(await readHealthDataErasureStatus('a')).toBeNull();
    await recordHealthConsentWithdrawal('a', 5);
    expect(await readHealthDataErasureStatus('a')).toMatchObject({
      status: 'requested', complete: false, localPurgeAuthorized: false,
    });
  });

  it('scans beyond a full page of ineligible expired receipts without starving later valid ones', async () => {
    const expired = Timestamp.fromMillis(Date.now() - 60_000);
    for (let i = 0; i < 100; i++) {
      const uid = 'invalid-' + String(i).padStart(3, '0');
      fixture.records.set(markerPath(uid), {
        uid, status: 'complete', consentRevision: 3, purgeAfter: expired,
      });
    }
    // Real completed receipts persist the successor revision; only the
    // 100 preceding malformed receipts deliberately omit that evidence.
    fixture.records.set(markerPath('valid'), {
      uid: 'valid', status: 'complete', consentRevision: 3, completedRevision: 4,
      purgeAfter: expired,
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
      uid: 'zz-valid', status: 'complete', consentRevision: 3, completedRevision: 4,
      purgeAfter: expired,
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
    // The repaired receipt needs its own completed epoch as well as
    // the restored consent floor; a floor alone never proves completion.
    deferred.completedRevision = 4;
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
    // A new confirmed withdrawal enqueues a NEW generation, so an older
    // completed receipt can no longer authorize any local purge.
    expect(fixture.records.get(markerPath('a'))).toMatchObject({
      status: 'requested', consentRevision: 6,
    });
    expect(await readHealthDataErasureStatus('a'))
      .toMatchObject({ status: 'requested', complete: false, localPurgeAuthorized: false });
  });
});
