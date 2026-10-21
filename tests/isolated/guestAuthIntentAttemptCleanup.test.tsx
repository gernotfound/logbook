import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    signInWithPopup, signInWithRedirect, signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { useGoogleAuthActions } from '../../src/contexts/auth/useGoogleAuthActions';
import { useEmailAuthActions } from '../../src/contexts/auth/useEmailAuthActions';
import { beginGuestMigrationIntent } from '../../src/lib/auth/guestMigrationIntent';
import { resumePersistedGuestMigration } from '../../src/contexts/auth/resumePersistedGuestMigration';
import * as localRepository from '../../src/lib/sync/localRepository';
import { useAppStore } from '../../src/store/useAppStore';

const KEY = 'guest_migration_intent_v1';

function google(guest: boolean) {
    return renderHook(() => useGoogleAuthActions({
        isGuestActiveStrict: () => guest,
        setSaveError: useAppStore.getState().setSaveError,
        migrationDataRef: { current: null },
        redirectLaunchFailedRef: { current: false },
    }));
}

function email(guest: boolean) {
    return renderHook(() => useEmailAuthActions({
        isGuestActiveStrict: () => guest,
        setSaveError: useAppStore.getState().setSaveError,
        setEmailVerificationRequired: vi.fn(),
        migrationDataRef: { current: null },
    }));
}

const networkFailure = () => Object.assign(new Error('network unavailable'), { code: 'auth/network-request-failed' });

describe('unscoped guest migration intent belongs to an exact Auth attempt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });
    afterEach(() => vi.restoreAllMocks());

    it.each(['login', 'linkGoogleAccount'] as const)(
        'does not clear a newer tab intent when old Google %s fails asynchronously', async action => {
            let fail!: (error: unknown) => void;
            vi.mocked(signInWithPopup).mockImplementationOnce(() =>
                new Promise<never>((_resolve, reject) => { fail = reject; }));
            const { result } = google(true);
            const pending = result.current[action]('merge');
            const old = localStorage.getItem(KEY);
            expect(old).not.toBeNull();

            const newAttempt = beginGuestMigrationIntent('skip', 'email', { email: 'later@example.test' });
            const preserved = localStorage.getItem(KEY);
            expect(preserved).not.toBe(old);
            fail(networkFailure());
            await act(async () => { await pending; });

            expect(localStorage.getItem(KEY)).toBe(preserved);
            expect(JSON.parse(localStorage.getItem(KEY)!).id).toBe(newAttempt.id);
        },
    );

    it('does not clear an existing guest Auth intent when non-guest Google login fails', async () => {
        const other = beginGuestMigrationIntent('merge', 'recovery', { uid: 'account-b' });
        const original = localStorage.getItem(KEY);
        vi.mocked(signInWithPopup).mockRejectedValueOnce(networkFailure());
        const { result } = google(false);
        await act(async () => { await result.current.login(); });
        expect(localStorage.getItem(KEY)).toBe(original);
        expect(JSON.parse(localStorage.getItem(KEY)!).id).toBe(other.id);
    });

    it('clears precisely its own intent when a guest Google popup is cancelled', async () => {
        vi.mocked(signInWithPopup).mockRejectedValueOnce(
            Object.assign(new Error('cancelled'), { code: 'auth/popup-closed-by-user' }));
        const { result } = google(true);
        await act(async () => { await result.current.login('merge'); });
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('clears its own intent if both Google popup and redirect launch fail', async () => {
        vi.mocked(signInWithPopup).mockRejectedValueOnce(
            Object.assign(new Error('popup blocked'), { code: 'auth/popup-blocked' }));
        vi.mocked(signInWithRedirect).mockRejectedValueOnce(new Error('redirect rejected'));
        const { result } = google(true);
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await act(async () => { await result.current.login('merge'); });
        expect(localStorage.getItem(KEY)).toBeNull();
        consoleSpy.mockRestore();
    });

    it.each(['login', 'register'] as const)(
        'preserves the newer guest Auth intent after the old email %s fails', async action => {
            let fail!: (error: unknown) => void;
            if (action === 'login') {
                vi.mocked(signInWithEmailAndPassword).mockImplementationOnce(() =>
                    new Promise<never>((_resolve, reject) => { fail = reject; }));
            } else {
                vi.mocked(createUserWithEmailAndPassword).mockImplementationOnce(() =>
                    new Promise<never>((_resolve, reject) => { fail = reject; }));
            }
            const { result } = email(true);
            const pending = action === 'login'
                ? result.current.loginWithEmail('first@example.test', 'Password1!', 'merge')
                : result.current.registerWithEmail('first@example.test', 'Password1!', 'merge');
            await waitFor(() => expect(fail).toBeTypeOf('function'));
            const prior = localStorage.getItem(KEY);
            expect(prior).not.toBeNull();
            const later = beginGuestMigrationIntent('skip', 'email', { email: 'later@example.test' });
            const untouched = localStorage.getItem(KEY);
            fail(new Error('old request failed'));
            await act(async () => { await expect(pending).rejects.toThrow('old request failed'); });
            expect(localStorage.getItem(KEY)).toBe(untouched);
            expect(JSON.parse(localStorage.getItem(KEY)!).id).toBe(later.id);
        },
    );

    it('retains another attempt when a non-guest email login fails', async () => {
        const original = beginGuestMigrationIntent('merge', 'recovery', { uid: 'other-owner' });
        vi.mocked(signInWithEmailAndPassword).mockRejectedValueOnce(new Error('wrong password'));
        const { result } = email(false);
        await act(async () => {
            await expect(result.current.loginWithEmail('other@example.test', 'WrongPass1!'))
                .rejects.toThrow('wrong password');
        });
        expect(JSON.parse(localStorage.getItem(KEY)!).id).toBe(original.id);
    });

    it('preserves a concurrently replaced intent while completing persisted account handoff', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        let release!: (record: unknown) => void;
        const spy = vi.spyOn(localRepository, 'readLocal').mockImplementationOnce(() =>
            new Promise<any>(resolve => { release = resolve; }));
        const old = beginGuestMigrationIntent('merge', 'recovery', { uid: 'test-user-id' });
        const run = resumePersistedGuestMigration(
            { uid: 'test-user-id' } as User,
            () => localStorage.getItem('logbook_is_guest') === 'true',
            {
                guestKey: 'logbook_is_guest',
                isGuestActiveStrict: () => true,
                isGuestRef: { current: true },
                migrationDataRef: { current: null },
                setIsGuest: vi.fn(),
                setGuestMigrationStatus: vi.fn(),
                setSyncing: vi.fn(),
                setSaveError: vi.fn(),
                clearGuestMigrationSyncRecovery: vi.fn(),
            },
        );
        await waitFor(() => expect(release).toBeTypeOf('function'));
        const newer = beginGuestMigrationIntent('skip', 'email', { email: 'other@example.test' });
        const originalBytes = localStorage.getItem(KEY);
        release({ data: {}, pending: [] });
        await run;
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(localStorage.getItem(KEY)).toBe(originalBytes);
        expect(newer.id).not.toBe(old.id);
        spy.mockRestore();
    });
});
