import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: null as null | { uid: string; getIdToken: ReturnType<typeof vi.fn> },
  ensureAppCheck: vi.fn(async () => {}),
  getLimitedUseAppCheckToken: vi.fn(async () => 'one-time-check'),
  captureSessionForOwner: vi.fn(() => ({ owner: 'user:a', epoch: 1 })),
  isCurrentSession: vi.fn(() => true),
}));

vi.mock('../src/lib/firebase', () => ({
  auth: { get currentUser() { return mocks.currentUser; } },
  ensureAppCheck: mocks.ensureAppCheck,
}));
vi.mock('../src/lib/appCheck', () => ({
  getLimitedUseAppCheckToken: mocks.getLimitedUseAppCheckToken,
}));
vi.mock('../src/lib/backendApi', () => ({
  trustedBackendUrl: () => 'https://backend.example/api/account-activity',
}));
vi.mock('../src/lib/sync/session', () => ({
  captureSessionForOwner: mocks.captureSessionForOwner,
  isCurrentSession: mocks.isCurrentSession,
  userOwner: (uid: string) => 'user:' + uid,
}));

const user = () => ({
  uid: 'a',
  getIdToken: vi.fn(async () => 'id-token'),
});

// Import after setting the flag: Vite may resolve import.meta.env while
// transforming a module, before per-test stubs would take effect.
async function observe(account: ReturnType<typeof user>) {
  const { watchAuthenticatedAccountActivity } = await import('../src/lib/accountActivity');
  return watchAuthenticatedAccountActivity(account as never);
}

describe('foreground activity observer (browser boundary)', () => {
  let stop: () => void = () => {};
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv('VITE_ACCOUNT_INACTIVITY_TRACKING', 'true');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    mocks.currentUser = null;
    mocks.isCurrentSession.mockReturnValue(true);
    mocks.ensureAppCheck.mockResolvedValue(undefined);
    mocks.getLimitedUseAppCheckToken.mockResolvedValue('one-time-check');
    fetchMock = vi.fn(async () => ({ status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is completely inert without explicit frontend rollout', async () => {
    vi.stubEnv('VITE_ACCOUNT_INACTIVITY_TRACKING', 'false');
    const account = user();
    mocks.currentUser = account;
    stop = await observe(account);
    window.dispatchEvent(new Event('focus'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not register background activity and resumes only when the user returns visibly', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    const account = user();
    mocks.currentUser = account;
    stop = await observe(account);
    window.dispatchEvent(new Event('focus'));
    expect(fetchMock).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('counts visible read-only sessions without exporting business data or user-controlled time', async () => {
    const account = user();
    mocks.currentUser = account;
    stop = await observe(account);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://backend.example/api/account-activity');
    expect(options).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer id-token', 'x-firebase-appcheck': 'one-time-check' },
      cache: 'no-store',
    });
    expect(options.body).toBeUndefined();
    expect(mocks.captureSessionForOwner).toHaveBeenCalledWith('user:a');
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pointerdown'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never sends an event when the owner epoch is already stale', async () => {
    const account = user();
    mocks.currentUser = account;
    mocks.isCurrentSession.mockReturnValue(false);
    stop = await observe(account);
    window.dispatchEvent(new Event('keydown'));
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(account.getIdToken).not.toHaveBeenCalled();
  });

  it('discards delayed token responses when the authenticated owner changed', async () => {
    const account = user();
    mocks.currentUser = account;
    let resolve!: (value: string) => void;
    mocks.getLimitedUseAppCheckToken.mockReturnValueOnce(new Promise<string>(r => { resolve = r; }));
    stop = await observe(account);
    await vi.waitFor(() => expect(mocks.getLimitedUseAppCheckToken).toHaveBeenCalledTimes(1));
    mocks.currentUser = user();
    resolve('token');
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries visible activity after a permanently stalled App Check preflight and rejects its late token', async () => {
    vi.useFakeTimers();
    try {
      const account = user();
      mocks.currentUser = account;
      let resolveLate!: (token: string) => void;
      mocks.getLimitedUseAppCheckToken.mockReturnValueOnce(
        new Promise<string>(resolve => { resolveLate = resolve; }),
      );
      stop = await observe(account);
      await Promise.resolve();
      await Promise.resolve();
      expect(mocks.getLimitedUseAppCheckToken).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(15_001);
      resolveLate('expired-one-use-token');
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_001);
      window.dispatchEvent(new Event('pointerdown'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a stalled HTTP report at its deadline and retries only after the retry delay', async () => {
    vi.useFakeTimers();
    try {
      const account = user();
      mocks.currentUser = account;
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementationOnce(async (_url: string, init: { signal: AbortSignal }) => {
        signal = init.signal;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
        });
      });
      stop = await observe(account);
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(signal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(15_001);
      expect(signal?.aborted).toBe(true);
      window.dispatchEvent(new Event('focus'));
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_001);
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts in-flight reports when leaving the owner and unregisters listeners', async () => {
    const account = user();
    mocks.currentUser = account;
    fetchMock.mockImplementationOnce(async (_url: string, init: { signal: AbortSignal }) => {
      expect(init.signal.aborted).toBe(false);
      return new Promise(() => {});
    });
    stop = await observe(account);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = (fetchMock.mock.calls[0][1] as { signal: AbortSignal }).signal;
    stop();
    expect(signal.aborted).toBe(true);
    window.dispatchEvent(new Event('focus'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
