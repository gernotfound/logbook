import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => ({
    logout: vi.fn(),
    showConfirm: vi.fn(),
    showAlert: vi.fn(),
    showPasswordPrompt: vi.fn(),
}));

vi.mock('../../../src/hooks/useAuth', () => ({
    useAuth: () => ({ currentUser: null, isGuest: true, logout: ui.logout }),
}));
vi.mock('../../../src/store/useDialogStore', () => ({
    useDialogStore: (selector: (state: typeof ui) => unknown) => selector(ui),
}));
vi.mock('../../../src/lib/firebase', () => { throw new Error('Guest settings loaded Firebase'); });
vi.mock('../../../src/lib/auth/recentAuth', () => { throw new Error('Guest settings loaded recent Auth'); });
vi.mock('../../../src/lib/auth/revokeSessions', () => { throw new Error('Guest settings loaded session revocation'); });
vi.mock('../../../src/lib/healthDataErasure', () => { throw new Error('Guest settings loaded cloud erasure'); });
vi.mock('../../../src/lib/db/db_account', () => { throw new Error('Guest settings loaded account purge'); });

import { useSettings } from '../../../src/hooks/useSettings';
import { AccountCard } from '../../../src/components/UI/AccountCard';
import { activateGuestSession, GUEST_SESSION_KEY, invalidateSession } from '../../../src/lib/sync/session';

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, 'guest-settings-generation');
    activateGuestSession('guest-settings-generation');
    ui.showConfirm.mockResolvedValue(true);
    ui.showAlert.mockResolvedValue(undefined);
    ui.logout.mockResolvedValue(undefined);
});

describe('Settings guest boundary', () => {
    it('renders and exits the guest account card without loading legacy account modules', () => {
        const view = render(<AccountCard />);
        expect(screen.getByRole('heading', { name: 'Modalità locale' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Esci dalla modalità locale' }));
        expect(ui.logout).toHaveBeenCalledOnce();
        view.unmount();
    });

    it('keeps the App startup import independent of Firebase-only gates', async () => {
        const { default: App } = await import('../../../src/App');
        expect(typeof App).toBe('function');
    });

    it('renders account/profile/transfer hooks without loading any Firebase-only module', () => {
        const { result } = renderHook(() => useSettings());
        expect(result.current.currentUser).toBeNull();
        expect(result.current.pendingAccountDeletion).toBe(false);
        expect(result.current.erasingHealthData).toBe(false);
    });

    it('delegates confirmed guest-data deletion only to the guest logout lifecycle', async () => {
        const { result } = renderHook(() => useSettings());
        await act(async () => result.current.handleDeleteAccount());
        expect(ui.showConfirm).toHaveBeenCalledOnce();
        expect(ui.logout).toHaveBeenCalledWith({ mode: 'force' });
    });

    it('does not delete a replacement guest generation after asynchronous confirmation', async () => {
        ui.showConfirm.mockImplementationOnce(async () => {
            invalidateSession();
            return true;
        });
        const { result } = renderHook(() => useSettings());
        await act(async () => result.current.handleDeleteAccount());
        expect(ui.logout).not.toHaveBeenCalled();
    });

    it('does not initiate a cloud deletion from a guest-only session', async () => {
        const { result } = renderHook(() => useSettings());
        await act(async () => result.current.handleDeleteHealthData());
        expect(ui.showConfirm).not.toHaveBeenCalled();
        expect(ui.showAlert).toHaveBeenCalledWith('La cancellazione cloud richiede un account autenticato.', 'Cancellazione da verificare');
    });
});
