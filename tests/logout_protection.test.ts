import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { waitForPendingWrites } from 'firebase/firestore';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { auth, onAuthStateChanged } from '../src/lib/firebase';
import { DB } from '../src/lib/db';
import { UserDataSchema } from '../src/lib/schema';
import { useAppStore } from '../src/store/useAppStore';
import type { UserData } from '../src/types';

const dialogs = vi.hoisted(() => ({
    showAlert: vi.fn(),
    showConfirm: vi.fn(),
    showUnsyncedDataLogout: vi.fn(),
}));
const exporter = vi.hoisted(() => ({
    exportEmergencyJSON: vi.fn(),
}));

vi.mock('../src/store/useDialogStore', () => {
    const state = {
        isOpen: false,
        type: 'confirm' as const,
        title: '',
        message: '',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        closeDialog: vi.fn(),
        showAlert: dialogs.showAlert,
        showConfirm: dialogs.showConfirm,
        showUnsyncedDataLogout: dialogs.showUnsyncedDataLogout,
    };
    const useDialogStore = Object.assign(
        (selector?: (value: typeof state) => unknown) => selector ? selector(state) : state,
        { getState: () => state }
    );
    return { useDialogStore };
});

vi.mock('../src/lib/export', () => ({
    Exporter: exporter,
}));

const authenticatedUser = { uid: 'logout-user', email: 'logout@example.com', displayName: 'Logout User' } as any;
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const userData = () => parse({
    profile: { height: '175' },
    routines: [{ id: 'routine-1', name: 'Persisted routine', exercises: [] }],
});

const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(AuthProvider, null, children);

function renderAuth() {
    return renderHook(() => useAuth(), { wrapper });
}

beforeEach(() => {
    useAppStore.getState().resetStore();
    localStorage.clear();
    vi.clearAllMocks();

    useAppStore.setState({
        userData: userData(),
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
    vi.mocked(DB.secureLogOut).mockResolvedValue(undefined);
    vi.mocked(DB.purgeAllLocalUserData).mockResolvedValue(undefined);
    vi.mocked(waitForPendingWrites).mockResolvedValue(undefined);
    dialogs.showAlert.mockResolvedValue(undefined);
    dialogs.showConfirm.mockResolvedValue(true);
    dialogs.showUnsyncedDataLogout.mockResolvedValue('cancel');
});

describe('M5 logout protection through AuthProvider', () => {
    it('keeps guest data when the destructive logout confirmation is cancelled, then purges it when confirmed', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        (auth as any).currentUser = null;
        vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
            callback(null);
            return () => {};
        });
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

    it('executes the authenticated safe logout through DB and resets the in-memory session', async () => {
        const { result } = renderAuth();
        await waitFor(() => expect(result.current.currentUser?.uid).toBe('logout-user'));

        await act(async () => {
            await result.current.logout({ mode: 'normal' });
        });

        expect(DB.secureLogOut).toHaveBeenCalledTimes(1);
        expect(DB.resetCache).toHaveBeenCalledTimes(1);
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
        expect(useAppStore.getState().syncing).toBe(false);
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

        expect(dialogs.showAlert).toHaveBeenCalledWith('Errore durante il logout. Controlla la connessione.');
        expect(useAppStore.getState().userData?.routines?.[0]?.id).toBe('routine-1');
        expect(useAppStore.getState().syncing).toBe(false);
        consoleError.mockRestore();
    });
});
