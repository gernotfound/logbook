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

  it('rejects a completed device proof for another UID without clearing the credential', async () => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    const raw = JSON.stringify([{ uid: 'user-a', token: 'A'.repeat(43) }]);
    localStorage.setItem('logbook_deletion_recovery_devices_v1', raw);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      uid: 'user-b', status: 'complete',
    }), { status: 200 })));
    const finalize = vi.fn();

    await expect(recoverDeletedAccountOnThisDevice(finalize)).rejects.toMatchObject({
      operation: 'routine-check', phase: 'server-status', kind: 'invalid-response',
    });
    expect(finalize).not.toHaveBeenCalled();
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).toBe(raw);
  });

  it('rejects corrupt proof JSON and preserves credentials instead of treating it as no deletion', async () => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
    ]));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })));

    await expect(recoverDeletedAccountOnThisDevice(vi.fn())).rejects.toMatchObject({
      phase: 'response-body',
      kind: 'invalid-response',
    });
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).not.toBeNull();
  });

  it('rejects malformed local credentials without probing the server', async () => {
    const { recoverDeletedAccountOnThisDevice, DeletionRecoveryCredentialCorruptError } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'invalid' },
    ]));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(recoverDeletedAccountOnThisDevice(vi.fn())).rejects.toBeInstanceOf(DeletionRecoveryCredentialCorruptError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not submit device registration after Auth changes while App Check is resolving', async () => {
    const { registerDeletionRecoveryDevice } = await loadSubject();
    const original = user('user-a');
    firebase.auth.currentUser = original;
    let release!: (value: string) => void;
    appCheck.getLimitedUseAppCheckToken.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const operation = registerDeletionRecoveryDevice(original);
    await vi.waitFor(() => expect(appCheck.getLimitedUseAppCheckToken).toHaveBeenCalled());
    firebase.auth.currentUser = user('user-b');
    release('late-appcheck');
    await expect(operation).rejects.toMatchObject({ kind: 'stale-session' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).not.toBeNull();
  });

  it('preserves a proof after a body-read deadline expires and reports the phase', async () => {
    vi.useFakeTimers();
    try {
      const { recoverDeletedAccountOnThisDevice } = await loadSubject();
      localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
        { uid: 'user-a', token: 'A'.repeat(43) },
      ]));
      const readBody = vi.fn(() => new Promise<unknown>(() => {}));
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true, status: 200, json: readBody,
      } as unknown as Response)));
      const finalize = vi.fn();

      const operation = recoverDeletedAccountOnThisDevice(finalize);
      // Attach the rejection observer before fake timers reach the deadline.
      // Otherwise Vitest can observe a transient unhandled rejection.
      const observedFailure = operation.then(() => ({ unexpectedSuccess: true }), error => error);
      await vi.waitFor(() => expect(readBody).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(7_500);
      expect(await observedFailure).toMatchObject({ phase: 'response-body', kind: 'timeout' });
      expect(finalize).not.toHaveBeenCalled();
      expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a failed remote deletion despite completing an independent device', async () => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
      { uid: 'user-b', token: 'B'.repeat(43) },
    ]));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ uid: 'user-a', status: 'failed' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ uid: 'user-b', status: 'complete' }), { status: 200 })));
    const finalize = vi.fn(async () => ({ status: 'complete' as const }));

    await expect(recoverDeletedAccountOnThisDevice(finalize)).rejects.toMatchObject({ kind: 'remote-failed' });
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith('user-b');
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).not.toBeNull();
  });

  it('does not let an earlier transient failure mask a later failed deletion', async () => {
    const { recoverDeletedAccountOnThisDevice } = await loadSubject();
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
      { uid: 'user-a', token: 'A'.repeat(43) },
      { uid: 'user-b', token: 'B'.repeat(43) },
      { uid: 'user-c', token: 'C'.repeat(43) },
    ]));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ uid: 'user-b', status: 'failed' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ uid: 'user-c', status: 'complete' }), { status: 200 })));
    const finalize = vi.fn(async () => ({ status: 'complete' as const }));

    await expect(recoverDeletedAccountOnThisDevice(finalize)).rejects.toMatchObject({ kind: 'remote-failed' });
    expect(finalize).toHaveBeenCalledWith('user-c');
  });

  it('does not mark registration successful when HTTP 200 lacks the backend acknowledgement', async () => {
    const { watchDeletionRecoveryDeviceRegistration } = await loadSubject();
    const current = user();
    firebase.auth.currentUser = current;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ registered: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onError = vi.fn();
    const onSuccess = vi.fn();

    const dispose = watchDeletionRecoveryDeviceRegistration(current, onError, onSuccess);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'device-registration', phase: 'server-status', kind: 'invalid-response',
    }));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).not.toBeNull();

    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('bounds registration acknowledgement body parsing without discarding device credentials', async () => {
    vi.useFakeTimers();
    try {
      const { registerDeletionRecoveryDevice } = await loadSubject();
      const current = user();
      firebase.auth.currentUser = current;
      const readBody = vi.fn(() => new Promise<unknown>(() => {}));
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true, status: 200, json: readBody,
      } as unknown as Response)));

      const operation = registerDeletionRecoveryDevice(current);
      const failure = operation.then(() => ({ unexpectedSuccess: true }), error => error);
      await vi.waitFor(() => expect(readBody).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(7_500);
      expect(await failure).toMatchObject({ operation: 'device-registration', phase: 'response-body', kind: 'timeout' });
      expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a fifth account without evicting any existing recovery proof', async () => {
    const { registerDeletionRecoveryDevice, DeletionRecoveryCredentialCapacityError } = await loadSubject();
    const existing = Array.from({ length: 4 }, (_, index) => ({
      uid: 'past-owner-' + index, token: 'A'.repeat(43),
    }));
    const serialized = JSON.stringify(existing);
    localStorage.setItem('logbook_deletion_recovery_devices_v1', serialized);
    const current = user('new-owner');
    firebase.auth.currentUser = current;
    const network = vi.fn();
    vi.stubGlobal('fetch', network);

    await expect(registerDeletionRecoveryDevice(current)).rejects.toBeInstanceOf(DeletionRecoveryCredentialCapacityError);
    expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).toBe(serialized);
    expect(network).not.toHaveBeenCalled();
  });

  it('preserves every unrelated legacy recovery proof when removing one from an over-capacity registry', async () => {
    const { removeDeletionRecoveryCredential } = await loadSubject();
    const existing = Array.from({ length: 5 }, (_, index) => ({
      uid: 'past-owner-' + index, token: 'B'.repeat(43),
    }));
    localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify(existing));
    removeDeletionRecoveryCredential('past-owner-4');

    expect(JSON.parse(localStorage.getItem('logbook_deletion_recovery_devices_v1')!))
      .toEqual(existing.slice(0, 4));
  });

  it('retains all four account proofs across login switches and repeated registration', async () => {
    const { registerDeletionRecoveryDevice } = await loadSubject();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ registered: true }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    const original = new Map<string, string>();
    for (const id of ['a', 'b', 'c', 'd']) {
      const current = user(id);
      firebase.auth.currentUser = current;
      await registerDeletionRecoveryDevice(current);
      const credentials = JSON.parse(localStorage.getItem('logbook_deletion_recovery_devices_v1')!);
      const proof = credentials.find((entry: { uid: string }) => entry.uid === id);
      expect(proof).toBeDefined();
      original.set(id, proof.token);
    }
    // Reentering a known identity must reuse its proof even at capacity.
    const again = user('b');
    firebase.auth.currentUser = again;
    await Promise.all([registerDeletionRecoveryDevice(again), registerDeletionRecoveryDevice(again)]);
    const credentials = JSON.parse(localStorage.getItem('logbook_deletion_recovery_devices_v1')!);
    expect(credentials).toHaveLength(4);
    expect(new Set(credentials.map((entry: { uid: string }) => entry.uid)).size).toBe(4);
    for (const entry of credentials) expect(entry.token).toBe(original.get(entry.uid));
    expect(request).toHaveBeenCalledTimes(6);
    for (const [, init] of request.mock.calls) {
      const { deviceToken } = JSON.parse(String(init?.body)) as { deviceToken: string };
      expect([...original.values()]).toContain(deviceToken);
    }
  });

  it('coordinates separate module queues using an exclusive browser lock', async () => {
    const first = await loadSubject();
    const second = await loadSubject();
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
    let releaseFirst!: () => void;
    const blocked = new Promise<void>(resolve => { releaseFirst = resolve; });
    let lastUnlock: () => void = () => {};
    let tail = Promise.resolve();
    let active = false;
    let index = 0;
    const lockRequest = vi.fn(async (_name: string, _options: unknown, action: () => unknown) => {
      const predecessor = tail;
      tail = new Promise<void>(resolve => { lastUnlock = resolve; });
      const unlock = lastUnlock;
      const ordinal = ++index;
      await predecessor;
      if (ordinal === 1) await blocked;
      expect(active).toBe(false);
      active = true;
      try { return await action(); } finally { active = false; unlock(); }
    });
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: lockRequest } });
    const network = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ registered: true }), { status: 200 }));
    vi.stubGlobal('fetch', network);
    const current = user('lock-owner');
    firebase.auth.currentUser = current;
    try {
      const a = first.registerDeletionRecoveryDevice(current);
      await vi.waitFor(() => expect(lockRequest).toHaveBeenCalledTimes(1));
      const b = second.registerDeletionRecoveryDevice(current);
      await vi.waitFor(() => expect(lockRequest).toHaveBeenCalledTimes(2));
      expect(localStorage.getItem('logbook_deletion_recovery_devices_v1')).toBeNull();
      releaseFirst();
      await Promise.all([a, b]);
      expect(lockRequest.mock.calls.map(call => call[1])).toEqual([{ mode: 'exclusive' }, { mode: 'exclusive' }]);
      const credentials = JSON.parse(localStorage.getItem('logbook_deletion_recovery_devices_v1')!);
      expect(credentials).toHaveLength(1);
      expect(network).toHaveBeenCalledTimes(2);
      for (const [, init] of network.mock.calls) {
        const { deviceToken } = JSON.parse(String(init?.body)) as { deviceToken: string };
        expect(deviceToken).toBe(credentials[0].token);
      }
    } finally {
      releaseFirst();
      if (descriptor) Object.defineProperty(navigator, 'locks', descriptor);
      else Reflect.deleteProperty(navigator, 'locks');
    }
  });
});
