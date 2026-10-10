import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { auth, createUserWithEmailAndPassword, onAuthStateChanged, reload, sendEmailVerification, signOut } from '../src/lib/firebase';
import { DB } from '../src/lib/db';
import { useAppStore } from '../src/store/useAppStore';
import { idbStore } from './setup';
import { draftRegistry } from '../src/lib/utils/draftRegistry';
import { UserDataSchema } from '../src/lib/schema';

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

        await act(async () => {
            await result.current.refreshEmailVerification();
        });
        expect(reload).toHaveBeenCalledWith(user);
        expect(user.getIdToken).not.toHaveBeenCalled();


        vi.mocked(reload).mockImplementationOnce(async () => {
            user.emailVerified = true;
        });
        await act(async () => {
            await result.current.refreshEmailVerification();
        });
        expect(user.getIdToken).toHaveBeenCalledWith(true);

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

    it('sends verification mail after creating an unverified password account', async () => {
        const createdUser = account(false);
        vi.mocked(createUserWithEmailAndPassword).mockResolvedValueOnce({ user: createdUser } as any);
        vi.mocked(sendEmailVerification).mockResolvedValueOnce(undefined);

        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => {
            await result.current.registerWithEmail('unverified@example.com', 'SecurePassword123!');
        });

        expect(sendEmailVerification).toHaveBeenCalledWith(createdUser);
        expect(useAppStore.getState().saveError).toContain('Verifica la tua email');
    });
});
