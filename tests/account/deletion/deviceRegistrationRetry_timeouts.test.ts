import { describe, expect, it, vi } from 'vitest';
import { deviceRegistrationMocks, loadSubject, user } from './deviceRegistrationRetryFixture';

const { firebase, appCheck } = deviceRegistrationMocks;

describe('Device recovery: bounded deadlines and finalizer resilience', () => {
  it('bounds an unresolved ID token and releases the registration watcher for retry', async () => {
    vi.useFakeTimers();
    try {
      const { watchDeletionRecoveryDeviceRegistration } = await loadSubject();
      const current = user();
      firebase.auth.currentUser = current;
      let release!: (token: string) => void;
      current.getIdToken.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve; }));
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ registered: true }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const onError = vi.fn();

      const dispose = watchDeletionRecoveryDeviceRegistration(current, onError);
      await vi.advanceTimersByTimeAsync(7_500);
      await Promise.resolve();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();

      release('too-late-token');
      await Promise.resolve();
      expect(fetchMock).not.toHaveBeenCalled();

      window.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).not.toBeNull();
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues to a second device when the first response body never finishes', async () => {
    vi.useFakeTimers();
    try {
      const { recoverDeletedAccountOnThisDevice } = await loadSubject();
      localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
        { uid: 'user-a', token: 'A'.repeat(43) },
        { uid: 'user-b', token: 'B'.repeat(43) },
      ]));
      const stalledJson = vi.fn(() => new Promise<unknown>(() => {}));
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: stalledJson,
        })
        .mockResolvedValueOnce(new Response(JSON.stringify({ uid: 'user-b', status: 'complete' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      vi.stubGlobal('fetch', fetchMock);
      const finalize = vi.fn(async () => ({ status: 'complete' as const }));

      const operation = recoverDeletedAccountOnThisDevice(finalize);
      await vi.waitFor(() => expect(stalledJson).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(7_500);
      await expect(operation).resolves.toEqual({ status: 'complete' });
      expect(finalize).toHaveBeenCalledTimes(1);
      expect(finalize).toHaveBeenCalledWith('user-b');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not abandon another completed device when an earlier finalization fails', async () => {
    const { recoverDeletedAccountOnThisDevice, DeletionRecoveryFinalizationError } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
      { uid: 'user-b', token: 'B'.repeat(43) },
    ]));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ uid: 'user-a', status: 'complete' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ uid: 'user-b', status: 'complete' }), { status: 200 })));
    const finalize = vi.fn(async (uid: string) => {
      if (uid === 'user-a') throw new Error('A: IndexedDB unavailable');
      return { status: 'complete' as const };
    });

    await expect(recoverDeletedAccountOnThisDevice(finalize)).rejects.toBeInstanceOf(DeletionRecoveryFinalizationError);
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(finalize).toHaveBeenCalledWith('user-b');
  });

  it.each([201, 400, 401, 403, 500])('classifies HTTP %i registration failure without deleting the local proof', async status => {
    const { registerDeletionRecoveryDevice } = await loadSubject();
    const current = user();
    firebase.auth.currentUser = current;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));

    await expect(registerDeletionRecoveryDevice(current)).rejects.toMatchObject({
      operation: 'device-registration',
      phase: 'http',
      httpStatus: status,
      kind: status >= 500 ? 'server' : 'rejected',
    });
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).not.toBeNull();
  });

  it.each([400, 401, 403, 500])('classifies HTTP %i proof check without finalizing local data', async status => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
    ]));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
    const finalize = vi.fn();

    await expect(recoverDeletedAccountOnThisDevice(finalize)).rejects.toMatchObject({
      operation: 'routine-check',
      phase: 'http',
      httpStatus: status,
      kind: status >= 500 ? 'server' : 'rejected',
    });
    expect(finalize).not.toHaveBeenCalled();
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).not.toBeNull();
  });

  it('identifies limited-use App Check provider failure during the routine proof check', async () => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
    ]));
    appCheck.getLimitedUseAppCheckToken.mockRejectedValueOnce(new Error('provider private detail'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(recoverDeletedAccountOnThisDevice(vi.fn())).rejects.toMatchObject({
      operation: 'routine-check',
      phase: 'app-check',
      kind: 'provider',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('distinguishes failed deletion and invalid server status from a routine none result', async () => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
    ]));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ uid: 'user-a', status: 'failed', error: 'backend detail' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'unrecognized' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const finalize = vi.fn();

    await expect(recoverDeletedAccountOnThisDevice(finalize)).rejects.toMatchObject({
      phase: 'server-status',
      kind: 'remote-failed',
    });
    await expect(recoverDeletedAccountOnThisDevice(finalize)).rejects.toMatchObject({
      phase: 'server-status',
      kind: 'invalid-response',
    });
    expect(finalize).not.toHaveBeenCalled();
  });
});
