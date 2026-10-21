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
import { activateGuestSession, GUEST_SESSION_KEY } from '../../src/lib/sync/session';
import { withGuestLifecycleLock } from '../../src/lib/sync/guestLifecycleLock';

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

describe('serialized guest migration intent belongs to an exact Auth attempt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        // Auth hooks are tested against a real current guest generation, not
        // only a stub returning true without a durable guest session.
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-intent-test-generation');
        activateGuestSession('guest-intent-test-generation');
    });
    afterEach(() => vi.restoreAllMocks());

    it.each(['login', 'linkGoogleAccount'] as const)(
        'rejects a concurrent guest policy while old Google %s is pending', async action => {
            let fail!: (error: unknown) => void;
            vi.mocked(signInWithPopup).mockImplementationOnce(() =>
                new Promise<never>((_resolve, reject) => { fail = reject; }));
            const { result } = google(true);
            const pending = result.current[action]('merge');
            await waitFor(() => expect(localStorage.getItem(KEY)).not.toBeNull());
            const old = localStorage.getItem(KEY);
            await waitFor(() => expect(fail).toBeTypeOf('function'));

            await expect(beginGuestMigrationIntent('skip', 'email', { email: 'later@example.test' }))
                .rejects.toThrow('Un altro tentativo');
            expect(localStorage.getItem(KEY)).toBe(old);
            fail(networkFailure());
            await act(async () => { await pending; });
            expect(localStorage.getItem(KEY)).toBeNull();
        },
    );


    it('rejects Google sign-in started in a revoked guest generation while the Auth lock was queued', async () => {
        let releaseLock!: () => void;
        let notifyEntered!: () => void;
        const entered = new Promise<void>(resolve => { notifyEntered = resolve; });
        const blocked = new Promise<void>(resolve => { releaseLock = resolve; });
        const holder = withGuestLifecycleLock(async () => {
            notifyEntered();
            await blocked;
        });
        await entered;
        const { result } = google(true);
        const pending = result.current.login('merge');
        // A new guest generation must never inherit an older generation's
        // merge/skip selection after lock scheduling.
        localStorage.setItem(GUEST_SESSION_KEY, 'new-guest-intent-generation');
        activateGuestSession('new-guest-intent-generation');
        releaseLock();
        await holder;
        await act(async () => {
            await expect(pending).rejects.toThrow('non più attiva');
        });
        expect(signInWithPopup).not.toHaveBeenCalled();
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('rejects a Firebase broadcast observed in a tab without the initiating receipt', async () => {
        const { bindGuestMigrationIntentToUser } = await import('../../src/lib/auth/guestMigrationIntent');
        const attempt = await beginGuestMigrationIntent('merge', 'email', { email: 'same@example.test' });
        const receipt = sessionStorage.getItem('logbook:guest-auth-attempt');
        sessionStorage.removeItem('logbook:guest-auth-attempt');
        const user = { uid: 'same-account', email: 'same@example.test' } as User;
        await expect(bindGuestMigrationIntentToUser(user)).rejects.toThrow('origine da questa scheda');
        expect(JSON.parse(localStorage.getItem(KEY)!).policy).toBe('merge');
        sessionStorage.setItem('logbook:guest-auth-attempt', receipt!);
        const bound = await bindGuestMigrationIntentToUser(user);
        expect(bound.id).toBe(attempt.id);
        expect(bound.policy).toBe('merge');
    });

    it('permits only an explicitly authenticated recovery to replace a reserved policy', async () => {
        const { bindGuestMigrationIntentToUser, clearGuestMigrationIntent } =
            await import('../../src/lib/auth/guestMigrationIntent');
        const old = await beginGuestMigrationIntent('merge', 'email', { email: 'a@example.test' });
        await expect(beginGuestMigrationIntent('skip', 'google')).rejects.toThrow('Un altro tentativo');
        const recovered = await beginGuestMigrationIntent('skip', 'recovery', {
            uid: 'account-b', assertCurrent: () => true,
        });
        expect(recovered.id).not.toBe(old.id);
        expect(JSON.parse(localStorage.getItem(KEY)!).policy).toBe('skip');
        await expect(clearGuestMigrationIntent(old.id)).rejects.toThrow('corrente è cambiato');
        const bound = await bindGuestMigrationIntentToUser({ uid: 'account-b' } as User);
        expect(bound.policy).toBe('skip');
        await clearGuestMigrationIntent(recovered.id);
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('refuses a stale recovery after its authenticated session changes before acquiring the lock', async () => {
        const original = await beginGuestMigrationIntent('merge', 'email', { email: 'a@example.test' });
        await expect(beginGuestMigrationIntent('skip', 'recovery', {
            uid: 'account-b', assertCurrent: () => false,
        })).rejects.toThrow('non più attiva');
        expect(JSON.parse(localStorage.getItem(KEY)!).id).toBe(original.id);
    });

    it('never reports journal-only recovery as success while a stale guest snapshot belongs to another owner', async () => {
        const { auth } = await import('../../src/lib/firebase');
        const { UserDataSchema } = await import('../../src/lib/schema');
        const { useGuestMigrationRetry } = await import('../../src/contexts/auth/useGuestMigrationRetry');
        const safeReload = await import('../../src/lib/sync/safeReload');
        const journal = await import('../../src/lib/sync/replicateJournal');
        const originalUser = auth.currentUser;
        const snapshot = useAppStore.getState();
        const user = { uid: 'authenticated-after-another-tab', emailVerified: true } as User;
        const setStatus = vi.fn();
        const setSaveError = vi.fn();
        const reload = vi.spyOn(safeReload, 'safeHardReload').mockRejectedValueOnce(new Error('Bozza locale non verificata'));
        const replicate = vi.spyOn(journal, 'replicateJournal');
        try {
            (auth as { currentUser: User | null }).currentUser = user;
            useAppStore.setState({
                dataOwner: 'guest',
                userData: UserDataSchema.parse({ profile: { height: '172' } }) as any,
            });
            const hook = renderHook(() => useGuestMigrationRetry({
                isGuestActiveStrict: () => false,
                setSaveError,
                setSyncing: vi.fn(),
                setGuestMigrationStatus: setStatus,
                clearGuestMigrationSyncRecovery: vi.fn(),
            }));
            await act(async () => { await hook.result.current(); });
            expect(reload).toHaveBeenCalledTimes(1);
            expect(replicate).not.toHaveBeenCalled();
            expect(setStatus).toHaveBeenCalledWith('failed');
            expect(setSaveError).toHaveBeenCalledWith('Bozza locale non verificata');
            expect(useAppStore.getState().dataOwner).toBe('guest');
            hook.unmount();
        } finally {
            (auth as { currentUser: User | null }).currentUser = originalUser;
            useAppStore.setState({
                dataOwner: snapshot.dataOwner,
                userData: snapshot.userData,
                localWorkout: snapshot.localWorkout,
            });
            reload.mockRestore();
            replicate.mockRestore();
        }
    });

    it('does not clear an existing guest Auth intent when non-guest Google login fails', async () => {
        const other = await beginGuestMigrationIntent('merge', 'recovery', { uid: 'account-b' });
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
        'rejects a concurrent guest Auth intent while old email %s is pending', async action => {
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
            await expect(beginGuestMigrationIntent('skip', 'email', { email: 'later@example.test' }))
                .rejects.toThrow('Un altro tentativo');
            expect(localStorage.getItem(KEY)).toBe(prior);
            fail(new Error('old request failed'));
            await act(async () => { await expect(pending).rejects.toThrow('old request failed'); });
            expect(localStorage.getItem(KEY)).toBeNull();
        },
    );

    it('retains another attempt when a non-guest email login fails', async () => {
        const original = await beginGuestMigrationIntent('merge', 'recovery', { uid: 'other-owner' });
        vi.mocked(signInWithEmailAndPassword).mockRejectedValueOnce(new Error('wrong password'));
        const { result } = email(false);
        await act(async () => {
            await expect(result.current.loginWithEmail('other@example.test', 'WrongPass1!'))
                .rejects.toThrow('wrong password');
        });
        expect(JSON.parse(localStorage.getItem(KEY)!).id).toBe(original.id);
    });

    it('does not overwrite a pending attempt during persisted account handoff', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        let release!: (record: unknown) => void;
        const spy = vi.spyOn(localRepository, 'readLocal').mockImplementationOnce(() =>
            new Promise<any>(resolve => { release = resolve; }));
        const old = await beginGuestMigrationIntent('merge', 'recovery', { uid: 'test-user-id' });
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
        await expect(beginGuestMigrationIntent('skip', 'email', { email: 'other@example.test' }))
            .rejects.toThrow('Un altro tentativo');
        const originalBytes = localStorage.getItem(KEY);
        release({ data: {}, pending: [] });
        await run;
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(localStorage.getItem(KEY)).toBe(originalBytes);
        expect(JSON.parse(originalBytes!).id).toBe(old.id);
        spy.mockRestore();
    });
});
