import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  POST, acceptance, adminDb, erasureWorker, finishErasure, req,
  storage, transactionFixture, HealthConsentRevisionConflictError,
  readHealthConsentState, recordHealthConsentWithdrawal,
  recordHealthConsentReacceptance, recordInitialHealthConsentAcceptance,
  removeHealthConsentStateForDeletedAccount, resetConsentTestState,
} from './healthConsentApiHarness';

describe('trusted health withdrawal and data erasure atomicity', () => {
  beforeEach(resetConsentTestState);

  it('maps a terminal erasure job conflict to 409 without retrying the worker', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    const jobPath = 'health_data_erasures/account-1';
    const job = storage.documents.get(jobPath)!;
    storage.documents.set(jobPath, { ...job, status: 'failed', retryable: false });

    const response = await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }));

    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toHaveProperty('error', expect.stringContaining('controllo'));
    expect(erasureWorker.process).not.toHaveBeenCalled();
    expect(storage.documents.get('health_consent_withdrawals/account-1')).toMatchObject({
      uid: 'account-1', status: 'withdrawn', revision: 1,
    });
    expect(storage.documents.get(jobPath)).toMatchObject({ status: 'failed', retryable: false });
  });

  it('confirms a durably queued withdrawal even if immediate erasure processing fails', async () => {
    erasureWorker.process.mockRejectedValueOnce(new Error('injected worker failure'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'withdrawn', revision: 1 });
      expect(storage.documents.get('health_data_erasures/account-1')).toMatchObject({
        uid: 'account-1', status: 'requested', consentRevision: 1,
      });
      expect(errorLog).toHaveBeenCalledWith('[health-consent] erasure handoff failed', { kind: 'Error' });
    } finally {
      errorLog.mockRestore();
    }
  });

  it('atomically queues health erasure with the withdrawal and preserves ciphertext until the worker runs', async () => {
    const document = {
      _schemaVersion: 1,
      _sync: { protocolVersion: 3, clock: { s00: 1 },
        writer: { slot: 's00', replicaId: 'fixture-replica', generation: 1, seq: 1, consentRevision: 1 },
        fields: {} },
      _sealed: { format: 'thelogbook-cloud-document', version: 1,
        nonce: 'a'.repeat(32), ciphertext: 'b'.repeat(32) },
    };
    const month = structuredClone(document);
    const wrappedKey = {
      uid: 'account-1', format: 'thelogbook-wrapped-account-key',
      version: 1, ciphertext: 'synthetic-wrapped-key',
    };
    const expectedDocument = structuredClone(document);
    const expectedMonth = structuredClone(month);
    const expectedWrappedKey = structuredClone(wrappedKey);
    storage.documents.set('users/account-1', document);
    storage.documents.set('users/account-1/history_months/2026-11', month);
    storage.documents.set('user_data_keys/account-1', wrappedKey);

    const first = await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: 'withdrawn', revision: 1 });
    expect(await recordHealthConsentWithdrawal('account-1', 0)).toEqual({ status: 'withdrawn', revision: 1 });
    const state = storage.documents.get('health_consent_withdrawals/account-1');
    expect(state).toMatchObject({ uid: 'account-1', revision: 1, status: 'withdrawn' });
    expect(storage.documents.get('health_data_erasures/account-1')).toMatchObject({
      uid: 'account-1', status: 'requested', consentRevision: 1,
    });
    expect(storage.documents.get('users/account-1')).toEqual(expectedDocument);
    expect(storage.documents.get('users/account-1/history_months/2026-11')).toEqual(expectedMonth);
    expect(storage.documents.get('user_data_keys/account-1')).toEqual(expectedWrappedKey);
    expect(storage.documents.size).toBe(5);
    expect(erasureWorker.process).toHaveBeenCalledWith('account-1', expect.any(Number));
  });

  it('rolls back consent withdrawal if erasure enqueue fails in the transaction', async () => {
    await recordInitialHealthConsentAcceptance('account-1', acceptance);
    transactionFixture.failErasureSetOnce = true;
    await expect(recordHealthConsentWithdrawal('account-1', 1))
      .rejects.toThrow('transactional erasure job');
    expect(storage.documents.get('health_consent_withdrawals/account-1')).toMatchObject({
      status: 'active', revision: 1,
    });
    expect(storage.documents.has('health_data_erasures/account-1')).toBe(false);
    expect(await recordHealthConsentWithdrawal('account-1', 1)).toMatchObject({
      status: 'withdrawn', revision: 2,
    });
    expect(storage.documents.get('health_data_erasures/account-1')).toMatchObject({
      status: 'requested', consentRevision: 2,
    });
  });

  it('rejects invalid and stale version acceptances while withdrawn', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    for (const invalid of [null, {}, { ...acceptance, acceptedHealthData: false }, { ...acceptance, privacyVersion: 'old' }]) {
      const response = await POST(req('POST', { action: 'reaccept', acceptance: invalid, expectedRevision: 1 }));
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty('error');
      expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');
    }
  });

  it('reenables only after explicit acceptance; retry is idempotent and later revocation advances revision', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    storage.documents.set('users/account-1', { _schemaVersion: 1, _sync: { writer: { seq: 5 } }, legalConsent: { acceptedAt: 'old' } });
    expect(storage.documents.has('users/account-1')).toBe(true);
    await expect(recordHealthConsentReacceptance('account-1', acceptance, 1)).rejects.toThrow('revoca');
    finishErasure(1);
    const accepted = await recordHealthConsentReacceptance('account-1', acceptance, 2);
    expect(storage.documents.has('users/account-1')).toBe(false);
    expect(accepted).toMatchObject({ status: 'active', revision: 3, acceptedAt: expect.any(String) });
    expect(await recordHealthConsentReacceptance('account-1', acceptance, 2)).toEqual(accepted);
    const retry = await POST(req('POST', { action: 'reaccept', expectedRevision: 2, acceptance }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(accepted);
    expect(await recordHealthConsentWithdrawal('account-1', 3)).toEqual({ status: 'withdrawn', revision: 4 });
    const staleSecondCycle = await POST(req('POST', { action: 'withdraw', expectedRevision: 0 }));
    expect(staleSecondCycle.status).toBe(409);
    expect(await readHealthConsentState('account-1')).toMatchObject({ status: 'withdrawn', revision: 4 });
    expect(await recordHealthConsentWithdrawal('account-1', 3)).toEqual({ status: 'withdrawn', revision: 4 });
  });

  it('will not resume or withdraw when account deletion has started', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    storage.documents.set('account_deletions/account-1', { status: 'requested' });
    await expect(recordHealthConsentReacceptance('account-1', acceptance, 1)).rejects.toThrow('Cancellazione');
    await expect(recordHealthConsentWithdrawal('account-1', 0)).rejects.toThrow('Cancellazione');
  });

  it('does not reaccept while a data-only erasure job is incomplete', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    storage.documents.set('health_data_erasures/account-1', { uid: 'account-1', status: 'deleting', consentRevision: 1 });
    await expect(recordHealthConsentReacceptance('account-1', acceptance, 1))
      .rejects.toThrow('revoca');
    expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');

    finishErasure(1);
    expect(await recordHealthConsentReacceptance('account-1', acceptance, 2))
      .toMatchObject({ status: 'active', revision: 3 });
  });

  it('refuses reacceptance without a durable erasure generation even if the receipt is missing or marked complete', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    storage.documents.delete('health_data_erasures/account-1');
    await expect(recordHealthConsentReacceptance('account-1', acceptance, 1))
      .rejects.toBeInstanceOf(HealthConsentRevisionConflictError);

    storage.documents.set('health_data_erasures/account-1', {
      uid: 'account-1', status: 'complete', consentRevision: 1, completedRevision: 2,
    });
    await expect(recordHealthConsentReacceptance('account-1', acceptance, 1))
      .rejects.toBeInstanceOf(HealthConsentRevisionConflictError);
    expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');
  });

  it('rejects a mismatched completed erasure receipt even with a valid consent floor', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    finishErasure(1);
    const path = 'health_data_erasures/account-1';
    const valid = storage.documents.get(path)!;
    for (const patch of [
      { uid: 'other-account' },
      { consentRevision: 0 },
      { completedRevision: 3 },
    ]) {
      storage.documents.set(path, { ...valid, ...patch });
      await expect(recordHealthConsentReacceptance('account-1', acceptance, 2))
        .rejects.toBeInstanceOf(HealthConsentRevisionConflictError);
      expect((await readHealthConsentState('account-1')).status).toBe('withdrawn');
    }
  });

  it('refuses re-consent if the old wrapped cloud key remains after a completed erasure', async () => {
    storage.documents.clear();
    await recordHealthConsentWithdrawal('account-1', 0);
    finishErasure(1);
    storage.documents.set('user_data_keys/account-1', { uid: 'account-1', ciphertext: 'orphaned-key' });

    const blocked = await POST(req('POST', { action: 'reaccept', expectedRevision: 2, acceptance }));
    expect(blocked.status).toBe(409);
    expect(storage.documents.get('health_consent_withdrawals/account-1')).toMatchObject({
      uid: 'account-1', status: 'withdrawn', revision: 2, erasedBeforeRevision: 1,
    });
    expect(storage.documents.get('user_data_keys/account-1')).toMatchObject({ ciphertext: 'orphaned-key' });

    storage.documents.delete('user_data_keys/account-1');
    const accepted = await POST(req('POST', { action: 'reaccept', expectedRevision: 2, acceptance }));
    expect(accepted.status).toBe(200);
    // A legitimate key provisioned under the new active consent must not
    // invalidate an idempotent retry of that already-confirmed acceptance.
    storage.documents.set('user_data_keys/account-1', { uid: 'account-1', ciphertext: 'new-key' });
    const retry = await POST(req('POST', { action: 'reaccept', expectedRevision: 2, acceptance }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(await accepted.json());
  });

  it('accepts re-consent after completed receipt retention only with matching consent erasure proof', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    finishErasure(1);
    storage.documents.delete('health_data_erasures/account-1');
    expect(await recordHealthConsentReacceptance('account-1', acceptance, 2))
      .toMatchObject({ status: 'active', revision: 3 });
  });

  it('cleanup erases only the specific account consent marker', async () => {
    await recordHealthConsentWithdrawal('account-1', 0);
    await recordHealthConsentWithdrawal('account-2', 0);
    await adminDb().runTransaction(async tx => {
      removeHealthConsentStateForDeletedAccount('account-1', tx);
    });
    expect(storage.documents.has('health_consent_withdrawals/account-1')).toBe(false);
    expect(storage.documents.has('health_consent_withdrawals/account-2')).toBe(true);
  });
});
