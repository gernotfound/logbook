import { describe, expect, it, vi } from 'vitest';
import { deviceRegistrationMocks, loadSubject, user, setOnline } from './deviceRegistrationRetryFixture';

const { firebase, appCheck } = deviceRegistrationMocks;

describe('Device recovery: registration, connectivity and Auth epoch', () => {
  it('registers the authenticated device immediately with a limited-use App Check token', async () => {
    const { watchDeletionRecoveryDeviceRegistration } = await loadSubject();
    const current = user();
    firebase.auth.currentUser = current;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ registered: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const dispose = watchDeletionRecoveryDeviceRegistration(current);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(current.getIdToken).toHaveBeenCalledWith();
    expect(appCheck.getLimitedUseAppCheckToken).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Bearer id-token',
      'x-firebase-appcheck': 'app-check-token',
    });

    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('retries registration when a device that started offline comes back online', async () => {
    const { watchDeletionRecoveryDeviceRegistration } = await loadSubject();
    const current = user();
    firebase.auth.currentUser = current;
    setOnline(false);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ registered: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const dispose = watchDeletionRecoveryDeviceRegistration(current);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    dispose();
  });

  it('retries a failed registration when connectivity returns without losing the local credential', async () => {
    const { watchDeletionRecoveryDeviceRegistration } = await loadSubject();
    const current = user();
    firebase.auth.currentUser = current;
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary offline failure'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ registered: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onError = vi.fn();

    const dispose = watchDeletionRecoveryDeviceRegistration(current, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).not.toBeNull();

    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(onError).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('removes retry listeners when a device registration watcher is disposed', async () => {
    const { watchDeletionRecoveryDeviceRegistration } = await loadSubject();
    const current = user();
    firebase.auth.currentUser = current;
    const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const onError = vi.fn();

    const dispose = watchDeletionRecoveryDeviceRegistration(current, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    dispose();
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not register a stale user after the authenticated account changes', async () => {
    const { watchDeletionRecoveryDeviceRegistration } = await loadSubject();
    const stale = user('user-a');
    firebase.auth.currentUser = user('user-b');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ registered: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const dispose = watchDeletionRecoveryDeviceRegistration(stale);
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    dispose();
  });

  it('rejects registration from a previous Auth object even when the replacement has the same UID', async () => {
    const { registerDeletionRecoveryDevice } = await loadSubject();
    let releaseToken!: (token: string) => void;
    const token = new Promise<string>(resolve => { releaseToken = resolve; });
    const stale = user('user-a');
    stale.getIdToken = vi.fn(() => token);
    firebase.auth.currentUser = stale;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const registration = registerDeletionRecoveryDevice(stale);
    await vi.waitFor(() => expect(stale.getIdToken).toHaveBeenCalledTimes(1));
    firebase.auth.currentUser = user('user-a');
    releaseToken('old-session-token');

    await expect(registration).rejects.toMatchObject({
      operation: 'device-registration', phase: 'auth-token', kind: 'stale-session',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).not.toBeNull();
  });

  it('rejects a stale A→B→A Auth epoch even if the original user object becomes current again', async () => {
    const { registerDeletionRecoveryDevice } = await loadSubject();
    const { invalidateSession } = await import('../../../src/lib/sync/session');
    let releaseToken!: (token: string) => void;
    const token = new Promise<string>(resolve => { releaseToken = resolve; });
    const stale = user('user-a');
    stale.getIdToken = vi.fn(() => token);
    firebase.auth.currentUser = stale;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const registration = registerDeletionRecoveryDevice(stale);
    await vi.waitFor(() => expect(stale.getIdToken).toHaveBeenCalledTimes(1));
    firebase.auth.currentUser = user('user-b');
    invalidateSession();
    firebase.auth.currentUser = stale;
    invalidateSession();
    releaseToken('old-session-token');

    await expect(registration).rejects.toMatchObject({
      operation: 'device-registration', phase: 'auth-token', kind: 'stale-session',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
