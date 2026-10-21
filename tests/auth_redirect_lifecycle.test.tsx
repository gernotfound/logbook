import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRedirectResult, signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { safeHardReload } from '../src/lib/sync/safeReload';
import { sessionStorageMock } from './setup';
import { useAppStore } from '../src/store/useAppStore';

vi.mock('../src/lib/sync/safeReload', () => ({
  safeHardReload: vi.fn().mockResolvedValue(undefined),
}));

const REDIRECT_KEY = 'logbook_awaiting_redirect';
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);
const popupBlocked = Object.assign(new Error('popup blocked'), { code: 'auth/popup-blocked' });
const redirectRejected = Object.assign(new Error('redirect rejected'), { code: 'auth/argument-error' });
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

describe('Google redirect lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(getRedirectResult).mockResolvedValue(null);
    vi.mocked(signInWithPopup).mockRejectedValue(popupBlocked);
    vi.mocked(signInWithRedirect).mockRejectedValue(redirectRejected);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it.each([
    ['login', (auth: ReturnType<typeof useAuth>) => auth.login()],
    ['linkGoogleAccount', (auth: ReturnType<typeof useAuth>) => auth.linkGoogleAccount()],
  ])('ripulisce il marker quando %s fallisce prima di avviare il redirect', async (_name, run) => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await run(result.current);
    });

    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(REDIRECT_KEY, 'true');
    expect(sessionStorage.getItem(REDIRECT_KEY)).toBeNull();

    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { await Promise.resolve(); });
    expect(safeHardReload).not.toHaveBeenCalled();
  });

  it.each([
    ['login', (auth: ReturnType<typeof useAuth>) => auth.login()],
    ['linkGoogleAccount', (auth: ReturnType<typeof useAuth>) => auth.linkGoogleAccount()],
  ])('never redirects when the %s popup is cancelled', async (_name, run) => {
    vi.mocked(signInWithPopup).mockRejectedValueOnce(
      Object.assign(new Error('cancelled'), { code: 'auth/popup-closed-by-user' }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await run(result.current); });
    expect(signInWithRedirect).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(REDIRECT_KEY)).toBeNull();
    expect(useAppStore.getState().saveError).toBeNull();
  });

  it.each([
    ['login', (auth: ReturnType<typeof useAuth>) => auth.login()],
    ['linkGoogleAccount', (auth: ReturnType<typeof useAuth>) => auth.linkGoogleAccount()],
  ])('retains no redirect marker after network failure in %s', async (_name, run) => {
    vi.mocked(signInWithPopup).mockRejectedValueOnce(
      Object.assign(new Error('network'), { code: 'auth/network-request-failed' }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await run(result.current); });
    expect(signInWithRedirect).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(REDIRECT_KEY)).toBeNull();
    expect(useAppStore.getState().saveError).toContain('Connessione non disponibile');
  });

  it('ignores a redirect marker written by another tab into shared localStorage', async () => {
    localStorage.setItem(REDIRECT_KEY, 'true');
    sessionStorage.removeItem(REDIRECT_KEY);
    renderHook(() => useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { await Promise.resolve(); });
    expect(safeHardReload).not.toHaveBeenCalled();
    expect(localStorage.getItem(REDIRECT_KEY)).toBe('true');
    expect(sessionStorage.getItem(REDIRECT_KEY)).toBeNull();
  });

  it('fails closed when foreground redirect marker cleanup cannot be persisted', async () => {
    renderHook(() => useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    sessionStorage.setItem(REDIRECT_KEY, 'true');
    sessionStorageMock.removeItem.mockImplementationOnce(() => {
      throw new Error('storage cleanup denied');
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(safeHardReload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(REDIRECT_KEY)).toBe('true');
    expect(useAppStore.getState().saveError).toContain('stato locale del dispositivo');
  });

  it('unsubscribes its foreground redirect listener on provider unmount', async () => {
    const { unmount } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    unmount();
    sessionStorage.setItem(REDIRECT_KEY, 'true');

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(safeHardReload).not.toHaveBeenCalled();
  });

  it('surfaces redirect resume failures instead of treating them as non-critical', async () => {
    vi.mocked(getRedirectResult).mockRejectedValueOnce(Object.assign(new Error('redirect expired'), { code: 'auth/invalid-credential' }));

    renderHook(() => useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(useAppStore.getState().saveError).toContain('Accesso Google non completato');
    expect(sessionStorage.getItem(REDIRECT_KEY)).toBeNull();
  });

  it('blocca il reload spurio anche se la pulizia storage del marker fallisce', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });

    sessionStorageMock.removeItem.mockImplementationOnce(() => {
      throw new Error('storage remove blocked');
    });

    await act(async () => {
      await result.current.login();
    });

    expect(sessionStorage.getItem(REDIRECT_KEY)).toBe('failed');

    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { await Promise.resolve(); });
    expect(safeHardReload).not.toHaveBeenCalled();
  });

  it('mantiene il veto in-memory se falliscono sia remove sia fallback write', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });

    const originalSetItem = sessionStorageMock.setItem.getMockImplementation();
    sessionStorageMock.setItem
      .mockImplementationOnce((key, value) => originalSetItem?.(key, value))
      .mockImplementationOnce(() => {
        throw new Error('storage write blocked');
      });
    sessionStorageMock.removeItem.mockImplementationOnce(() => {
      throw new Error('storage remove blocked');
    });

    await act(async () => {
      await result.current.login();
    });

    expect(sessionStorage.getItem(REDIRECT_KEY)).toBe('true');

    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { await Promise.resolve(); });
    expect(safeHardReload).not.toHaveBeenCalled();
  });
});
