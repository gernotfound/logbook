import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { LegacyGuestBootstrapContext } from './guest_bootstrap_lifecycle.test';

export function registerLegacyGuestPurgeRecoveryCases({
    AuthProvider, GuestTestComponent, confirmRealGuestVault, useAppStore,
    useAuth, DB, purgeRealLocalUserData, GUEST_REVOCATION_KEY,
    GUEST_SESSION_KEY, captureSession, isCurrentSession, useDialogStore,
}: LegacyGuestBootstrapContext): void {
    describe('legacy guest purge, revocation and interrupted recovery', () => {
    it('does not replay a completed guest purge after returning to the login screen', async () => {
        const { result } = renderHook(() => useAuth(), {
            wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
        });
        await act(async () => { await result.current.loginAsGuest(); });
        await confirmRealGuestVault();
        // The shared UI fixture mocks DB.purgeAllLocalUserData; exercise the
        // production purge to verify the durable retired marker after logout.
        const purge = vi.spyOn(DB, 'purgeAllLocalUserData')
            .mockImplementationOnce(owner => purgeRealLocalUserData(owner));
        await act(async () => { await result.current.logout({ mode: 'normal' }); });
        expect(purge).toHaveBeenCalledWith('guest');

        const fenceKey = 'logbook:local-purge-fence:v1:guest';
        expect(result.current.isGuest).toBe(false);
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
        expect(localStorage.getItem(fenceKey)).toBe('purge-complete:v1');

        // The storage fence still rejects direct archive access; only unsolicited
        // foreground/reconnect replay is inapplicable to a logged-out owner.
        await expect(useAppStore.getState().flushPendingSyncs()).rejects.toThrow('Pulizia archivio locale non conclusa');

        const flush = vi.spyOn(useAppStore.getState(), 'flushPendingSyncs').mockResolvedValue(undefined);
        act(() => {
            window.dispatchEvent(new Event('online'));
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(flush).not.toHaveBeenCalled();
        expect(localStorage.getItem(fenceKey)).toBe('purge-complete:v1');
    });

    it('does not retry a genuinely incomplete guest purge while logged out', () => {
        const fenceKey = 'logbook:local-purge-fence:v1:guest';
        localStorage.setItem(fenceKey, 'purge-in-progress:v1');
        const flush = vi.spyOn(useAppStore.getState(), 'flushPendingSyncs').mockResolvedValue(undefined);

        act(() => { window.dispatchEvent(new Event('online')); });

        expect(flush).not.toHaveBeenCalled();
        expect(localStorage.getItem(fenceKey)).toBe('purge-in-progress:v1');
    });

    it('does not replay an unauthenticated former account owner on reconnect', () => {
        localStorage.setItem('logbook_authenticated_owner', 'user:former');
        const flush = vi.spyOn(useAppStore.getState(), 'flushPendingSyncs').mockResolvedValue(undefined);

        act(() => { window.dispatchEvent(new Event('online')); });

        expect(flush).not.toHaveBeenCalled();
        expect(localStorage.getItem('logbook_authenticated_owner')).toBe('user:former');
    });

    it('continues to replay a live guest session on reconnect', async () => {
        const { result } = renderHook(() => useAuth(), {
            wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
        });
        await act(async () => { await result.current.loginAsGuest(); });
        await confirmRealGuestVault();
        const flush = vi.spyOn(useAppStore.getState(), 'flushPendingSyncs').mockResolvedValue(undefined);

        act(() => { window.dispatchEvent(new Event('online')); });

        expect(flush).toHaveBeenCalledTimes(1);
    });

    it('does not treat unsupported prelaunch drafts as the new guest archive', async () => {
        const { result } = renderHook(() => useAuth(), {
            wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
        });
        await act(async () => { await result.current.loginAsGuest(); });
        await confirmRealGuestVault();
        await waitFor(() => expect(result.current.isGuest).toBe(true));
        const purge = vi.spyOn(DB, 'purgeAllLocalUserData');
        localStorage.setItem('draft_measurement', 'retired-prelaunch-format');
        await act(async () => { await result.current.logout({ mode: 'normal' }); });
        expect(purge).toHaveBeenCalled();
        expect(result.current.isGuest).toBe(false);
        expect(localStorage.getItem('draft_measurement')).toBe('retired-prelaunch-format');
    });

    it('invalidates a second guest view after cross-tab revocation', async () => {
        render(<AuthProvider><GuestTestComponent /></AuthProvider>);
        act(() => { screen.getByTestId('btn-guest').click(); });
        await confirmRealGuestVault();
        await waitFor(() => expect(screen.getByTestId('auth-mode').textContent).toBe('GUEST'));
        const stale = captureSession();
        act(() => {
            localStorage.setItem(GUEST_REVOCATION_KEY, 'remote-revocation');
            localStorage.removeItem('logbook_is_guest');
            window.dispatchEvent(new StorageEvent('storage', {
                key: GUEST_REVOCATION_KEY, newValue: 'remote-revocation',
            }));
        });
        await waitFor(() => expect(screen.getByTestId('auth-mode').textContent).toBe('ANONYMOUS'));
        expect(useAppStore.getState().userData).toBeNull();
        expect(isCurrentSession(stale)).toBe(false);
        localStorage.setItem(GUEST_SESSION_KEY, 'another-generation');
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.removeItem(GUEST_REVOCATION_KEY);
        expect(isCurrentSession(stale)).toBe(false);
    });


    it('does not purge through authenticated logout when another tab revoked the guest first', async () => {
        const { result } = renderHook(() => useAuth(), {
            wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
        });
        act(() => { void result.current.loginAsGuest(); });
        await confirmRealGuestVault();
        await waitFor(() => expect(result.current.isGuest).toBe(true));
        const authenticatedPurge = vi.spyOn(DB, 'secureLogOut');
        // A storage event may arrive after a click in another tab.
        localStorage.setItem(GUEST_REVOCATION_KEY, 'another-tab');
        await act(async () => { await result.current.logout({ mode: 'normal' }); });

        expect(authenticatedPurge).not.toHaveBeenCalled();
        expect(result.current.isGuest).toBe(false);
        expect(useAppStore.getState().userData).toBeNull();
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).toBe('another-tab');
    });


    it('revokes the guest view and reports incomplete cleanup without falling through to authenticated logout', async () => {
        const { result } = renderHook(() => useAuth(), {
            wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
        });
        await act(async () => { await result.current.loginAsGuest(); });
        await confirmRealGuestVault();
        const previousSession = captureSession();
        expect(useAppStore.getState().userData).not.toBeNull();

        const purge = vi.spyOn(DB, 'purgeAllLocalUserData')
            .mockRejectedValueOnce(new Error('device cleanup unavailable'));
        const authenticatedLogout = vi.spyOn(DB, 'secureLogOut');
        const alert = vi.spyOn(useDialogStore.getState(), 'showAlert').mockResolvedValue(undefined);

        await act(async () => { await result.current.logout({ mode: 'normal' }); });

        expect(purge).toHaveBeenCalledExactlyOnceWith('guest');
        expect(authenticatedLogout).not.toHaveBeenCalled();
        expect(result.current.isGuest).toBe(false);
        expect(useAppStore.getState().userData).toBeNull();
        expect(isCurrentSession(previousSession)).toBe(false);
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).not.toBeNull();
        expect(alert).toHaveBeenCalledWith(expect.stringContaining('pulizia del dispositivo incompleta'));
    });

    it('serializes an incomplete guest purge against a concurrent new guest login', async () => {
        const { result } = renderHook(() => useAuth(), {
            wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
        });
        act(() => { void result.current.loginAsGuest(); });
        await confirmRealGuestVault();
        await waitFor(() => expect(result.current.isGuest).toBe(true));
        const previousId = localStorage.getItem(GUEST_SESSION_KEY);
        expect(previousId).toBeTruthy();

        let releasePurge!: () => void;
        const blocked = new Promise<void>(resolve => { releasePurge = resolve; });
        const purge = vi.spyOn(DB, 'purgeAllLocalUserData')
            .mockImplementationOnce(async () => {
                await blocked;
                throw new Error('simulated IndexedDB delete failure');
            })
            .mockImplementationOnce(async () => {
                // A successful purge must also remove the real encrypted IDB
                // envelope and wrapped DEK. Clearing only localStorage would
                // strand ciphertext encrypted under a previous guest identity.
                await purgeRealLocalUserData('guest');
            });

        let logout!: Promise<void>;
        act(() => { logout = result.current.logout({ mode: 'normal' }); });
        await waitFor(() => expect(purge).toHaveBeenCalledTimes(1));
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).not.toBeNull();

        let relogin!: Promise<void>;
        act(() => { relogin = result.current.loginAsGuest(); });
        await Promise.resolve();
        // A new generation must wait for the first purge, even if that purge fails.
        expect(purge).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBe(previousId);

        act(() => { releasePurge(); });
        // The second guest login must configure a NEW vault after successful purge.
        await confirmRealGuestVault();
        await act(async () => { await Promise.all([logout, relogin]); });
        expect(purge).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).toBeNull();
        expect(localStorage.getItem(GUEST_SESSION_KEY)).not.toBe(previousId);
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        expect(result.current.isGuest).toBe(true);
        expect(useAppStore.getState().userData).not.toBeNull();
    });

    it('preserves a revoked guest archive when cleanup fails before a new session can activate', async () => {
        const { result } = renderHook(() => useAuth(), {
            wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
        });
        await act(async () => { await result.current.loginAsGuest(); });
        await confirmRealGuestVault();
        const oldSession = captureSession();
        const oldId = localStorage.getItem(GUEST_SESSION_KEY);
        const oldData = useAppStore.getState().userData;
        expect(oldId).toBeTruthy();
        expect(oldData).not.toBeNull();

        localStorage.setItem(GUEST_REVOCATION_KEY, 'revoked-in-another-tab');
        const purge = vi.spyOn(DB, 'purgeAllLocalUserData')
            .mockRejectedValueOnce(new Error('simulated IndexedDB failure'));
        await act(async () => { await result.current.loginAsGuest(); });

        expect(purge).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).toBe('revoked-in-another-tab');
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBe(oldId);
        expect(isCurrentSession(oldSession)).toBe(false);
        expect(useAppStore.getState().userData).toEqual(oldData);
        expect(useAppStore.getState().saveError).toContain('pulizia o coordinamento delle sessioni');
    });
    });
}
