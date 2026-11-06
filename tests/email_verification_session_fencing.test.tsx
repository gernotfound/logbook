import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { auth, onAuthStateChanged, reload, sendEmailVerification, signInWithPopup, signInWithRedirect, signInWithEmailAndPassword, createUserWithEmailAndPassword } from '../src/lib/firebase';
import { DB } from '../src/lib/db';
import { draftRegistry } from '../src/lib/utils/draftRegistry';
import { idbStore } from './setup';
import { useAppStore } from '../src/store/useAppStore';

const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;
const user = (uid: string) => ({
  uid, email: uid + '@example.test', emailVerified: false,
  providerData: [{ providerId: 'password' }],
  getIdToken: vi.fn(async () => 'synthetic-token'),
}) as unknown as User & { getIdToken: ReturnType<typeof vi.fn> };

async function start() {
  const first = user('verification-a');
  let notify!: (next: User | null) => Promise<void>;
  (auth as { currentUser: unknown }).currentUser = first;
  vi.mocked(onAuthStateChanged).mockImplementationOnce((_auth, callback) => {
    notify = callback as (next: User | null) => Promise<void>;
    void notify(first);
    return () => {};
  });
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.emailVerificationRequired).toBe(true));
  // The opaque archive is never opened by an unverified account.
  const preserved = { syntheticCiphertext: 'preserve-original-bytes' };
  idbStore['logbook:v2:user:verification-a'] = preserved;
  const transition = async (kind: 'other-account' | 'signed-out' | 'A-B-A') => {
    await act(async () => {
      const next = kind === 'signed-out' ? null : user('verification-b');
      (auth as { currentUser: unknown }).currentUser = next;
      await notify(next);
      if (kind === 'A-B-A') {
        const returned = user(first.uid);
        (auth as { currentUser: unknown }).currentUser = returned;
        await notify(returned);
      }
    });
  };
  return { ...hook, first, transition, preserved };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAppStore.getState().resetStore({ force: true });
});

describe('email verification actions across actual AuthProvider callbacks (SDK simulated)', () => {
  it.each(['other-account', 'signed-out', 'A-B-A'] as const)(
    'does not publish an old unverified result after %s', async kind => {
      const { result, transition, preserved } = await start();
      let finish!: () => void;
      vi.mocked(reload).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
      let pending!: Promise<void>;
      act(() => { pending = result.current.refreshEmailVerification(); });
      expect(reload).toHaveBeenCalledOnce();
      await transition(kind);
      await act(async () => { finish(); await pending; });
      expect(useAppStore.getState().saveError).toBeNull();
      expect(idbStore['logbook:v2:user:verification-a']).toBe(preserved);
      expect(DB.loadCloudPayload).not.toHaveBeenCalled();
      expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
    },
  );

  it.each(['reload', 'token'] as const)(
    'does not enter the reload barrier after A-B-A during %s', async boundary => {
      const { result, first, transition, preserved } = await start();
      let finish!: () => void;
      const gate = new Promise<void>(resolve => { finish = resolve; });
      vi.mocked(reload).mockImplementationOnce(async () => {
        if (boundary === 'reload') await gate;
        Object.assign(first, { emailVerified: true });
      });
      if (boundary === 'token') first.getIdToken.mockImplementationOnce(async () => { await gate; return 'old-token'; });
      const flush = vi.spyOn(draftRegistry, 'flushAll');
      try {
        let pending!: Promise<void>;
        act(() => { pending = result.current.refreshEmailVerification(); });
        await waitFor(() => expect(boundary === 'reload' ? reload : first.getIdToken).toHaveBeenCalledOnce());
        await transition('A-B-A');
        await act(async () => { finish(); await pending; });
        expect(flush).not.toHaveBeenCalled();
        if (boundary === 'reload') expect(first.getIdToken).not.toHaveBeenCalled();
        expect(idbStore['logbook:v2:user:verification-a']).toBe(preserved);
        expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
      } finally { flush.mockRestore(); }
    },
  );

  it.each(['success', 'failure'] as const)(
    'does not expose a stale verification-mail %s to the next account', async outcome => {
      const { result, transition, preserved } = await start();
      let finish!: () => void;
      vi.mocked(sendEmailVerification).mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
        finish = () => outcome === 'success' ? resolve() : reject(new Error('old provider error'));
      }));
      let pending!: Promise<void>;
      act(() => { pending = result.current.resendEmailVerification(); });
      expect(sendEmailVerification).toHaveBeenCalledOnce();
      await transition('A-B-A');
      await act(async () => { finish(); await pending; });
      expect(useAppStore.getState().saveError).toBeNull();
      expect(idbStore['logbook:v2:user:verification-a']).toBe(preserved);
    },
  );
});

describe('login failures cannot restart or overwrite a later Auth session', () => {
  it.each(['login', 'linkGoogleAccount', 'loginWithEmail', 'registerWithEmail'] as const)(
    'ignores an obsolete %s failure after A-B-A', async action => {
      const { result, transition, preserved } = await start();
      const sdk = action === 'login' || action === 'linkGoogleAccount' ? signInWithPopup
        : action === 'loginWithEmail' ? signInWithEmailAndPassword : createUserWithEmailAndPassword;
      let fail!: (error: unknown) => void;
      vi.mocked(sdk).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
      let pending!: Promise<void>;
      act(() => {
        pending = action === 'loginWithEmail' || action === 'registerWithEmail'
          ? result.current[action]('a@example.test', 'SyntheticPassword123!')
          : result.current[action]();
      });
      await waitFor(() => expect(sdk).toHaveBeenCalledOnce());
      await transition('A-B-A');
      await act(async () => { fail(Object.assign(new Error('obsolete provider failure'), { code: 'auth/popup-blocked' })); await pending; });
      expect(signInWithRedirect).not.toHaveBeenCalled();
      expect(useAppStore.getState().saveError).toBeNull();
      expect(idbStore['logbook:v2:user:verification-a']).toBe(preserved);
      expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
    },
  );

  it('still permits a popup-to-redirect fallback from an unauthenticated login screen', async () => {
    (auth as { currentUser: unknown }).currentUser = null;
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(signInWithPopup).mockRejectedValueOnce(Object.assign(new Error('blocked popup'), { code: 'auth/popup-blocked' }));
    await act(async () => { await result.current.login(); });
    expect(signInWithRedirect).toHaveBeenCalledOnce();
    expect(useAppStore.getState().saveError).toBeNull();
  });
});
