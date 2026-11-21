import { beforeEach, describe, expect, it } from 'vitest';
import {
  POST, acceptance, finishErasure, req, storage, transactionFixture,
  readHealthConsentState, recordHealthConsentWithdrawal,
  recordHealthConsentReacceptance, resetConsentTestState,
} from './healthConsentApiHarness';

describe('withdrawal revision concurrency', () => {
  beforeEach(resetConsentTestState);

  it('retries overlapping withdrawals against the committed revision, not stale snapshots', async () => {
    storage.documents.clear();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    transactionFixture.overlap = { arrivals: 0, release, gate };
    const [first, second] = await Promise.all([
      recordHealthConsentWithdrawal('account-1', 0),
      recordHealthConsentWithdrawal('account-1', 0),
    ]);
    expect(transactionFixture.overlap.arrivals).toBe(2);
    expect(transactionFixture.retries).toBe(1);
    expect(first).toEqual({ status: 'withdrawn', revision: 1 });
    expect(second).toEqual(first);
    expect(storage.documents.get('health_consent_withdrawals/account-1')).toMatchObject({
      uid: 'account-1', status: 'withdrawn', revision: 1,
    });
    expect(storage.documents.get('health_data_erasures/account-1')).toMatchObject({
      uid: 'account-1', status: 'requested', consentRevision: 1,
    });
    transactionFixture.overlap = null;
  });

  it('retries overlapping reacceptance against the winning consent revision', async () => {
    storage.documents.clear();
    await recordHealthConsentWithdrawal('account-1', 0);
    finishErasure(1);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    transactionFixture.overlap = { arrivals: 0, release, gate };
    const [first, second] = await Promise.all([
      recordHealthConsentReacceptance('account-1', acceptance, 2),
      recordHealthConsentReacceptance('account-1', acceptance, 2),
    ]);
    expect(transactionFixture.overlap.arrivals).toBe(2);
    expect(transactionFixture.retries).toBe(1);
    expect(first).toMatchObject({ status: 'active', revision: 3 });
    expect(second).toEqual(first);
    expect(storage.documents.get('health_consent_withdrawals/account-1')).toMatchObject({
      uid: 'account-1', status: 'active', revision: 3,
    });
    transactionFixture.overlap = null;
  });

  it('refuses a delayed revocation request after another device reaccepted', async () => {
    storage.documents.clear();
    await recordHealthConsentWithdrawal('account-1', 0);
    finishErasure(1);
    await recordHealthConsentReacceptance('account-1', acceptance, 2);
    const stale = await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }));
    expect(stale.status).toBe(409);
    expect((await readHealthConsentState('account-1')).status).toBe('active');
    expect(await recordHealthConsentWithdrawal('account-1', 3)).toEqual({ status: 'withdrawn', revision: 4 });
  });
});

describe('reacceptance compare-and-set', () => {
  beforeEach(resetConsentTestState);

  it('refuses an old delayed acceptance after a later withdrawal', async () => {
    storage.documents.clear();
    await recordHealthConsentWithdrawal('account-1', 0);
    finishErasure(1);
    await recordHealthConsentReacceptance('account-1', acceptance, 2);
    await recordHealthConsentWithdrawal('account-1', 3);
    const response = await POST(req('POST', { action: 'reaccept', acceptance, expectedRevision: 1 }));
    expect(response.status).toBe(409);
    expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');
    await expect(recordHealthConsentReacceptance('account-1', acceptance, 4)).rejects.toThrow('revoca');
    finishErasure(4);
    expect(await recordHealthConsentReacceptance('account-1', acceptance, 5)).toMatchObject({ status: 'active', revision: 6 });
  });
});
