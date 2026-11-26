import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    actor: { uid: 'user-before-consent', providerData: [{ providerId: 'password' }] },
    entered: null as null | (() => void),
    loading: null as null | Promise<void>,
    confirm: vi.fn(),
    alert: vi.fn(),
    reauth: vi.fn(),
    logout: vi.fn(),
}));

vi.mock('../../../src/hooks/useAuth', () => ({
    useAuth: () => ({ currentUser: state.actor, isGuest: true, logout: state.logout }),
}));
vi.mock('../../../src/store/useDialogStore', () => ({
    useDialogStore: (selector: (value: { showConfirm: typeof state.confirm; showAlert: typeof state.alert; showPasswordPrompt: typeof state.confirm }) => unknown) => selector({
        showConfirm: state.confirm, showAlert: state.alert, showPasswordPrompt: vi.fn(),
    }),
}));
vi.mock('../../../src/lib/firebase', async () => {
    state.entered?.();
    if (state.loading) await state.loading;
    return { auth: { currentUser: state.actor } };
});
vi.mock('../../../src/lib/auth/recentAuth', () => ({
    reauthenticateForSensitiveAction: state.reauth,
}));

import { useSettings } from '../../../src/hooks/useSettings';
import { activateGuestSession, GUEST_SESSION_KEY, invalidateSession } from '../../../src/lib/sync/session';
import { DB } from '../../../src/lib/db';

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, 'guest-before-account-consent');
    activateGuestSession('guest-before-account-consent');
    state.confirm.mockResolvedValue(true);
    state.alert.mockResolvedValue(undefined);
    state.loading = null;
    state.entered = null;
});

describe('Legacy settings imports are fenced by their initiating session', () => {
    it('does not reauthenticate or delete after A→B→A while the Firebase module loads', async () => {
        let markEntered!: () => void;
        let resumeImport!: () => void;
        const entered = new Promise<void>(resolve => { markEntered = resolve; });
        state.loading = new Promise<void>(resolve => { resumeImport = resolve; });
        state.entered = markEntered;
        const deleteAccount = vi.spyOn(DB, 'deleteAccount');

        const { result } = renderHook(() => useSettings());
        let deletion!: Promise<void>;
        act(() => { deletion = result.current.handleDeleteAccount(); });
        await entered;
        invalidateSession();
        resumeImport();
        await act(async () => { await deletion; });

        expect(state.confirm).not.toHaveBeenCalled();
        expect(state.reauth).not.toHaveBeenCalled();
        expect(deleteAccount).not.toHaveBeenCalled();
        expect(state.logout).not.toHaveBeenCalled();
        expect(state.alert).not.toHaveBeenCalled();
        deleteAccount.mockRestore();
    });
});
