import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestOnlyAuthProvider } from '../../../src/contexts/GuestOnlyAuthProvider';
import { useAuth } from '../../../src/hooks/useAuth';
import { useAppStore } from '../../../src/store/useAppStore';
import { useDialogStore } from '../../../src/store/useDialogStore';
import { isVaultUnlocked, readVaultControl } from '../../../src/lib/sync/secureArchiveSession';
import { purgeGuestLocalData } from '../../../src/lib/db/guestLocalPurge';
import { auth, onAuthStateChanged } from '../../../src/lib/firebase';

vi.mock('../../../src/lib/db/guestLocalPurge', () => ({ purgeGuestLocalData: vi.fn(async () => {}) }));
import { releaseLegacyTestIdentityReader } from '../../setup';
import { authenticatedIdentitySource } from '../../../src/lib/sync/authenticatedIdentitySource';
import { activateGuestSession, captureSession, GUEST_REVOCATION_KEY, GUEST_SESSION_KEY, isActiveGuestSession, storageOwner } from '../../../src/lib/sync/session';

function restoreGuest(id: string) {
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, id);
    localStorage.removeItem(GUEST_REVOCATION_KEY);
    activateGuestSession(id);
}

const wrapper = ({ children }: { children: React.ReactNode }) =>
    <GuestOnlyAuthProvider>{children}</GuestOnlyAuthProvider>;

describe('Kinde-first guest provider: no legacy account activation', () => {
    beforeEach(() => {
        releaseLegacyTestIdentityReader();
        localStorage.clear();
        useAppStore.getState().resetStore({ force: true });
        vi.clearAllMocks();
    });
    afterEach(() => vi.restoreAllMocks());

    it('rejects a persisted guest flag without a matching active generation', () => {
        localStorage.setItem('logbook_is_guest', 'true');
        const { result } = renderHook(() => useAuth(), { wrapper });
        expect(result.current.isGuest).toBe(false);
        expect(isActiveGuestSession()).toBe(false);
        expect(result.current.currentUser).toBeNull();
        expect(onAuthStateChanged).not.toHaveBeenCalled();
    });

    it('activates an actual guest vault under the public provider without installing an account owner', async () => {
        const { result } = renderHook(() => useAuth(), { wrapper });
        await act(async () => { await result.current.loginAsGuest(); });
        await waitFor(() => expect(result.current.isGuest).toBe(true));

        expect(isActiveGuestSession()).toBe(true);
        expect(storageOwner()).toBe('guest');
        expect(isVaultUnlocked('guest')).toBe(true);
        expect(readVaultControl('guest')).not.toBeNull();
        expect(useAppStore.getState().dataOwner).toBe('guest');
        expect(useAppStore.getState().userData).not.toBeNull();
        expect(result.current.currentUser).toBeNull();
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
        expect(onAuthStateChanged).not.toHaveBeenCalled();
    });

    it('shows no authenticated fitness user and never subscribes to Firebase Auth', () => {
        const { result } = renderHook(() => useAuth(), { wrapper });
        expect(result.current.currentUser).toBeNull();
        expect(result.current.isGuest).toBe(false);
        expect(result.current.loading).toBe(false);
        expect(onAuthStateChanged).not.toHaveBeenCalled();
    });

    it('does not adopt a persisted Firebase user as the owner of a Kinde-first session', () => {
        const previousUser = auth.currentUser;
        (auth as { currentUser: unknown }).currentUser = { uid: 'retired-firebase-uid' };
        try {
            const { result } = renderHook(() => useAuth(), { wrapper });
            expect(result.current.currentUser).toBeNull();
            expect(authenticatedIdentitySource.readUid()).toBeNull();
            localStorage.setItem('logbook_authenticated_owner', 'user:retired-firebase-uid');
            expect(storageOwner()).toBe('guest');
            expect(localStorage.getItem('logbook_authenticated_owner')).toBe('user:retired-firebase-uid');
            expect(captureSession().owner).toBe('guest');
            expect(onAuthStateChanged).not.toHaveBeenCalled();
        } finally {
            (auth as { currentUser: unknown }).currentUser = previousUser;
        }
    });

    it('does not treat a corrupt historical owner hint as safe guest absence', () => {
        renderHook(() => useAuth(), { wrapper });
        localStorage.setItem('logbook_authenticated_owner', 'user:invalid/owner');
        expect(() => storageOwner()).toThrow('Owner autenticato locale non valido');
        expect(localStorage.getItem('logbook_authenticated_owner')).toBe('user:invalid/owner');
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
    });

    it('rejects legacy sign-in and registration rather than silently treating them as Kinde credentials', async () => {
        const { result } = renderHook(() => useAuth(), { wrapper });
        await expect(result.current.loginWithEmail('tester@example.invalid', 'not-a-password'))
            .rejects.toThrow('Kinde');
        await expect(result.current.registerWithEmail('tester@example.invalid', 'not-a-password'))
            .rejects.toThrow('Kinde');
        await expect(result.current.retryGuestMigration()).rejects.toThrow('Kinde');
        await expect(result.current.login()).rejects.toThrow('Kinde');
        await expect(result.current.linkGoogleAccount()).rejects.toThrow('Kinde');
        await expect(result.current.resendEmailVerification()).rejects.toThrow('Kinde');
        await expect(result.current.refreshEmailVerification()).rejects.toThrow('Kinde');
        await expect(result.current.continueUnverifiedLocally()).rejects.toThrow('Kinde');
        expect(result.current.currentUser).toBeNull();
        expect(result.current.isGuest).toBe(false);
        expect(onAuthStateChanged).not.toHaveBeenCalled();
    });

    it('restores only the exact active guest generation and fences cross-tab revocation', () => {
        restoreGuest('guest-kinde-first-a');
        const { result } = renderHook(() => useAuth(), { wrapper });
        expect(result.current.isGuest).toBe(true);
        localStorage.setItem(GUEST_REVOCATION_KEY, 'other-tab-revoked');
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: GUEST_REVOCATION_KEY }));
        });
        expect(result.current.isGuest).toBe(false);
        expect(result.current.currentUser).toBeNull();
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).toBe('other-tab-revoked');
        expect(onAuthStateChanged).not.toHaveBeenCalled();
    });

    it('rechecks a replaced guest generation on focus without deleting the new session', () => {
        restoreGuest('old-focus-generation');
        const purge = vi.mocked(purgeGuestLocalData);
        const { result } = renderHook(() => useAuth(), { wrapper });
        expect(result.current.isGuest).toBe(true);

        localStorage.setItem(GUEST_SESSION_KEY, 'fresh-remote-generation');
        act(() => { window.dispatchEvent(new Event('focus')); });

        expect(result.current.isGuest).toBe(false);
        expect(result.current.currentUser).toBeNull();
        expect(purge).not.toHaveBeenCalled();
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBe('fresh-remote-generation');
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).toBeNull();
        expect(onAuthStateChanged).not.toHaveBeenCalled();
    });

    it('preserves a guest session when the logout confirmation is declined', async () => {
        restoreGuest('declined-logout-generation');
        const showConfirm = vi.mocked(useDialogStore.getState().showConfirm);
        showConfirm.mockResolvedValueOnce(false);
        const purge = vi.mocked(purgeGuestLocalData);
        const { result } = renderHook(() => useAuth(), { wrapper });

        await act(async () => { await result.current.logout({ mode: 'normal' }); });
        expect(showConfirm).toHaveBeenCalledOnce();
        expect(result.current.isGuest).toBe(true);
        expect(isActiveGuestSession()).toBe(true);
        expect(purge).not.toHaveBeenCalled();
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBe('declined-logout-generation');
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).toBeNull();
    });

    it('does not activate a canceled Kinde-scoped guest action', async () => {
        const { result } = renderHook(() => useAuth(), { wrapper });
        await act(async () => { await result.current.loginAsGuest(() => false); });
        expect(result.current.isGuest).toBe(false);
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
    });

    it('revokes before purging a confirmed local guest and never signs out Firebase', async () => {
        restoreGuest('guest-kinde-first-logout');
        const purge = vi.mocked(purgeGuestLocalData);
        const purgeObservations: Array<{ revoked: string | null; active: boolean; guestFlag: string | null }> = [];
        purge.mockImplementationOnce(async () => {
            purgeObservations.push({
                revoked: localStorage.getItem(GUEST_REVOCATION_KEY),
                active: isActiveGuestSession(),
                guestFlag: localStorage.getItem('logbook_is_guest'),
            });
        });
        const { result } = renderHook(() => useAuth(), { wrapper });
        expect(result.current.isGuest).toBe(true);
        await act(async () => { await result.current.logout({ mode: 'normal', skipConfirm: true }); });
        expect(purgeObservations).toEqual([{
            revoked: expect.any(String),
            active: false,
            guestFlag: 'true',
        }]);
        expect(result.current.isGuest).toBe(false);
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).not.toBeNull();
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(purge).toHaveBeenCalledOnce();
        expect(purge).toHaveBeenCalledWith();
        expect(onAuthStateChanged).not.toHaveBeenCalled();
    });

    it('keeps the durable revocation fence and reports an incomplete physical purge', async () => {
        restoreGuest('guest-purge-failure');
        const purge = vi.mocked(purgeGuestLocalData);
        purge.mockRejectedValueOnce(new Error('simulated persistent storage failure'));
        const showAlert = vi.mocked(useDialogStore.getState().showAlert);
        const { result } = renderHook(() => useAuth(), { wrapper });

        await act(async () => { await result.current.logout({ mode: 'normal', skipConfirm: true }); });

        expect(purge).toHaveBeenCalledOnce();
        expect(showAlert).toHaveBeenCalledWith(expect.stringContaining('pulizia del dispositivo incompleta'));
        expect(result.current.isGuest).toBe(false);
        expect(isActiveGuestSession()).toBe(false);
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).not.toBeNull();
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBe('guest-purge-failure');
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        expect(useAppStore.getState().userData).toBeNull();
        expect(onAuthStateChanged).not.toHaveBeenCalled();
    });

    it('refuses guest deletion without cross-tab Web Locks instead of purging unsafely', async () => {
        restoreGuest('guest-locks-unavailable');
        const purge = vi.mocked(purgeGuestLocalData);
        const showAlert = vi.mocked(useDialogStore.getState().showAlert);
        const { result } = renderHook(() => useAuth(), { wrapper });

        vi.stubGlobal('navigator', { locks: undefined });
        try {
            await act(async () => { await result.current.logout({ mode: 'normal', skipConfirm: true }); });
        } finally {
            vi.unstubAllGlobals();
        }

        expect(purge).not.toHaveBeenCalled();
        expect(showAlert).toHaveBeenCalledWith(expect.stringContaining('Impossibile coordinare'));
        expect(result.current.isGuest).toBe(true);
        expect(isActiveGuestSession()).toBe(true);
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).toBeNull();
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBe('guest-locks-unavailable');
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        expect(onAuthStateChanged).not.toHaveBeenCalled();
    });

    it('clears stale guest memory without purging an archive replaced by another tab', async () => {
        restoreGuest('local-generation-old');
        const purge = vi.mocked(purgeGuestLocalData);
        const { result } = renderHook(() => useAuth(), { wrapper });
        expect(result.current.isGuest).toBe(true);

        localStorage.setItem(GUEST_SESSION_KEY, 'remote-generation-new');
        await act(async () => { await result.current.logout({ mode: 'normal', skipConfirm: true }); });

        expect(result.current.isGuest).toBe(false);
        expect(purge).not.toHaveBeenCalled();
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBe('remote-generation-new');
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).toBeNull();
    });

    it('does not delete a replacement guest after a stale logout confirmation', async () => {
        restoreGuest('guest-before-confirmation');
        const purge = vi.mocked(purgeGuestLocalData);
        const { result } = renderHook(() => useAuth(), { wrapper });
        let completeConfirmation!: (accepted: boolean) => void;
        const confirmation = new Promise<boolean>(resolve => { completeConfirmation = resolve; });
        const showConfirm = vi.mocked(useDialogStore.getState().showConfirm);
        showConfirm.mockImplementationOnce(() => confirmation);

        let logout!: Promise<void>;
        act(() => { logout = result.current.logout({ mode: 'normal' }); });
        expect(showConfirm).toHaveBeenCalledTimes(1);
        expect(showConfirm).toHaveBeenCalledWith(expect.stringContaining('modalità locale'));

        localStorage.setItem(GUEST_SESSION_KEY, 'guest-activated-in-another-tab');
        act(() => { completeConfirmation(true); });
        await act(async () => { await logout; });

        expect(purge).not.toHaveBeenCalled();
        expect(localStorage.getItem(GUEST_SESSION_KEY)).toBe('guest-activated-in-another-tab');
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).toBeNull();
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: GUEST_SESSION_KEY }));
        });
        expect(result.current.isGuest).toBe(false);
    });

    it('runs at most one physical purge when logout is requested twice concurrently', async () => {
        restoreGuest('guest-double-logout');
        const purge = vi.mocked(purgeGuestLocalData);
        let entered!: () => void;
        let release!: () => void;
        const inPurge = new Promise<void>(resolve => { entered = resolve; });
        const blocked = new Promise<void>(resolve => { release = resolve; });
        purge.mockImplementationOnce(async () => { entered(); await blocked; });
        const { result } = renderHook(() => useAuth(), { wrapper });

        let first!: Promise<void>;
        act(() => { first = result.current.logout({ mode: 'normal', skipConfirm: true }); });
        await inPurge;
        await act(async () => { await result.current.logout({ mode: 'normal', skipConfirm: true }); });
        expect(purge).toHaveBeenCalledTimes(1);

        release();
        await act(async () => { await first; });
        expect(result.current.isGuest).toBe(false);
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).not.toBeNull();
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
    });
});
