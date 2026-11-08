import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { waitForPendingWrites } from 'firebase/firestore';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { auth, onAuthStateChanged, signOut } from '../src/lib/firebase';
import { DB } from '../src/lib/db';
import { UserDataSchema } from '../src/lib/schema';
import { useDialogStore } from '../src/store/useDialogStore';
import { useAppStore } from '../src/store/useAppStore';
import { BrowserStorageError } from '../src/lib/sync/browserStorage';
import { createAndMigrateVault } from '../src/lib/sync/secureArchiveMigration';
import { initializeLocal, commitLocal } from '../src/lib/sync/localRepository';
import { lockAllVaults } from '../src/lib/sync/secureArchiveSession';
import { activateGuestSession, GUEST_SESSION_KEY, invalidateSession } from '../src/lib/sync/session';
import type { UserData } from '../src/types';

const exporter = vi.hoisted(() => ({
    exportEmergencyJSON: vi.fn(),
}));

vi.mock('../src/lib/export', () => ({
    Exporter: exporter,
}));

const dialogState = useDialogStore.getState();
const dialogs = {
    showAlert: vi.mocked(dialogState.showAlert),
    showConfirm: vi.mocked(dialogState.showConfirm),
    showUnsyncedDataLogout: vi.mocked(dialogState.showUnsyncedDataLogout),
};

const authenticatedUser = {
    uid: 'logout-user', email: 'logout@example.com', displayName: 'Logout User',
    emailVerified: true, providerData: [{ providerId: 'password' }],
    getIdToken: vi.fn(async () => 'synthetic-token'),
} as any;
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const userData = () => parse({
    profile: { height: '175' },
    routines: [{ id: 'routine-1', name: 'Persisted routine', exercises: [] }],
});

const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(AuthProvider, null, children);

function renderAuth() {
    return renderHook(() => useAuth(), { wrapper });
}

beforeEach(async () => {
    lockAllVaults();
    useAppStore.getState().resetStore();
    localStorage.clear();
    vi.clearAllMocks();

    useAppStore.setState({
        userData: userData(),
        dataOwner: 'user:logout-user',
        localWorkout: null,
        syncing: false,
        saveError: null,
        syncHealth: 'synced',
        compatibilityStatus: 'ok',
        compatibilityError: null,
    });

    (auth as any).currentUser = authenticatedUser;
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
        callback(authenticatedUser);
        return () => {};
    });
    vi.mocked(DB.loadCloudPayload).mockResolvedValue(null);
    vi.mocked(DB.secureLogOut).mockImplementation(async () => { await signOut(auth); });
    vi.mocked(DB.purgeAllLocalUserData).mockResolvedValue(undefined);
    vi.mocked(waitForPendingWrites).mockResolvedValue(undefined);
    dialogs.showAlert.mockResolvedValue(undefined);
    dialogs.showConfirm.mockResolvedValue(true);
    dialogs.showUnsyncedDataLogout.mockResolvedValue('cancel');

    // Authenticate the real local vault rather than bypassing its gate in
    // production code or replacing it with a mock. Each test owns a fresh key.
    await createAndMigrateVault('user:logout-user');
});

afterEach(() => { vi.restoreAllMocks(); });

describe('M5 logout protection through AuthProvider', () => {
    it('keeps guest data when the destructive logout confirmation is cancelled, then purges it when confirmed', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'logout-guest-generation');
        activateGuestSession('logout-guest-generation');
        (auth as any).currentUser = null;
        vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
            callback(null);
            return () => {};
        });
        // The guest fixture must be explicitly owned; no authenticated payload is transferable.
        useAppStore.setState({ dataOwner: 'guest' });
        dialogs.showConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

        const { result } = renderAuth();
        await waitFor(() => expect(result.current.isGuest).toBe(true));

        await act(async () => {
            await result.current.logout({ mode: 'normal' });
        });

        expect(dialogs.showConfirm).toHaveBeenCalledTimes(1);
        expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
        expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        expect(useAppStore.getState().userData?.routines?.[0]?.id).toBe('routine-1');

        await act(async () => {
            await result.current.logout({ mode: 'normal' });
        });

        expect(DB.purgeAllLocalUserData).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('logbook_is_guest')).toBeNull();
        expect(useAppStore.getState().userData).toBeNull();
        expect(result.current.isGuest).toBe(false);
    });

    it('keeps the guest archive when Web Locks are unavailable instead of purging without coordination', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-no-locks');
        activateGuestSession('guest-no-locks');
        (auth as any).currentUser = null;
        vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
            callback(null);
            return () => {};
        });
        useAppStore.setState({ dataOwner: 'guest' });
        const oldLocks = navigator.locks;
        Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
        try {
            const { result } = renderAuth();
            await waitFor(() => expect(result.current.isGuest).toBe(true));
            await act(async () => { await result.current.logout({ mode: 'normal', skipConfirm: true }); });
            expect(dialogs.showAlert).toHaveBeenCalledWith(
                expect.stringContaining('Impossibile coordinare la chiusura della modalità locale'),
            );
            expect(DB.purgeAllLocalUserData).not.toHaveBeenCalled();
            expect(localStorage.getItem('logbook_is_guest')).toBe('true');
        } finally {
            Object.defineProperty(navigator, 'locks', { configurable: true, value: oldLocks });
        }
    });

    it('notifies about a durable pending journal even when volatile sync status says synced', async () => {
        const initial = userData();
        await initializeLocal('user:logout-user', initial);
        await commitLocal('user:logout-user', {
            ...initial, profile: { ...initial.profile, height: '190' },
        }, initial);
        const { result } = renderAuth();
        await waitFor(() => expect(result.current.currentUser?.uid).toBe('logout-user'));
        useAppStore.setState({ syncHealth: 'synced', localWorkout: null });

        await act(async () => { await result.current.logout({ mode: 'normal' }); });

        expect(dialogs.showUnsyncedDataLogout).toHaveBeenCalledWith('offline');
        expect(DB.secureLogOut).not.toHaveBeenCalled();
    });

    it('shows the persisted-journal refusal without mislabeling it as a network error', async () => {
        const unsynced = Object.assign(new Error('Modifiche locali non sincronizzate.'), { name: 'UnsyncedLogoutError' });
        vi.mocked(DB.secureLogOut).mockRejectedValueOnce(unsynced);
        const { result } = renderAuth();
        await waitFor(() => expect(result.current.currentUser?.uid).toBe('logout-user'));

        await act(async () => { await result.current.logout({ mode: 'normal' }); });
        expect(dialogs.showAlert).toHaveBeenCalledWith('Modifiche locali non sincronizzate.');
    });

    it('executes the authenticated safe logout through DB and resets the in-memory session', async () => {
        const { result } = renderAuth();
        await waitFor(() => expect(result.current.currentUser?.uid).toBe('logout-user'));

        await act(async () => {
            await result.current.logout({ mode: 'normal' });
        });

        expect(DB.secureLogOut).toHaveBeenCalledTimes(1);
        expect(useAppStore.getState().userData).toBeNull();
        expect(useAppStore.getState().syncing).toBe(false);
        expect(dialogs.showUnsyncedDataLogout).not.toHaveBeenCalled();
    });

    it.each([
        ['local-pending', 'offline'],
        ['rejected', 'rejected'],
        ['failed', 'failed'],
    ] as const)('maps sync health %s to the blocking %s logout reason and honors cancel', async (syncHealth, reason) => {
        useAppStore.setState({ syncHealth });
        const { result } = renderAuth();
        await waitFor(() => expect(result.current.currentUser?.uid).toBe('logout-user'));

        await act(async () => {
            await result.current.logout({ mode: 'normal' });
        });

        expect(dialogs.showUnsyncedDataLogout).toHaveBeenCalledWith(reason);
        expect(DB.secureLogOut).not.toHaveBeenCalled();
        expect(useAppStore.getState().userData).not.toBeNull();
    });

    it('exports the current unsafe state and aborts logout when the dialog selects export', async () => {
        useAppStore.setState({ syncHealth: 'failed' });
        dialogs.showUnsyncedDataLogout.mockResolvedValueOnce('export');
        const expectedSnapshot = useAppStore.getState().userData;
        const { result } = renderAuth();
        await waitFor(() => expect(result.current.currentUser?.uid).toBe('logout-user'));

        await act(async () => {
            await result.current.logout({ mode: 'normal' });
        });

        expect(dialogs.showUnsyncedDataLogout).toHaveBeenCalledWith('failed');
        expect(exporter.exportEmergencyJSON).toHaveBeenCalledWith(expectedSnapshot);
        expect(DB.secureLogOut).not.toHaveBeenCalled();
        expect(useAppStore.getState().userData?.routines?.[0]?.id).toBe('routine-1');
    });

    it('rechecks state before safe-exit and proceeds only after the store becomes synced', async () => {
        useAppStore.setState({ syncHealth: 'local-pending' });
        dialogs.showUnsyncedDataLogout.mockImplementationOnce(async () => {
            useAppStore.setState({ syncHealth: 'synced' });
            return 'safe-exit';
        });
        const { result } = renderAuth();
        await waitFor(() => expect(result.current.currentUser?.uid).toBe('logout-user'));

        await act(async () => {
            await result.current.logout({ mode: 'normal' });
        });

        expect(dialogs.showUnsyncedDataLogout).toHaveBeenCalledWith('offline');
        expect(DB.secureLogOut).toHaveBeenCalledTimes(1);
        expect(useAppStore.getState().userData).toBeNull();
    });

    it('cancels the logout when the authenticated UID changes while pending writes are being checked', async () => {
        useAppStore.setState({ syncHealth: 'local-pending' });
        let releasePendingWrites!: () => void;
        const pendingWrites = new Promise<void>(resolve => { releasePendingWrites = resolve; });
        vi.mocked(waitForPendingWrites).mockReturnValueOnce(pendingWrites as any);

        const { result } = renderAuth();
        await waitFor(() => expect(result.current.currentUser?.uid).toBe('logout-user'));

        let logoutPromise!: Promise<void>;
        act(() => {
            logoutPromise = result.current.logout({ mode: 'normal' });
        });
        await waitFor(() => expect(waitForPendingWrites).toHaveBeenCalledTimes(1));

        (auth as any).currentUser = { ...authenticatedUser, uid: 'other-user' };
        releasePendingWrites();

        await act(async () => {
            await logoutPromise;
        });

        expect(dialogs.showUnsyncedDataLogout).not.toHaveBeenCalled();
        expect(DB.secureLogOut).not.toHaveBeenCalled();
        expect(useAppStore.getState().userData).not.toBeNull();
        // This test changes Firebase's mock UID without delivering the Auth
        // state-change callback. The expired logout must not clear syncing on
        // behalf of the successor: the actual Auth callback owns that reset.
        expect(useAppStore.getState().syncing).toBe(true);
    });

    it('does not apply an old logout to a fresh login with the same UID', async () => {
        useAppStore.setState({ syncHealth: 'local-pending' });
        let releasePendingWrites!: () => void;
        vi.mocked(waitForPendingWrites).mockImplementationOnce(
            () => new Promise<void>(resolve => { releasePendingWrites = resolve; }),
        );
        const { result } = renderAuth();
        await waitFor(() => expect(result.current.currentUser?.uid).toBe('logout-user'));

        let logoutPromise!: Promise<void>;
        act(() => { logoutPromise = result.current.logout({ mode: 'normal' }); });
        await waitFor(() => expect(waitForPendingWrites).toHaveBeenCalledOnce());
        // The Auth generation has moved even though Firebase reports the same UID.
        invalidateSession();
        (auth as any).currentUser = { ...authenticatedUser };
        releasePendingWrites();
        await act(async () => { await logoutPromise; });

        expect(DB.secureLogOut).not.toHaveBeenCalled();
        expect(dialogs.showUnsyncedDataLogout).not.toHaveBeenCalled();
        expect(useAppStore.getState().userData?.routines?.[0]?.id).toBe('routine-1');
    });

    it('coalesces rapid authenticated logout requests while the first secure logout is in flight', async () => {
        let releaseSecureLogout!: () => void;
        const secureLogout = new Promise<void>(resolve => { releaseSecureLogout = resolve; });
        vi.mocked(DB.secureLogOut).mockReturnValueOnce(secureLogout);

        const { result } = renderAuth();
        await waitFor(() => expect(result.current.currentUser?.uid).toBe('logout-user'));

        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => {
            first = result.current.logout({ mode: 'force' });
            second = result.current.logout({ mode: 'force' });
        });

        expect(DB.secureLogOut).toHaveBeenCalledTimes(1);
        releaseSecureLogout();

        await act(async () => {
            await Promise.all([first, second]);
        });

        expect(DB.secureLogOut).toHaveBeenCalledTimes(1);
        expect(useAppStore.getState().userData).toBeNull();
    });

    it('surfaces secure logout failures without purging the current in-memory data', async () => {
        vi.mocked(DB.secureLogOut).mockRejectedValueOnce(new Error('Network offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderAuth();
        await waitFor(() => expect(result.current.currentUser?.uid).toBe('logout-user'));

        await act(async () => {
            await result.current.logout({ mode: 'force' });
        });

        expect(dialogs.showAlert).toHaveBeenCalledWith('Errore durante il logout. Controlla la connessione e riprova.');
        expect(useAppStore.getState().userData?.routines?.[0]?.id).toBe('routine-1');
        expect(useAppStore.getState().syncing).toBe(false);
        consoleError.mockRestore();
    });

    it.each([
        new BrowserStorageError('remove', 'logbook:v2:user:logout-user:workout', new DOMException('blocked', 'SecurityError')),
        new AggregateError([new DOMException('full', 'QuotaExceededError')], 'Pulizia locale incompleta'),
    ])('distinguishes local storage cleanup failures from network failures', async (failure) => {
        vi.mocked(DB.secureLogOut).mockRejectedValueOnce(failure);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderAuth();
        await waitFor(() => expect(result.current.currentUser?.uid).toBe('logout-user'));

        await act(async () => {
            await result.current.logout({ mode: 'force' });
        });

        expect(dialogs.showAlert).toHaveBeenCalledWith(
            'Impossibile completare il logout perché la memoria locale del dispositivo non è disponibile o non è stata pulita completamente. I dati locali potrebbero essere ancora presenti. Riprova.'
        );
        expect(useAppStore.getState().userData?.routines?.[0]?.id).toBe('routine-1');
        expect(useAppStore.getState().syncing).toBe(false);
        consoleError.mockRestore();
    });
    it.each([
        ['account-switch', 'success'], ['account-switch', 'failure'],
        ['same-uid-login', 'success'], ['same-uid-login', 'failure'],
        ['guest-activation', 'success'], ['guest-activation', 'failure'],
        ['provider-unmount', 'success'], ['provider-unmount', 'failure'],
    ] as const)('preserves successor state after %s and a late secure logout %s', async (transition, outcome) => {
        let finish!: () => void;
        let fail!: (error: Error) => void;
        vi.mocked(DB.secureLogOut).mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
            finish = resolve;
            fail = reject;
        }));
        const view = renderAuth();
        await waitFor(() => expect(view.result.current.loading).toBe(false));
        let logout!: Promise<void>;
        act(() => { logout = view.result.current.logout({ mode: 'force' }); });
        await waitFor(() => expect(finish).toBeTypeOf('function'));

        if (transition === 'provider-unmount') view.unmount();
        const nextOwner = transition === 'guest-activation' ? 'guest'
            : transition === 'account-switch' ? 'user:next-user' : 'user:logout-user';
        act(() => {
            invalidateSession();
            (auth as any).currentUser = transition === 'guest-activation' ? null
                : { ...authenticatedUser, uid: transition === 'account-switch' ? 'next-user' : 'logout-user' };
            if (transition === 'guest-activation') {
                localStorage.setItem('logbook_is_guest', 'true');
                localStorage.setItem(GUEST_SESSION_KEY, 'next-guest-generation');
                activateGuestSession('next-guest-generation');
            }
            useAppStore.setState({
                userData: parse({ profile: { height: '199' } }), dataOwner: nextOwner,
                syncing: true, saveError: 'successor-message',
            });
        });
        const successor = useAppStore.getState();
        const alertCount = dialogs.showAlert.mock.calls.length;
        await act(async () => {
            if (outcome === 'success') finish();
            else fail(new Error('old logout failure'));
            await logout;
        });

        expect(useAppStore.getState()).toBe(successor);
        expect(dialogs.showAlert).toHaveBeenCalledTimes(alertCount);
    });

    it.each(['success', 'failure'] as const)('ignores a late logout %s after null-account-null callbacks', async outcome => {
        let notify!: (user: any) => Promise<void>;
        vi.mocked(onAuthStateChanged).mockImplementationOnce((_auth, callback: any) => {
            notify = callback;
            callback(authenticatedUser);
            return () => {};
        });
        let finish!: () => void;
        let fail!: (error: Error) => void;
        vi.mocked(DB.secureLogOut).mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
            finish = resolve;
            fail = reject;
        }));
        const { result } = renderAuth();
        await waitFor(() => expect(result.current.loading).toBe(false));
        let logout!: Promise<void>;
        act(() => { logout = result.current.logout({ mode: 'force' }); });
        await waitFor(() => expect(finish).toBeTypeOf('function'));
        await act(async () => {
            (auth as any).currentUser = null;
            await notify(null);
            const nextLogin = { ...authenticatedUser, emailVerified: false };
            (auth as any).currentUser = nextLogin;
            await notify(nextLogin);
            (auth as any).currentUser = null;
            await notify(null);
            useAppStore.setState({ syncing: true, saveError: 'later-session-message' });
        });
        const successor = useAppStore.getState();
        const alertCount = dialogs.showAlert.mock.calls.length;

        await act(async () => {
            if (outcome === 'success') finish();
            else fail(new Error('old logout failure'));
            await logout;
        });

        expect(useAppStore.getState()).toBe(successor);
        expect(dialogs.showAlert).toHaveBeenCalledTimes(alertCount);
    });

    it('finishes the expected sign-out callback without treating its epoch reset as a new login', async () => {
        let notify!: (user: any) => Promise<void>;
        vi.mocked(onAuthStateChanged).mockImplementationOnce((_auth, callback: any) => {
            notify = callback;
            callback(authenticatedUser);
            return () => {};
        });
        let finish!: () => void;
        vi.mocked(DB.secureLogOut).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        const { result } = renderAuth();
        await waitFor(() => expect(result.current.loading).toBe(false));
        let logout!: Promise<void>;
        act(() => { logout = result.current.logout({ mode: 'force' }); });
        await waitFor(() => expect(finish).toBeTypeOf('function'));
        await act(async () => {
            (auth as any).currentUser = null;
            await notify(null);
            finish();
            await logout;
        });

        expect(useAppStore.getState().userData).toBeNull();
        expect(useAppStore.getState().syncing).toBe(false);
        expect(result.current.currentUser).toBeNull();
        expect(dialogs.showAlert).not.toHaveBeenCalled();
    });

});
