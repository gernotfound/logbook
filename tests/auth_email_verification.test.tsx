import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { auth, createUserWithEmailAndPassword, onAuthStateChanged, reload, sendEmailVerification, signInWithEmailAndPassword, signOut, validatePassword } from '../src/lib/firebase';
import { DB } from '../src/lib/db';
import { useAppStore } from '../src/store/useAppStore';
import { idbStore } from './setup';
import { draftRegistry } from '../src/lib/utils/draftRegistry';
import { UserDataSchema } from '../src/lib/schema';
import { useUnverifiedLocalContinuation } from '../src/contexts/auth/useUnverifiedLocalContinuation';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;

function account(verified: boolean, providerId = 'password') {
    return {
        uid: 'unverified-user',
        email: 'unverified@example.com',
        emailVerified: verified,
        providerData: [{ providerId }],
        getIdToken: vi.fn().mockResolvedValue('test-token'),
    } as any;
}

function startWith(user: ReturnType<typeof account>) {
    (auth as any).currentUser = user;
    vi.mocked(onAuthStateChanged).mockImplementationOnce((_auth, callback: any) => {
        callback(user);
        return () => {};
    });
}

describe('email verification lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.getState().resetStore({ force: true });
        (auth as any).currentUser = account(true);
    });

    it('blocks unverified password accounts before cloud hydration and preserves existing local archives', async () => {
        const user = account(false);
        const existingArchive = { privateDraft: 'preserved' };
        idbStore['logbook:v2:user:unverified-user'] = existingArchive;
        startWith(user);

        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.emailVerificationRequired).toBe(true);
        expect(result.current.currentUser?.uid).toBe(user.uid);
        expect(DB.loadCloudPayload).not.toHaveBeenCalled();
        expect(idbStore['logbook:v2:user:unverified-user']).toBe(existingArchive);
        expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
    });

    it('also blocks an unverified federated account, rather than relying on provider type', async () => {
        startWith(account(false, 'google.com'));
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.emailVerificationRequired).toBe(true);
        expect(DB.loadCloudPayload).not.toHaveBeenCalled();
    });

    it('does not refresh claims or navigate until Firebase reports the address verified', async () => {
        const user = account(false);
        startWith(user);
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));
        // Shared setup imports AuthProvider before a suite-local module mock could
        // replace safeHardReload. Observe its actual persistence barrier instead.
        const flush = vi.spyOn(draftRegistry, 'flushAll');
        try {
            let pendingResult: string | undefined;
            await act(async () => {
                pendingResult = await result.current.refreshEmailVerification();
            });
            expect(pendingResult).toBe('pending');
            expect(reload).toHaveBeenCalledTimes(3);
            expect(reload).toHaveBeenCalledWith(user);
            expect(user.getIdToken).not.toHaveBeenCalled();
            expect(flush).not.toHaveBeenCalled();

            await prepareUnlockedTestArchive('user:' + user.uid);
            vi.mocked(reload).mockImplementationOnce(async () => { user.emailVerified = true; });
            await act(async () => {
                await result.current.refreshEmailVerification();
            });
            expect(user.getIdToken).toHaveBeenCalledWith(true);
            expect(flush).toHaveBeenCalledWith({ strict: true });
            expect(user.getIdToken.mock.invocationCallOrder[0])
                .toBeLessThan(flush.mock.invocationCallOrder[0]);
        } finally {
            flush.mockRestore();
        }
    });

    it('accepts verification that becomes visible on a second Firebase refresh', async () => {
        const user = account(false);
        startWith(user);
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.emailVerificationRequired).toBe(true));

        await prepareUnlockedTestArchive('user:' + user.uid);
        vi.mocked(reload).mockImplementationOnce(async () => {})
            .mockImplementationOnce(async () => { user.emailVerified = true; });
        const flush = vi.spyOn(draftRegistry, 'flushAll');
        try {
            let outcome: string | undefined;
            await act(async () => { outcome = await result.current.refreshEmailVerification(); });
            expect(outcome).toBe('verified');
            expect(reload).toHaveBeenCalledTimes(2);
            expect(user.getIdToken).toHaveBeenCalledWith(true);
            expect(flush).toHaveBeenCalledWith({ strict: true });
            expect(DB.loadCloudPayload).not.toHaveBeenCalled();
        } finally {
            flush.mockRestore();
        }
    });

    it.each([
        ['already verified', account(true)],
        ['signed out', null],
    ])('rejects local continuation without a pending verification: %s', async (_caseName, current) => {
        (auth as any).currentUser = current;
        const loginAsGuest = vi.fn(async () => {});
        const { result } = renderHook(() => useUnverifiedLocalContinuation({
            isGuestActiveStrict: () => false,
            loginAsGuest,
        }));

        await expect(result.current()).rejects.toThrow('Nessuna verifica email in attesa.');
        expect(signOut).not.toHaveBeenCalled();
        expect(loginAsGuest).not.toHaveBeenCalled();
        expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
    });

    it('starts a separate local session without purging the authenticated archive', async () => {
        const user = account(false);
        startWith(user);
        const existingArchive = { privateDraft: 'preserved' };
        idbStore['logbook:v2:user:unverified-user'] = existingArchive;
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.emailVerificationRequired).toBe(true));

        await act(async () => {
            await result.current.continueUnverifiedLocally();
        });
        expect(signOut).toHaveBeenCalledTimes(1);
        expect(result.current.isGuest).toBe(true);
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        expect(idbStore['logbook:v2:user:unverified-user']).toBe(existingArchive);
        expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
    });

    it('never signs out if pending account edits cannot be made durable', async () => {
        const user = account(false);
        startWith(user);
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.emailVerificationRequired).toBe(true));
        useAppStore.setState({
            userData: UserDataSchema.parse({}) as any,
            dataOwner: 'user:unverified-user',
        });
        const flush = vi.spyOn(draftRegistry, 'flushAll').mockImplementationOnce(() => {
            throw new Error('device storage unavailable');
        });
        try {
            await expect(result.current.continueUnverifiedLocally()).rejects.toThrow('device storage unavailable');
            expect(signOut).not.toHaveBeenCalled();
            expect(result.current.isGuest).toBe(false);
        } finally {
            flush.mockRestore();
        }
    });

    it('does not activate local mode if Firebase sign-out fails', async () => {
        startWith(account(false));
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.emailVerificationRequired).toBe(true));
        vi.mocked(signOut).mockRejectedValueOnce(new Error('offline'));
        await expect(result.current.continueUnverifiedLocally()).rejects.toThrow('offline');
        expect(result.current.isGuest).toBe(false);
        expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
    });

    it('rejects a weak password before creating an account or touching the local archive', async () => {
        const archived = { privateDraft: 'do-not-touch' };
        idbStore['logbook:v2:user:unverified-user'] = archived;
        // A verified account would hydrate the intentionally opaque test archive.
        // Use the real unverified gate to exercise email actions without opening it.
        startWith(account(false));
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.emailVerificationRequired).toBe(true));

        await act(async () => {
            await expect(result.current.registerWithEmail('unverified@example.com', 'weak')).rejects.toThrow();
        });

        expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
        expect(sendEmailVerification).not.toHaveBeenCalled();
        expect(idbStore['logbook:v2:user:unverified-user']).toBe(archived);
        expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
    });

    it('does not continue email verification when refreshing the ID token fails', async () => {
        const user = account(false);
        startWith(user);
        const archived = { privateDraft: 'do-not-touch' };
        idbStore['logbook:v2:user:unverified-user'] = archived;
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.emailVerificationRequired).toBe(true));

        vi.mocked(reload).mockImplementationOnce(async () => { user.emailVerified = true; });
        user.getIdToken.mockRejectedValueOnce(new Error('token refresh unavailable'));
        const flush = vi.spyOn(draftRegistry, 'flushAll');
        try {
            await act(async () => {
                await expect(result.current.refreshEmailVerification()).rejects.toThrow('token refresh unavailable');
            });
            expect(user.getIdToken).toHaveBeenCalledWith(true);
            expect(result.current.emailVerificationRequired).toBe(true);
            expect(flush).not.toHaveBeenCalled();
        } finally {
            flush.mockRestore();
        }
        expect(idbStore['logbook:v2:user:unverified-user']).toBe(archived);
        expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
    });

    it('does not bypass the reload barrier when it rejects after refreshed claims', async () => {
        const user = account(false);
        startWith(user);
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.emailVerificationRequired).toBe(true));

        vi.mocked(reload).mockImplementationOnce(async () => { user.emailVerified = true; });
        const flush = vi.spyOn(draftRegistry, 'flushAll').mockImplementationOnce(() => {
            throw new Error('unsafe pending local draft');
        });
        try {
            await act(async () => {
                await expect(result.current.refreshEmailVerification()).rejects.toThrow('unsafe pending local draft');
            });
            expect(user.getIdToken).toHaveBeenCalledWith(true);
            expect(flush).toHaveBeenCalledWith({ strict: true });
            expect(result.current.emailVerificationRequired).toBe(true);
        } finally {
            flush.mockRestore();
        }
        expect(DB.loadCloudPayload).not.toHaveBeenCalled();
        expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
    });

    it('surfaces an email login error without deleting account data', async () => {
        const archived = { privateDraft: 'do-not-touch' };
        idbStore['logbook:v2:user:unverified-user'] = archived;
        vi.mocked(signInWithEmailAndPassword).mockRejectedValueOnce(
            Object.assign(new Error('bad password'), { code: 'auth/wrong-password' }),
        );
        // A verified account would hydrate the intentionally opaque test archive.
        // Use the real unverified gate to exercise email actions without opening it.
        startWith(account(false));
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.emailVerificationRequired).toBe(true));

        await act(async () => {
            await expect(result.current.loginWithEmail('unverified@example.com', 'wrong')).rejects.toThrow();
        });

        expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1);
        expect(idbStore['logbook:v2:user:unverified-user']).toBe(archived);
        expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
    });

    it('cancels a registration whose initiating form disappears during Firebase policy validation', async () => {
        const user = account(false);
        const archive = { privateDraft: 'untouched' };
        idbStore['logbook:v2:user:unverified-user'] = archive;
        startWith(user);
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.emailVerificationRequired).toBe(true));

        let finish!: (status: Awaited<ReturnType<typeof validatePassword>>) => void;
        vi.mocked(validatePassword).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        let mounted = true;
        const pending = result.current.registerWithEmail('next@example.test', 'SecurePassword123!', undefined, () => mounted);
        await waitFor(() => expect(validatePassword).toHaveBeenCalledOnce());
        mounted = false;
        await act(async () => {
            finish({ isValid: true } as Awaited<ReturnType<typeof validatePassword>>);
            await pending;
        });
        expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
        expect(idbStore['logbook:v2:user:unverified-user']).toBe(archive);
    });

    it('keeps actionable feedback from a stricter Firebase password policy', async () => {
        startWith(account(false));
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.emailVerificationRequired).toBe(true));
        vi.mocked(validatePassword).mockResolvedValueOnce({
            isValid: false, meetsMinPasswordLength: false,
            passwordPolicy: { customStrengthOptions: { minPasswordLength: 20 } },
        } as any);
        await act(async () => {
            await expect(result.current.registerWithEmail('next@example.test', 'SecurePassword123!')).rejects.toThrow();
        });
        expect(validatePassword).toHaveBeenCalledExactlyOnceWith(auth, 'SecurePassword123!');
        expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
        expect(useAppStore.getState().saveError).toContain('20 caratteri');
    });

    it('sends verification mail after creating an unverified password account', async () => {
        const createdUser = account(false);
        vi.mocked(createUserWithEmailAndPassword).mockImplementationOnce(async () => {
            (auth as any).currentUser = createdUser;
            return { user: createdUser, providerId: 'password', operationType: 'signIn' } as any;
        });
        vi.mocked(sendEmailVerification).mockResolvedValueOnce(undefined);

        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => {
            await result.current.registerWithEmail('unverified@example.com', 'SecurePassword123!');
        });

        expect(validatePassword).toHaveBeenCalledExactlyOnceWith(auth, 'SecurePassword123!');
        expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
        expect(sendEmailVerification).toHaveBeenCalledWith(createdUser);
        expect(useAppStore.getState().saveError).toContain('Verifica la tua email');
    });
});
