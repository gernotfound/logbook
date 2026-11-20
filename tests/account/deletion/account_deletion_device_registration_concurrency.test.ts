import { describe, expect, it, vi } from 'vitest';
import { deviceRegistrationMocks, loadSubject, user } from './deviceRegistrationRetryFixture';

const { firebase, appCheck } = deviceRegistrationMocks;

describe('Device recovery: session changes, ack parsing and multi-owner locking', () => {
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
    // The lazy App Check import can resolve the actual production module in
    // Vitest despite a hoisted mock. Boot the real provider against the mocked
    // Firebase App Check SDK, never treat provider failure as a test success.
    const realAppCheck = await vi.importActual<typeof import('../../../src/lib/appCheck')>('../../../src/lib/appCheck');
    const appCheckOptions = { siteKey: 'synthetic-app-check-site-key' };
    const app = {} as Parameters<typeof realAppCheck.ensureAppCheckProvider>[0];
    expect(realAppCheck.ensureAppCheckProvider(app, appCheckOptions).providerInitialized).toBe(true);
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
