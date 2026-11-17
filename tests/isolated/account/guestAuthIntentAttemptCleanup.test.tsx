import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    signInWithPopup, signInWithRedirect, signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
} from 'firebase/auth';
import type { User, UserCredential } from 'firebase/auth';
import { auth } from '../../../src/lib/firebase';
import { useGoogleAuthActions } from '../../../src/contexts/auth/useGoogleAuthActions';
import { useGuestMigrationRetry } from '../../../src/contexts/auth/useGuestMigrationRetry';
import * as browserStorage from '../../../src/lib/sync/browserStorage';
import * as safeReload from '../../../src/lib/sync/safeReload';
import { useEmailAuthActions } from '../../../src/contexts/auth/useEmailAuthActions';
import { beginGuestMigrationIntent } from '../../../src/lib/auth/guestMigrationIntent';
import { markGuestMigrationSyncRecovery } from '../../../src/lib/auth/guestMigrationSyncRecovery';
import { resumePersistedGuestMigration } from '../../../src/contexts/auth/resumePersistedGuestMigration';
import * as localRepository from '../../../src/lib/sync/localRepository';
import { useAppStore } from '../../../src/store/useAppStore';
import { activateGuestSession, GUEST_SESSION_KEY, invalidateSession } from '../../../src/lib/sync/session';
import { withGuestLifecycleLock } from '../../../src/lib/sync/guestLifecycleLock';

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
            await expect(pending).rejects.toThrow('non è più attiva');
        });
        expect(signInWithPopup).not.toHaveBeenCalled();
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it.each(['login', 'linkGoogleAccount'] as const)(
        'does not launch Google %s after its reservation resumes in a different Auth epoch',
        async action => {
            const write = browserStorage.writeBrowserJson;
            vi.spyOn(browserStorage, 'writeBrowserJson').mockImplementation((key, value) => {
                write(key, value);
                if (key === KEY) invalidateSession();
            });
            const { result } = google(true);
            await act(async () => { await result.current[action]('merge'); });

            expect(signInWithPopup).not.toHaveBeenCalled();
            expect(signInWithRedirect).not.toHaveBeenCalled();
            expect(localStorage.getItem(KEY)).toBeNull();
            expect(localStorage.getItem('logbook_is_guest')).toBe('true');
            expect(localStorage.getItem(GUEST_SESSION_KEY)).toBe('guest-intent-test-generation');
        },
    );

    it.each(['login', 'register'] as const)(
        'does not send email %s credentials after its reservation resumes in a different Auth epoch',
        async action => {
            const write = browserStorage.writeBrowserJson;
            vi.spyOn(browserStorage, 'writeBrowserJson').mockImplementation((key, value) => {
                write(key, value);
                if (key === KEY) invalidateSession();
            });
            const { result } = email(true);
            await act(async () => {
                if (action === 'login') await result.current.loginWithEmail('guest@example.test', 'SecurePassword123!Long', 'merge');
                else await result.current.registerWithEmail('guest@example.test', 'SecurePassword123!Long', 'merge');
            });

            expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
            expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
            expect(localStorage.getItem(KEY)).toBeNull();
            expect(localStorage.getItem('logbook_is_guest')).toBe('true');
            expect(localStorage.getItem(GUEST_SESSION_KEY)).toBe('guest-intent-test-generation');
        },
    );

    it('requires the actual Google popup result after an earlier same-UID Auth event', async () => {
        const { bindGuestMigrationIntentToUser } = await import('../../../src/lib/auth/guestMigrationIntent');
        const user = { uid: 'shared-account', email: 'same@example.test',
            providerData: [{ providerId: 'google.com' }] } as User;
        let deliver!: (credential: Awaited<ReturnType<typeof signInWithPopup>>) => void;
        vi.mocked(signInWithPopup).mockImplementationOnce(() =>
            new Promise(resolve => { deliver = resolve; }));
        const { result } = google(true);
        const pendingLogin = result.current.login('merge');
        await waitFor(() => expect(deliver).toBeTypeOf('function'));
        const attempted = JSON.parse(localStorage.getItem(KEY)!);
        let migrated = false;
        const observed = bindGuestMigrationIntentToUser(user).then(intent => {
            migrated = true;
            return intent;
        });
        // This callback could have been triggered by a different tab. Matching
        // user and provider do not release the originating tab's reservation.
        await Promise.resolve();
        expect(migrated).toBe(false);
        (auth as { currentUser: User | null }).currentUser = user;
        deliver({ user, providerId: 'google.com', operationType: 'signIn' } as UserCredential);
        await act(async () => { await pendingLogin; });
        await expect(observed).resolves.toMatchObject({ id: attempted.id, policy: 'merge' });
        expect(migrated).toBe(true);
        expect(JSON.parse(localStorage.getItem(KEY)!)).not.toHaveProperty('credentialUid');
    });

    it('does not fall back to redirect when a successful popup has the wrong credential provider', async () => {
        const user = { uid: 'shared-account', email: 'same@example.test',
            providerData: [{ providerId: 'google.com' }] } as User;
        vi.mocked(signInWithPopup).mockImplementationOnce(async () => {
            // A successful SDK sign-in installs its user before returning the
            // credential. Keep only the provider mismatch under test invalid.
            (auth as { currentUser: User | null }).currentUser = user;
            return { user, providerId: 'password', operationType: 'signIn' } as UserCredential;
        });
        const { result } = google(true);
        const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await act(async () => { await result.current.login('merge'); });
            expect(signInWithRedirect).not.toHaveBeenCalled();
            expect(useAppStore.getState().saveError).toContain('trasferimento guest non autorizzato');
            expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ policy: 'merge' });
        } finally {
            logger.mockRestore();
        }
    });

    it('rejects a Firebase broadcast observed in a tab without the initiating receipt', async () => {
        const { bindGuestMigrationIntentToUser, confirmGuestMigrationCredential } = await import('../../../src/lib/auth/guestMigrationIntent');
        const attempt = await beginGuestMigrationIntent('merge', 'email', { email: 'same@example.test' });
        const receipt = sessionStorage.getItem('logbook:guest-auth-attempt');
        sessionStorage.removeItem('logbook:guest-auth-attempt');
        const user = { uid: 'same-account', email: 'same@example.test' } as User;
        await expect(bindGuestMigrationIntentToUser(user)).rejects.toThrow('origine da questa scheda');
        expect(JSON.parse(localStorage.getItem(KEY)!).policy).toBe('merge');
        sessionStorage.setItem('logbook:guest-auth-attempt', receipt!);
        await confirmGuestMigrationCredential(attempt.id, { user, providerId: 'password' } as UserCredential);
        const bound = await bindGuestMigrationIntentToUser(user);
        expect(bound.id).toBe(attempt.id);
        expect(bound.policy).toBe('merge');
    });

    it('permits only an explicitly authenticated recovery to replace a reserved policy', async () => {
        const { bindGuestMigrationIntentToUser, clearGuestMigrationIntent } =
            await import('../../../src/lib/auth/guestMigrationIntent');
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
        })).rejects.toThrow('non è più attiva');
        expect(JSON.parse(localStorage.getItem(KEY)!).id).toBe(original.id);
    });

    it('does not publish a queued guest retry failure into a newer session', async () => {
        const originalUser = auth.currentUser;
        const user = { uid: 'guest-retry-account', emailVerified: true } as User;
        (auth as { currentUser: User | null }).currentUser = user;
        let releaseLock!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>(resolve => { releaseLock = resolve; });
        const acquired = new Promise<void>(resolve => { entered = resolve; });
        const holder = withGuestLifecycleLock(async () => { entered(); await gate; });
        await acquired;
        const setStatus = vi.fn();
        const setSaveError = vi.fn();
        const reload = vi.spyOn(safeReload, 'safeHardReload').mockResolvedValue(undefined);
        const { result } = renderHook(() => useGuestMigrationRetry({
            isGuestActiveStrict: () => true, setSaveError,
            setSyncing: vi.fn(), setGuestMigrationStatus: setStatus,
            clearGuestMigrationSyncRecovery: vi.fn(),
        }));
        try {
            const pending = result.current('merge');
            localStorage.setItem(GUEST_SESSION_KEY, 'replacement-retry-guest');
            activateGuestSession('replacement-retry-guest');
            releaseLock();
            await holder;
            await act(async () => { await pending; });
            expect(reload).not.toHaveBeenCalled();
            expect(setStatus).not.toHaveBeenCalled();
            expect(setSaveError.mock.calls).toEqual([[null]]);
            expect(localStorage.getItem(KEY)).toBeNull();
        } finally {
            releaseLock();
            (auth as { currentUser: User | null }).currentUser = originalUser;
        }
    });

    it('does not reload a new guest generation after reserving an older retry', async () => {
        const originalUser = auth.currentUser;
        const user = { uid: 'same-retry-account', emailVerified: true } as User;
        (auth as { currentUser: User | null }).currentUser = user;
        const write = browserStorage.writeBrowserJson;
        vi.spyOn(browserStorage, 'writeBrowserJson').mockImplementation((key, value) => {
            write(key, value);
            if (key === KEY) {
                localStorage.setItem(GUEST_SESSION_KEY, 'replacement-after-reservation');
                activateGuestSession('replacement-after-reservation');
            }
        });
        const reload = vi.spyOn(safeReload, 'safeHardReload').mockResolvedValue(undefined);
        const setStatus = vi.fn();
        const setSaveError = vi.fn();
        const { result } = renderHook(() => useGuestMigrationRetry({
            isGuestActiveStrict: () => true, setSaveError,
            setSyncing: vi.fn(), setGuestMigrationStatus: setStatus,
            clearGuestMigrationSyncRecovery: vi.fn(),
        }));
        try {
            await act(async () => { await result.current('skip'); });
            expect(reload).not.toHaveBeenCalled();
            expect(setStatus).not.toHaveBeenCalled();
            expect(setSaveError.mock.calls).toEqual([[null]]);
            expect(JSON.parse(localStorage.getItem(KEY)!))
                .toMatchObject({ policy: 'skip', method: 'recovery', expectedUid: user.uid });
        } finally {
            (auth as { currentUser: User | null }).currentUser = originalUser;
        }
    });

    it('never reports journal-only recovery as success while a stale guest snapshot belongs to another owner', async () => {
        const { auth } = await import('../../../src/lib/firebase');
        const { UserDataSchema } = await import('../../../src/lib/schema');
        const { useGuestMigrationRetry } = await import('../../../src/contexts/auth/useGuestMigrationRetry');
        const safeReload = await import('../../../src/lib/sync/safeReload');
        const journal = await import('../../../src/lib/sync/replicateJournal');
        const originalUser = auth.currentUser;
        const snapshot = useAppStore.getState();
        const user = { uid: 'authenticated-after-another-tab', emailVerified: true } as User;
        const setStatus = vi.fn();
        const setSaveError = vi.fn();
        const reload = vi.spyOn(safeReload, 'safeHardReload').mockRejectedValueOnce(new Error('Bozza locale non verificata'));
        const replicate = vi.spyOn(journal, 'replicateJournal');
        try {
            // A different tab completed the guest handoff, but this tab still
            // holds the old guest UI snapshot. Auth/session ownership must now
            // be authenticated for the strict reload barrier to be reachable.
            localStorage.removeItem('logbook_is_guest');
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
            localStorage.setItem('logbook_is_guest', 'true');
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
                : result.current.registerWithEmail('first@example.test', 'SecurePassword123!Long', 'merge');
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
        markGuestMigrationSyncRecovery('test-user-id');
        const run = resumePersistedGuestMigration(
            { uid: 'test-user-id' } as User,
            () => localStorage.getItem('logbook_is_guest') === 'true',
            {
                guestKey: 'logbook_is_guest',
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
        // A new Auth attempt waits for recovery's entire guest transition.
        // Once the guest has been retired, the queued attempt must not adopt it.
        const newAttempt = beginGuestMigrationIntent('skip', 'email', {
            email: 'other@example.test',
            assertCurrent: () => localStorage.getItem('logbook_is_guest') === 'true',
        });
        const originalBytes = localStorage.getItem(KEY);
        release({ data: {}, pending: [] });
        await run;
        await expect(newAttempt).rejects.toThrow('non è più attiva');
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(localStorage.getItem(KEY)).toBe(originalBytes);
        expect(JSON.parse(originalBytes!).id).toBe(old.id);
        spy.mockRestore();
    });
});
