import { describe, expect, it, vi } from 'vitest';
import { deviceRegistrationMocks, loadSubject, user } from './deviceRegistrationRetryFixture';

const { firebase, appCheck } = deviceRegistrationMocks;

describe('Device recovery: server receipt and finalizer outcomes', () => {
  it('does not report a missing backend as successful recovery when a device proof exists', async () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', '');
    const { recoverDeletedAccountOnThisDevice, registerDeletionRecoveryDevice } = await loadSubject();
    const raw = JSON.stringify([{ uid: 'user-a', token: 'A'.repeat(43) }]);
    localStorage.setItem('logbook_deletion_recovery_devices_v1', raw);
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    const finalize = vi.fn();

    await expect(recoverDeletedAccountOnThisDevice(finalize)).rejects.toMatchObject({
      operation: 'routine-check', phase: 'http', kind: 'configuration',
    });
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).toBe(raw);
    expect(finalize).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();

    const current = user('user-a');
    firebase.auth.currentUser = current;
    await expect(registerDeletionRecoveryDevice(current)).rejects.toMatchObject({
      operation: 'device-registration', phase: 'http', kind: 'configuration',
    });
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).toBe(raw);
  });

  it('has no device proof to check when the backend is absent and storage is empty', async () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', '');
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    await expect(recoverDeletedAccountOnThisDevice(vi.fn())).resolves.toEqual({ status: 'none' });
  });

  it('preserves a device proof after a fetch failure and retries the same proof on recovery', async () => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    const raw = JSON.stringify([{ uid: 'user-a', token: 'A'.repeat(43) }]);
    localStorage.setItem('logbook_deletion_recovery_devices_v1', raw);
    const network = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ uid: 'user-a', status: 'complete' }), { status: 200 }));
    vi.stubGlobal('fetch', network);
    const finalize = vi.fn(async () => ({ status: 'complete' as const }));

    await expect(recoverDeletedAccountOnThisDevice(finalize)).rejects.toMatchObject({
      operation: 'routine-check', phase: 'http', kind: 'transport',
    });
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).toBe(raw);
    expect(finalize).not.toHaveBeenCalled();

    await expect(recoverDeletedAccountOnThisDevice(finalize)).resolves.toEqual({ status: 'complete' });
    expect(finalize).toHaveBeenCalledExactlyOnceWith('user-a');
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('routes a completed device proof through the caller finalizer even while another account is authenticated', async () => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
    ]));
    firebase.auth.currentUser = user('user-b');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ uid: 'user-a', status: 'complete' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const finalize = vi.fn(async () => ({
      status: 'pending' as const,
      message: 'Altra identità attiva',
    }));

    await expect(recoverDeletedAccountOnThisDevice(finalize)).resolves.toEqual({
      status: 'pending',
      message: 'Altra identità attiva',
    });

    expect(finalize).toHaveBeenCalledWith('user-a');
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).not.toBeNull();
  });

  it('reports complete only after the shared local finalizer confirms completion', async () => {
    const { recoverDeletedAccountOnThisDevice, removeDeletionRecoveryCredential } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
    ]));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ uid: 'user-a', status: 'complete' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const finalize = vi.fn(async (uid: string) => {
      removeDeletionRecoveryCredential(uid);
      return { status: 'complete' as const };
    });

    await expect(recoverDeletedAccountOnThisDevice(finalize)).resolves.toEqual({ status: 'complete' });

    expect(finalize).toHaveBeenCalledWith('user-a');
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).toBeNull();
  });

  it('keeps unknown or expired recovery credentials silent on HTTP 404', async () => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
    ]));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const finalize = vi.fn();

    await expect(recoverDeletedAccountOnThisDevice(finalize)).resolves.toEqual({ status: 'none' });

    expect(finalize).not.toHaveBeenCalled();
  });

  it('does not hide backend recovery outages behind a successful none result', async () => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
    ]));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));

    await expect(recoverDeletedAccountOnThisDevice(vi.fn())).rejects.toThrow('HTTP 503');
  });

  it('distinguishes verified remote deletion from routine background verification failure', async () => {
    const { recoverDeletedAccountOnThisDevice, DeletionRecoveryFinalizationError } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
    ]));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ uid: 'user-a', status: 'complete' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    const finalizeError = new Error('Pulizia locale incompleta');

    let failure: unknown;
    try {
      await recoverDeletedAccountOnThisDevice(vi.fn(async () => { throw finalizeError; }));
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(DeletionRecoveryFinalizationError);
    expect(failure).toMatchObject({
      code: 'account-deletion-device-finalization-failed',
      message: 'Pulizia locale incompleta',
      cause: finalizeError,
    });
  });

  it('retains the HTTP status when device registration is rejected', async () => {
    const { registerDeletionRecoveryDevice } = await loadSubject();
    const current = user();
    firebase.auth.currentUser = current;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));

    await expect(registerDeletionRecoveryDevice(current)).rejects.toThrow('HTTP 503');
  });

  it('keeps limited-use App Check details out of the recovery message shown by callers', async () => {
    const { registerDeletionRecoveryDevice } = await loadSubject();
    const current = user();
    firebase.auth.currentUser = current;
    appCheck.getLimitedUseAppCheckToken.mockRejectedValueOnce(
      Object.assign(new Error('technical provider detail'), { code: 'app-check-limited-use-unavailable' }),
    );

    await expect(registerDeletionRecoveryDevice(current)).rejects.toThrow(
      'Verifica di sicurezza temporaneamente non disponibile.',
    );
  });
});
