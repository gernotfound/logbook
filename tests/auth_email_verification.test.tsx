import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { auth, createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification } from '../src/lib/firebase';
import { DB } from '../src/lib/db';
import { useAppStore } from '../src/store/useAppStore';

const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;

describe('email verification lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.getState().resetStore({ force: true });
        (auth as any).currentUser = {
            uid: 'test-user-id',
            email: 'test@example.com',
            emailVerified: true,
            providerData: [{ providerId: 'password' }],
            getIdToken: vi.fn().mockResolvedValue('test-token'),
        };
    });

    it('marks an unverified password account without blocking its data hydration', async () => {
        const unverified = {
            uid: 'unverified-user',
            email: 'unverified@example.com',
            emailVerified: false,
            providerData: [{ providerId: 'password' }],
            getIdToken: vi.fn().mockResolvedValue('test-token'),
        } as any;
        (auth as any).currentUser = unverified;
        vi.mocked(onAuthStateChanged).mockImplementationOnce((_auth, callback: any) => {
            callback(unverified);
            return () => {};
        });

        const { result } = renderHook(() => useAuth(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.emailVerificationRequired).toBe(true);
        expect(DB.loadCloudPayload).toHaveBeenCalled();
    });

    it('sends a verification email immediately after creating an unverified password account', async () => {
        const createdUser = {
            uid: 'new-user',
            email: 'new@example.com',
            emailVerified: false,
            providerData: [{ providerId: 'password' }],
            getIdToken: vi.fn().mockResolvedValue('test-token'),
        } as any;
        vi.mocked(createUserWithEmailAndPassword).mockResolvedValueOnce({ user: createdUser } as any);
        vi.mocked(sendEmailVerification).mockResolvedValueOnce(undefined);

        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.registerWithEmail('new@example.com', 'SecurePassword123!');
        });

        expect(sendEmailVerification).toHaveBeenCalledWith(createdUser);
        expect(useAppStore.getState().saveError).toContain('Verifica la tua email');
    });
});
