import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sentryClient from '../src/lib/sentryClient';
import { auth } from '../src/lib/firebase';
import { telemetryHub, SESSION_ID_KEY, type TelemetryErrorPayload } from '../src/lib/telemetryHub';

describe('Telemetry owner isolation at the production boundary', () => {
  let previousAuthUser: typeof auth.currentUser;
  let dispatch: ReturnType<typeof vi.spyOn>;

  const changeAuth = (uid: string | null): void => {
    // The shared Firebase Auth fixture is writable just like the Auth SDK state.
    auth.currentUser = uid === null ? null : ({ uid } as typeof auth.currentUser);
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
    auth.currentUser = previousAuthUser;
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
    const queueA = JSON.parse(localStorage.getItem(keyA) || '[]') as Array<{ payload: TelemetryErrorPayload }>;
    const queueB = JSON.parse(localStorage.getItem(keyB) || '[]') as Array<{ payload: TelemetryErrorPayload }>;
    expect(queueA).toHaveLength(1);
    expect(queueA[0].payload.userId).toBe('owner-a');
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

    const ownerA = JSON.parse(localStorage.getItem(keyA) || '[]') as Array<{ payload: TelemetryErrorPayload }>;
    const ownerB = JSON.parse(localStorage.getItem(keyB) || '[]') as Array<{ payload: TelemetryErrorPayload }>;
    expect(ownerA).toHaveLength(1); // Retain on auth switch; a lost-ack is safer than cross-owner deletion.
    expect(ownerB).toHaveLength(1);
    expect(ownerA[0].payload.userId).toBe('owner-a');
    expect(ownerB[0].payload.userId).toBe('owner-b');
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
