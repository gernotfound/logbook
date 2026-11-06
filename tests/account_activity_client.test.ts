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

import { watchAuthenticatedAccountActivity } from '../src/lib/accountActivity';

const user = () => ({
  uid: 'a',
  getIdToken: vi.fn(async () => 'id-token'),
});

describe('foreground activity observer (browser boundary)', () => {
  let stop: () => void = () => {};
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_ACCOUNT_INACTIVITY_TRACKING', 'true');
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
  });

  it('is completely inert without explicit frontend rollout', () => {
    vi.stubEnv('VITE_ACCOUNT_INACTIVITY_TRACKING', 'false');
    const account = user();
    mocks.currentUser = account;
    stop = watchAuthenticatedAccountActivity(account as never);
    window.dispatchEvent(new Event('focus'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts visible read-only sessions without exporting business data or user-controlled time', async () => {
    const account = user();
    mocks.currentUser = account;
    stop = watchAuthenticatedAccountActivity(account as never);
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
    stop = watchAuthenticatedAccountActivity(account as never);
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
    stop = watchAuthenticatedAccountActivity(account as never);
    await vi.waitFor(() => expect(mocks.getLimitedUseAppCheckToken).toHaveBeenCalledTimes(1));
    mocks.currentUser = user();
    resolve('token');
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts in-flight reports when leaving the owner and unregisters listeners', async () => {
    const account = user();
    mocks.currentUser = account;
    fetchMock.mockImplementationOnce(async (_url: string, init: { signal: AbortSignal }) => {
      expect(init.signal.aborted).toBe(false);
      return new Promise(() => {});
    });
    stop = watchAuthenticatedAccountActivity(account as never);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = (fetchMock.mock.calls[0][1] as { signal: AbortSignal }).signal;
    stop();
    expect(signal.aborted).toBe(true);
    window.dispatchEvent(new Event('focus'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
