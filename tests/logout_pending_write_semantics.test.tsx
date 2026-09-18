import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForPendingWrites } from 'firebase/firestore';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { auth, onAuthStateChanged } from '../src/lib/firebase';
import { DB } from '../src/lib/db';
import { UserDataSchema } from '../src/lib/schema';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';

const user = { uid: 'pending-write-user', email: 'sync@example.com' } as any;
const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(AuthProvider, null, children);

beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    (auth as any).currentUser = user;
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
        callback(user);
        return () => {};
    });
    vi.mocked(DB.loadCloudPayload).mockResolvedValue(null);
    vi.mocked(DB.secureLogOut).mockResolvedValue(undefined);
    useAppStore.setState({
        userData: UserDataSchema.parse({ profile: { height: '180' } }) as any,
        localWorkout: null,
        syncing: false,
        saveError: null,
        syncHealth: 'local-pending',
        compatibilityStatus: 'ok',
        compatibilityError: null,
    });
    vi.mocked(useDialogStore.getState().showUnsyncedDataLogout).mockResolvedValue('cancel');
});

describe('logout pending-write error semantics', () => {
    it('surfaces permission-denied as rejected instead of calling it offline', async () => {
        vi.mocked(waitForPendingWrites).mockRejectedValueOnce({ code: 'permission-denied' });
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.currentUser?.uid).toBe(user.uid));

        await act(async () => {
            await result.current.logout({ mode: 'normal' });
        });

        expect(useDialogStore.getState().showUnsyncedDataLogout).toHaveBeenCalledWith('rejected');
        expect(DB.secureLogOut).not.toHaveBeenCalled();
    });

    it('surfaces unknown pending-write failures as failed', async () => {
        vi.mocked(waitForPendingWrites).mockRejectedValueOnce(new Error('unexpected SDK failure'));
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.currentUser?.uid).toBe(user.uid));

        await act(async () => {
            await result.current.logout({ mode: 'normal' });
        });

        expect(useDialogStore.getState().showUnsyncedDataLogout).toHaveBeenCalledWith('failed');
        expect(DB.secureLogOut).not.toHaveBeenCalled();
        consoleWarn.mockRestore();
    });
});
