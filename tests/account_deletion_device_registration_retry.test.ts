import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => ({
  auth: { currentUser: null as any },
  ensureAppCheck: vi.fn(async () => undefined),
}));
const appCheck = vi.hoisted(() => ({
  getLimitedUseAppCheckToken: vi.fn(async () => 'app-check-token'),
}));

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

function user(uid = 'user-a') {
  return {
    uid,
    getIdToken: vi.fn(async () => 'id-token'),
  } as any;
}

async function loadSubject() {
  vi.resetModules();
  // The shared UI harness suppresses incidental registration; this dedicated
  // suite must exercise the real device-recovery code instead.
  vi.doUnmock('../src/lib/deletionDeviceRecovery');
  vi.doMock('../src/lib/firebase', () => firebase);
  vi.doMock('../src/lib/appCheck', () => appCheck);
  return import('../src/lib/deletionDeviceRecovery');
}

describe('account deletion recovery device registration retries', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    firebase.auth.currentUser = null;
    firebase.ensureAppCheck.mockClear();
    appCheck.getLimitedUseAppCheckToken.mockClear();
    setOnline(true);
  });

  afterEach(() => {
    firebase.auth.currentUser = null;
    vi.unstubAllGlobals();
    vi.doUnmock('../src/lib/firebase');
    vi.doUnmock('../src/lib/appCheck');
  });

  it('registers the authenticated device immediately with a limited-use App Check token', async () => {
    const { watchDeletionRecoveryDeviceRegistration } = await loadSubject();
    const current = user();
    firebase.auth.currentUser = current;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }));
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
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
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
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
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
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const dispose = watchDeletionRecoveryDeviceRegistration(stale);
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    dispose();
  });

  it('routes a completed device proof through the caller finalizer even while another account is authenticated', async () => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
    ]));
    firebase.auth.currentUser = user('user-b');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'complete' }), {
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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'complete' }), {
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'complete' }), {
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

  it('bounds an unresolved ID token and releases the registration watcher for retry', async () => {
    vi.useFakeTimers();
    try {
      const { watchDeletionRecoveryDeviceRegistration } = await loadSubject();
      const current = user();
      firebase.auth.currentUser = current;
      let release!: (token: string) => void;
      current.getIdToken.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve; }));
      const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
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
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'complete' }), {
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'complete' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    const finalize = vi.fn(async (uid: string) => {
      if (uid === 'user-a') throw new Error('A: IndexedDB unavailable');
      return { status: 'complete' as const };
    });

    await expect(recoverDeletedAccountOnThisDevice(finalize)).rejects.toBeInstanceOf(DeletionRecoveryFinalizationError);
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(finalize).toHaveBeenCalledWith('user-b');
  });

});
