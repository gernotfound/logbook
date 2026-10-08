import React from 'react';
import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth, initializeAuth, onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../src/lib/firebase';
import { watchDeletionRecoveryDeviceRegistration } from '../src/lib/deletionDeviceRecovery';
import { mockFirebaseAuth, renderWithProviders } from './setup';

describe('shared Firebase Auth UI fixture contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes one Firebase Auth instance and a token-capable authenticated user', async () => {
    expect(getAuth()).toBe(auth);
    expect(initializeAuth({} as never, {} as never)).toBe(auth);
    expect(mockFirebaseAuth.currentUser).toBe(auth.currentUser);
    expect(auth.currentUser?.uid).toBe('test-user-id');
    await expect(auth.currentUser!.getIdToken()).resolves.toBe('test-id-token');
  });

  it('preserves an intentional signed-out state instead of silently re-authenticating', () => {
    mockFirebaseAuth.currentUser = null;
    const observer = vi.fn();
    onAuthStateChanged(auth, observer);

    expect(observer).toHaveBeenCalledExactlyOnceWith(null);
    expect(auth.currentUser).toBeNull();
  });

  it('notifies auth observers on sign-out and honours unsubscription', async () => {
    const observer = vi.fn();
    const unsubscribe = onAuthStateChanged(auth, observer);
    expect(observer).toHaveBeenCalledExactlyOnceWith(auth.currentUser);

    await signOut(auth);
    expect(auth.currentUser).toBeNull();
    expect(observer).toHaveBeenLastCalledWith(null);
    expect(observer).toHaveBeenCalledTimes(2);

    unsubscribe();
    await signOut(auth);
    expect(observer).toHaveBeenCalledTimes(2);
  });

  it('does not trigger device-recovery HTTP calls when a UI test mounts AuthProvider', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const watcher = vi.mocked(watchDeletionRecoveryDeviceRegistration);

    renderWithProviders(<div data-testid="ui-test-child">UI</div>);
    await waitFor(() => expect(watcher).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });

    expect(watcher).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'test-user-id', getIdToken: expect.any(Function) }),
      expect.any(Function),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

});
