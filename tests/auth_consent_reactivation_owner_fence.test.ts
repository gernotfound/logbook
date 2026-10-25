import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { auth } from '../src/lib/firebase';
import { invalidateSession } from '../src/lib/sync/session';
import { createAuthConsentLifecycleHandlers } from '../src/contexts/auth/consentLifecycle';

const registered: Array<(event: Event) => void> = [];

function start(loadData: (user: User) => Promise<void>, isBootstrapInFlight = () => false) {
  const setLoading = vi.fn();
  const setSaveError = vi.fn();
  const handlers = createAuthConsentLifecycleHandlers({
    isMounted: () => true,
    isGuestActiveStrict: () => false,
    isBootstrapInFlight,
    loadData,
    setLoading,
    setSaveError,
  });
  registered.push(handlers.handleConsentReactivated);
  return { setLoading, setSaveError, handlers };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  for (const handler of registered.splice(0)) {
    window.removeEventListener('logbook:health-consent-reactivated', handler);
  }
});

describe('consent reactivation lifecycle owner fencing', () => {
  it('does not supersede a bootstrap verification on focus', async () => {
    const loadData = vi.fn(async () => {});
    const isBootstrapInFlight = vi.fn(() => true);
    const { handlers } = start(loadData, isBootstrapInFlight);
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
});
