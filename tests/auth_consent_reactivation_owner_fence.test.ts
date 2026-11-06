import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { auth } from '../src/lib/firebase';
import { invalidateSession } from '../src/lib/sync/session';
import { refreshHealthConsent } from '../src/lib/healthConsent';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { createAuthConsentLifecycleHandlers } from '../src/contexts/auth/consentLifecycle';

type LifecycleOptions = Partial<Pick<Parameters<typeof createAuthConsentLifecycleHandlers>[0],
  'isMounted' | 'isBootstrapInFlight'>>;

function start(loadData: (user: User) => Promise<void>, options: LifecycleOptions = {}) {
  const setLoading = vi.fn();
  const setSaveError = vi.fn();
  const handlers = createAuthConsentLifecycleHandlers({
    isMounted: () => true,
    isGuestActiveStrict: () => false,
    ...options,
    loadData,
    setLoading,
    setSaveError,
  });
  return { setLoading, setSaveError, handlers };
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await prepareUnlockedTestArchive('user:' + auth.currentUser!.uid);
});

describe('consent reactivation lifecycle owner fencing', () => {
  it.each(['withdrawn', 'error'] as const)('awaits the whole reconnect handler without hydrating after %s consent', async status => {
    let finish!: (value: typeof status) => void;
    vi.mocked(refreshHealthConsent).mockImplementationOnce(
      () => new Promise(resolve => { finish = resolve; }),
    );
    const loadData = vi.fn(async () => {});
    const { handlers } = start(loadData);
    const reconnect = handlers.handleVisibilityChange(new Event('online'));
    expect(refreshHealthConsent).toHaveBeenCalledOnce();
    expect(loadData).not.toHaveBeenCalled();

    finish(status);
    await reconnect;
    expect(loadData).not.toHaveBeenCalled();
  });

  it('does not supersede a bootstrap verification on focus', async () => {
    const loadData = vi.fn(async () => {});
    const isBootstrapInFlight = vi.fn(() => true);
    const { handlers } = start(loadData, { isBootstrapInFlight });
    await handlers.handleVisibilityChange(new Event('focus'));
    expect(isBootstrapInFlight).toHaveBeenCalledOnce();
    expect(loadData).not.toHaveBeenCalled();
  });

  it('does not change the next login loading/error state when an old hydration rejects', async () => {
    const first = auth.currentUser!;
    let rejectLoad!: (error: Error) => void;
    const loadData = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectLoad = reject; }));
    const { setLoading, setSaveError, handlers } = start(loadData);
    handlers.handleConsentReactivated(new CustomEvent('logbook:health-consent-reactivated', {
      detail: { uid: first.uid },
    }));
    expect(loadData).toHaveBeenCalledOnce();
    expect(setLoading).toHaveBeenCalledExactlyOnceWith(true);
    (auth as { currentUser: unknown }).currentUser = { ...first, uid: 'next-account' };
    invalidateSession();
    rejectLoad(new Error('old account failure'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(setSaveError).not.toHaveBeenCalled();
    expect(setLoading).toHaveBeenCalledTimes(1);
    (auth as { currentUser: unknown }).currentUser = first;
  });

  it('clears loading when the original session is still current', async () => {
    const first = auth.currentUser!;
    let finish!: () => void;
    const loadData = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { setLoading, handlers } = start(loadData);
    handlers.handleConsentReactivated(new CustomEvent('logbook:health-consent-reactivated', {
      detail: { uid: first.uid },
    }));
    expect(loadData).toHaveBeenCalledOnce();
    finish();
    await vi.waitFor(() => expect(setLoading).toHaveBeenLastCalledWith(false));
  });

  it.each(['same-uid-login', 'unmount'] as const)('ignores reactivation feedback after %s', async transition => {
    const first = auth.currentUser!;
    let mounted = true;
    let rejectLoad!: (error: Error) => void;
    const loadData = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectLoad = reject; }));
    const { setLoading, setSaveError, handlers } = start(loadData, { isMounted: () => mounted });
    handlers.handleConsentReactivated(new CustomEvent('logbook:health-consent-reactivated', {
      detail: { uid: first.uid },
    }));
    expect(loadData).toHaveBeenCalledExactlyOnceWith(first);
    expect(setLoading).toHaveBeenCalledExactlyOnceWith(true);
    if (transition === 'same-uid-login') {
      invalidateSession();
      (auth as { currentUser: unknown }).currentUser = { ...first };
    } else {
      mounted = false;
    }

    rejectLoad(new Error('stale hydration failure'));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(setSaveError).not.toHaveBeenCalled();
    expect(setLoading).toHaveBeenCalledTimes(1);
  });

});
