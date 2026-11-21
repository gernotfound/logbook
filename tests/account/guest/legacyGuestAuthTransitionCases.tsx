import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { LegacyGuestBootstrapContext } from './guest_bootstrap_lifecycle.test';
import type { UserData } from '../../../src/types';

export function registerLegacyGuestAuthTransitionCases({
    auth, onAuthStateChanged, AuthProvider, useAuth, DB, withGuestLifecycleLock,
    GUEST_REVOCATION_KEY, GUEST_SESSION_KEY, useAppStore, UserDataSchema,
    invalidateSession, useDialogStore, signOut, refreshHealthConsent,
    captureSession, readAuthenticatedOwnerHint, isCurrentSession,
    confirmRealGuestVault,
}: LegacyGuestBootstrapContext): void {
    describe('legacy guest-to-account transitions and Auth epochs', () => {
    it.each(['lock', 'purge'] as const)(
        'does not activate a queued guest after another account signs in during %s',
        async boundary => {
            let notify!: (user: any) => Promise<void>;
            vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
                notify = callback;
                void callback(null);
                return () => {};
            });
            const { result } = renderHook(() => useAuth(), {
                wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
            });
            let release!: () => void;
            let entered!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const acquired = new Promise<void>(resolve => { entered = resolve; });
            let holder: Promise<void> | undefined;
            if (boundary === 'lock') {
                holder = withGuestLifecycleLock(async () => { entered(); await gate; });
                await acquired;
            } else {
                localStorage.setItem(GUEST_REVOCATION_KEY, 'old-revoked-guest');
                vi.spyOn(DB, 'purgeAllLocalUserData').mockImplementationOnce(async () => { entered(); await gate; });
            }
            let pending!: Promise<void>;
            act(() => { pending = result.current.loginAsGuest(); });
            try {
                if (boundary === 'purge') await acquired;
                const account = { uid: 'newer-unverified-account', emailVerified: false } as any;
                await act(async () => {
                    (auth as any).currentUser = account;
                    await notify(account);
                });
                const newer = UserDataSchema.parse({ profile: { height: '182' } }) as unknown as UserData;
                useAppStore.setState({ userData: newer, dataOwner: 'user:' + account.uid });
                await act(async () => { release(); await pending; });

                expect(result.current.currentUser?.uid).toBe(account.uid);
                expect(result.current.isGuest).toBe(false);
                expect(localStorage.getItem('logbook_is_guest')).not.toBe('true');
                expect(localStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
                expect(useAppStore.getState().dataOwner).toBe('user:' + account.uid);
                expect(useAppStore.getState().userData).toBe(newer);
                if (boundary === 'lock') expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
            } finally {
                release();
                await holder;
            }
        },
    );

    it('does not activate an old guest request after null-account-null Auth callbacks', async () => {
        let notify!: (user: any) => Promise<void>;
        vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
            notify = callback;
            void callback(null);
            return () => {};
        });
        const { result } = renderHook(() => useAuth(), {
            wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
        });
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const acquired = new Promise<void>(resolve => { entered = resolve; });
        const holder = withGuestLifecycleLock(async () => { entered(); await gate; });
        await acquired;
        let pending!: Promise<void>;
        act(() => { pending = result.current.loginAsGuest(); });
        try {
            await act(async () => {
                const account = { uid: 'intermediate-account', emailVerified: false } as any;
                (auth as any).currentUser = account;
                await notify(account);
                (auth as any).currentUser = null;
                await notify(null);
                release();
                await pending;
            });
            expect(result.current.currentUser).toBeNull();
            expect(result.current.isGuest).toBe(false);
            expect(localStorage.getItem('logbook_is_guest')).toBeNull();
            expect(localStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
            expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
        } finally {
            release();
            await holder;
        }
    });

    it('does not adopt an Auth epoch that changed after guest activation but before the lock resumed', async () => {
        const { result } = renderHook(() => useAuth(), {
            wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
        });
        vi.spyOn(useDialogStore.getState(), 'cancelAll').mockImplementationOnce(() => { invalidateSession(); });
        await act(async () => { await result.current.loginAsGuest(); });

        expect(result.current.isGuest).toBe(false);
        expect(useAppStore.getState().userData).toBeNull();
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        expect(localStorage.getItem(GUEST_SESSION_KEY)).not.toBeNull();
    });

    it('signs out Firebase without deleting the guest archive while first consent is pending', async () => {
        let listener!: (user: unknown) => Promise<void>;
        vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
            listener = callback;
            void callback(null);
            return () => {};
        });
        const { result } = renderHook(() => useAuth(), {
            wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
        });
        await act(async () => { await result.current.loginAsGuest(); });
        await confirmRealGuestVault();
        await waitFor(() => expect(useAppStore.getState().userData).not.toBeNull());
        const preserved = useAppStore.getState().userData;
        const account = {
            uid: 'test-user-id', emailVerified: true, getIdToken: vi.fn(async () => 'id-token'),
        } as any;
        (auth as any).currentUser = account;
        vi.mocked(refreshHealthConsent).mockResolvedValueOnce('unregistered');
        await act(async () => { await listener(account); });
        await waitFor(() => expect(result.current.currentUser?.uid).toBe(account.uid));
        expect(result.current.isGuest).toBe(true);
        expect(captureSession().owner).toBe('guest');

        const purge = vi.spyOn(DB, 'purgeAllLocalUserData');
        vi.mocked(signOut).mockImplementationOnce(async () => {
            (auth as any).currentUser = null;
            await listener(null);
        });
        await act(async () => { await result.current.logout({ mode: 'normal' }); });

        expect(vi.mocked(signOut)).toHaveBeenCalledTimes(1);
        expect(purge).not.toHaveBeenCalled();
        expect(result.current.currentUser).toBeNull();
        expect(result.current.isGuest).toBe(true);
        expect(captureSession().owner).toBe('guest');
        expect(readAuthenticatedOwnerHint()).toBeNull();
        expect(useAppStore.getState().userData).toEqual(preserved);
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
    });

    it('does not start guest migration or discard guest data when no account identity exists', async () => {
        const { result } = renderHook(() => useAuth(), {
            wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
        });
        await act(async () => { await result.current.loginAsGuest(); });
        await confirmRealGuestVault();
        await waitFor(() => expect(useAppStore.getState().userData).not.toBeNull());
        const previous = useAppStore.getState().userData;
        const guestSession = captureSession();
        const purge = vi.spyOn(DB, 'purgeAllLocalUserData');

        await act(async () => { await result.current.retryGuestMigration('merge'); });

        expect(result.current.guestMigrationStatus).toBe('failed');
        expect(useAppStore.getState().saveError).toContain('Scegli esplicitamente');
        expect(localStorage.getItem('guest_migration_intent_v1')).toBeNull();
        expect(useAppStore.getState().userData).toEqual(previous);
        expect(isCurrentSession(guestSession)).toBe(true);
        expect(purge).not.toHaveBeenCalled();
    });

    it('does not replicate or purge when migration is retried anonymously', async () => {
        const { result } = renderHook(() => useAuth(), {
            wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
        });
        await waitFor(() => expect(result.current.loading).toBe(false));
        const purge = vi.spyOn(DB, 'purgeAllLocalUserData');
        const accountPurge = vi.spyOn(DB, 'secureLogOut');

        await act(async () => { await result.current.retryGuestMigration('merge'); });

        expect(result.current.guestMigrationStatus).toBe('failed');
        expect(useAppStore.getState().saveError).toContain('Accedi nuovamente');
        expect(useAppStore.getState().syncing).toBe(false);
        expect(purge).not.toHaveBeenCalled();
        expect(accountPurge).not.toHaveBeenCalled();
    });
    });
}
