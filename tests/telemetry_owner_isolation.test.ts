import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sentryClient from '../src/lib/sentryClient';
import { auth } from '../src/lib/firebase';
import { telemetryHub, SESSION_ID_KEY, type TelemetryErrorPayload } from '../src/lib/telemetryHub';

describe('Telemetry owner isolation at the production boundary', () => {
  let previousAuthUser: typeof auth.currentUser;
  let dispatch: ReturnType<typeof vi.spyOn>;

  const changeAuth = (uid: string | null): void => {
    // The shared Firebase Auth fixture is writable just like the Auth SDK state.
    Object.assign(auth, { currentUser: uid === null ? null : ({ uid } as typeof auth.currentUser) });
  };

  beforeEach(() => {
    previousAuthUser = auth.currentUser;
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    telemetryHub.reset();
    dispatch = vi.spyOn(sentryClient, 'sendTelemetryToSentry').mockResolvedValue(true);
  });

  afterEach(() => {
    telemetryHub.reset();
    Object.assign(auth, { currentUser: previousAuthUser });
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    localStorage.clear();
    sessionStorage.clear();
  });

  it('dispatches the same fingerprint separately for consecutive authenticated owners', async () => {
    changeAuth('owner-a');
    telemetryHub.init();
    const sessionA = telemetryHub.getSessionId();
    const error = new Error('Shared fingerprint across owners');
    telemetryHub.trackError(error);
    await vi.advanceTimersByTimeAsync(10);

    changeAuth('owner-b');
    telemetryHub.trackError(error);
    await vi.advanceTimersByTimeAsync(10);
    telemetryHub.trackError(error);
    await vi.advanceTimersByTimeAsync(10);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect((dispatch.mock.calls[0][1] as TelemetryErrorPayload).userId).toBe('owner-a');
    const second = dispatch.mock.calls[1][1] as TelemetryErrorPayload;
    expect(second.userId).toBe('owner-b');
    expect(second.count).toBe(2);
    expect(telemetryHub.getSessionId()).not.toBe(sessionA);
    expect(sessionStorage.getItem(SESSION_ID_KEY)).toBe(telemetryHub.getSessionId());
  });

  it('queues an online error if the Sentry boundary returns false', async () => {
    changeAuth('owner-a');
    telemetryHub.init();
    dispatch.mockResolvedValueOnce(false);
    const queueKey = telemetryHub.getQueueStorageKey();

    telemetryHub.trackError(new Error('Temporary Sentry rejection'));
    await vi.advanceTimersByTimeAsync(0);

    expect(localStorage.getItem(queueKey)).toBeNull();
    const saved = telemetryHub.getQueuedEvents() as Array<{ payload: TelemetryErrorPayload }>;
    expect(saved).toHaveLength(1);
    expect(saved[0].payload.userId).toBe('owner-a');
    expect(saved[0].payload.message).toContain('Temporary Sentry rejection');
  });

  it('never queues a failed send into the account that replaces its original owner', async () => {
    changeAuth('owner-a');
    telemetryHub.init();
    let finish!: (accepted: boolean) => void;
    dispatch.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const queueKeyA = telemetryHub.getQueueStorageKey();

    telemetryHub.trackError(new Error('Old owner failure'));
    await vi.advanceTimersByTimeAsync(0);
    changeAuth('owner-b');
    const queueKeyB = telemetryHub.getQueueStorageKey();
    finish(false);
    await vi.advanceTimersByTimeAsync(0);

    expect(JSON.parse(localStorage.getItem(queueKeyA) || '[]')).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(queueKeyB) || '[]')).toHaveLength(0);
  });

  it('never attributes a late failed online event to another authenticated owner', async () => {
    changeAuth('owner-a');
    telemetryHub.init();
    let finish!: (accepted: boolean) => void;
    dispatch.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));

    telemetryHub.trackEvent('custom_event', { source: 'owner-a-only' });
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatch).toHaveBeenCalledTimes(1);

    changeAuth('owner-b');
    const ownerBKey = telemetryHub.getQueueStorageKey();
    finish(false);
    await vi.advanceTimersByTimeAsync(0);

    expect(localStorage.getItem(ownerBKey)).toBeNull();
    expect(telemetryHub.getQueuedEvents()).toEqual([]);
  });

  it('does not dispatch a scheduled online event after the auth owner changes', async () => {
    changeAuth('owner-a');
    telemetryHub.init();
    telemetryHub.trackEvent('custom_event', { source: 'owner-a-only' });
    changeAuth('owner-b');
    telemetryHub.getQueueStorageKey();
    await vi.advanceTimersByTimeAsync(0);

    expect(dispatch).not.toHaveBeenCalled();
    expect(telemetryHub.getQueuedEvents()).toEqual([]);
  });

  it('does not send a previous owner pending microtask after an auth switch', async () => {
    changeAuth('owner-a');
    telemetryHub.init();
    telemetryHub.trackError(new TypeError('Pending error'));
    changeAuth('owner-b');
    telemetryHub.trackError(new TypeError('Pending error'));
    await vi.advanceTimersByTimeAsync(10);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((dispatch.mock.calls[0][1] as TelemetryErrorPayload).userId).toBe('owner-b');
  });

  it('keeps offline queue and delayed count sync isolated during a rapid auth change', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    changeAuth('owner-a');
    telemetryHub.init();
    const sameError = new Error('Offline fingerprint');
    telemetryHub.trackError(sameError);
    telemetryHub.trackError(sameError);
    const keyA = telemetryHub.getQueueStorageKey();

    changeAuth('owner-b');
    telemetryHub.trackError(sameError);
    const keyB = telemetryHub.getQueueStorageKey();
    await vi.advanceTimersByTimeAsync(0);

    expect(keyA).not.toBe(keyB);
    // Before vault readiness there must be no diagnostic plaintext on disk.
    // Changing Auth invalidates the volatile old-owner cache instead of
    // attributing those reports to the new identity.
    expect(localStorage.getItem(keyA)).toBeNull();
    expect(localStorage.getItem(keyB)).toBeNull();
    const queueB = telemetryHub.getQueuedEvents() as Array<{ payload: TelemetryErrorPayload }>;
    expect(queueB).toHaveLength(1);
    expect(queueB[0].payload.userId).toBe('owner-b');
    expect(queueB[0].payload.count).toBe(1);
  });

  it('does not replace a new owner queue when an old owner flush resolves late', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    changeAuth('owner-a');
    telemetryHub.init();
    telemetryHub.trackError(new Error('Delayed owner A'));
    const keyA = telemetryHub.getQueueStorageKey();

    let finish!: (success: boolean) => void;
    dispatch.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    const inFlightA = telemetryHub.flushQueue();
    await vi.advanceTimersByTimeAsync(0);

    changeAuth('owner-b');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    telemetryHub.trackError(new Error('New owner B'));
    const keyB = telemetryHub.getQueueStorageKey();
    finish(true);
    await inFlightA;

    // An old in-flight completion cannot mutate the newly active owner's
    // volatile queue, and no plaintext crosses the owner boundary.
    expect(localStorage.getItem(keyA)).toBeNull();
    expect(localStorage.getItem(keyB)).toBeNull();
    const ownerB = telemetryHub.getQueuedEvents() as Array<{ payload: TelemetryErrorPayload }>;
    expect(ownerB).toHaveLength(1);
    expect(ownerB[0].payload.userId).toBe('owner-b');
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
