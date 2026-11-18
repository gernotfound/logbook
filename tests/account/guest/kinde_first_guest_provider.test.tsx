import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestOnlyAuthProvider } from '../../../src/contexts/GuestOnlyAuthProvider';
import { useAuth } from '../../../src/hooks/useAuth';
import { useAppStore } from '../../../src/store/useAppStore';
import { purgeGuestLocalData } from '../../../src/lib/db/guestLocalPurge';
import { auth, onAuthStateChanged } from '../../../src/lib/firebase';

vi.mock('../../../src/lib/db/guestLocalPurge', () => ({ purgeGuestLocalData: vi.fn(async () => {}) }));
import { releaseLegacyTestIdentityReader } from '../../setup';
import { authenticatedIdentitySource } from '../../../src/lib/sync/authenticatedIdentitySource';
import { activateGuestSession, captureSession, GUEST_REVOCATION_KEY, GUEST_SESSION_KEY, storageOwner } from '../../../src/lib/sync/session';

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
        const { result } = renderHook(() => useAuth(), { wrapper });
        expect(result.current.isGuest).toBe(true);
        await act(async () => { await result.current.logout({ mode: 'normal', skipConfirm: true }); });
        expect(result.current.isGuest).toBe(false);
        expect(localStorage.getItem(GUEST_REVOCATION_KEY)).not.toBeNull();
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(purge).toHaveBeenCalledOnce();
        expect(purge).toHaveBeenCalledWith();
        expect(onAuthStateChanged).not.toHaveBeenCalled();
    });
});
