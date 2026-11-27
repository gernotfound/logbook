import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
    currentUser: null as { uid: string } | null,
    loading: false,
    isGuest: true,
    guestMigrationStatus: 'idle' as 'idle' | 'pending' | 'failed',
    emailVerificationRequired: false,
    refreshEmailVerification: vi.fn(async () => {}),
    resendEmailVerification: vi.fn(async () => {}),
    continueUnverifiedLocally: vi.fn(async () => {}),
    login: async () => {},
    loginAsGuest: async () => {},
    linkGoogleAccount: async () => {},
    retryGuestMigration: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    loginWithEmail: async () => {},
    registerWithEmail: async () => {},
}));

vi.mock('../../../src/hooks/useAuth', () => ({
    useAuth: () => authState,
}));



vi.mock('../../../src/components/UI/ErrorBoundary', () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../src/components/UI/BottomNav', () => ({
    default: () => <nav data-testid="bottom-nav" />,
}));

vi.mock('../../../src/components/UI/GlobalDialog', () => ({
    GlobalDialog: () => <div data-testid="global-dialog" />,
}));

vi.mock('../../../src/components/UI/ReloadPrompt', () => ({
    default: () => null,
}));


vi.mock('../../../src/components/UI/ConsentOverlay', () => ({
    ConsentOverlay: () => null,
}));

vi.mock('../../../src/components/UI/KindeAccountEntry', () => ({
    KindeAccountEntry: () => <div data-testid="kinde-identity-entry" />,
}));

vi.mock('../../../src/components/Home/HomeView', () => ({
    default: () => <div>Home view</div>,
}));
vi.mock('../../../src/components/Training/TrainingView', () => ({
    default: () => <div>Training view</div>,
}));
vi.mock('../../../src/components/Nutrition/NutritionView', () => ({
    default: () => <div>Nutrition view</div>,
}));
vi.mock('../../../src/components/Data/DataView', () => ({
    default: () => <div>Data view</div>,
}));
vi.mock('../../../src/components/SettingsView', () => ({
    default: () => <div>Settings view</div>,
}));

import App from '../../../src/App';
import { useAppStore } from '../../../src/store/useAppStore';

const OVERLAY_SESSION_KEY = 'logbook_guest_login_overlay';

describe('guest login overlay presentation only (useAuth mocked; not a Firebase lifecycle test)', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        authState.currentUser = null;
        authState.loading = false;
        authState.isGuest = true;
        authState.guestMigrationStatus = 'idle';
        authState.emailVerificationRequired = false;
        authState.retryGuestMigration.mockClear();
        authState.logout.mockClear();
        useAppStore.getState().resetStore({ force: true });
        useAppStore.getState().setSyncing(false);
    });

    it('shows the email-verification barrier before account views or navigation', async () => {
        authState.currentUser = { uid: 'pending-email' };
        authState.isGuest = false;
        authState.emailVerificationRequired = true;
        render(<App />);
        expect(await screen.findByRole('heading', { name: 'Verifica la tua email' })).toBeTruthy();
        expect(screen.queryByText('Home view')).toBeNull();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(screen.getByTestId('global-dialog')).toBeTruthy();
    });

    it('mounts the identity-only Kinde boundary for unauthenticated visitors', () => {
        authState.isGuest = false;
        render(<App />);
        expect(screen.getByTestId('global-dialog')).toBeTruthy();
        expect(screen.getByTestId('kinde-identity-entry')).toBeTruthy();
        expect(screen.queryByRole('dialog', { name: 'Passaggio a Kinde non disponibile' })).toBeNull();
    });

    it('blocks bottom navigation, survives account transition, then closes after migration settles', async () => {
        render(<App />);

        expect(screen.getByTestId('bottom-nav')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Accedi' }));

        expect(screen.getByRole('dialog', { name: 'Passaggio a Kinde non disponibile' })).toBeTruthy();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBe('true');

        authState.currentUser = { uid: 'user-a' };
        authState.isGuest = true;
        authState.guestMigrationStatus = 'pending';
        act(() => {
            useAppStore.getState().setSyncing(true);
        });

        expect(screen.queryByRole('dialog', { name: 'Passaggio a Kinde non disponibile' })).toBeNull();
        expect(screen.getByRole('status', { name: 'Preparazione account in corso' })).toBeTruthy();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();

        authState.isGuest = false;
        authState.guestMigrationStatus = 'idle';
        act(() => {
            useAppStore.getState().setSyncing(false);
        });

        await waitFor(() => {
            expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        });
        expect(screen.queryByRole('dialog', { name: 'Passaggio a Kinde non disponibile' })).toBeNull();
        expect(screen.getByTestId('bottom-nav')).toBeTruthy();
    });

    it('traps focus and restores the guest entry after Escape without invoking sign-in', () => {
        render(<App />);
        const open = screen.getByRole('button', { name: 'Accedi' });
        fireEvent.click(open);
        const dialog = screen.getByRole('dialog', { name: 'Passaggio a Kinde non disponibile' });
        const close = screen.getByRole('button', { name: 'Torna alla modalità locale' });
        expect(document.activeElement).toBe(close);
        fireEvent.keyDown(dialog, { key: 'Tab' });
        expect(document.activeElement).toBe(close);
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        expect(document.activeElement).toBe(open);
        expect(screen.getByTestId('bottom-nav')).toBeTruthy();
        expect(authState.logout).not.toHaveBeenCalled();
    });

    it('shows an exit action next to login and delegates to the guarded guest logout flow', async () => {
        render(<App />);

        expect(screen.getByRole('button', { name: 'Accedi' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Esci' }));

        await waitFor(() => {
            expect(authState.logout).toHaveBeenCalledWith({ mode: 'normal' });
        });
    });

    it('restores the guest login overlay from sessionStorage after a remount', () => {
        sessionStorage.setItem(OVERLAY_SESSION_KEY, 'true');

        const firstRender = render(<App />);
        expect(screen.getByRole('dialog', { name: 'Passaggio a Kinde non disponibile' })).toBeTruthy();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();

        firstRender.unmount();
        render(<App />);

        expect(screen.getByRole('dialog', { name: 'Passaggio a Kinde non disponibile' })).toBeTruthy();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBe('true');
    });

    it('keeps the overlay blocking after a migration failure and retries explicitly', async () => {
        render(<App />);
        fireEvent.click(screen.getByRole('button', { name: 'Accedi' }));

        authState.currentUser = { uid: 'user-a' };
        authState.isGuest = true;
        authState.guestMigrationStatus = 'failed';
        act(() => {
            useAppStore.getState().setSyncing(true);
        });
        act(() => {
            useAppStore.getState().setSyncing(false);
        });

        expect(screen.getByText('Accesso non completato')).toBeTruthy();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: 'Trasferisci i progressi nell’account' }));
        await waitFor(() => expect(authState.retryGuestMigration).toHaveBeenCalledWith('merge'));

        fireEvent.click(screen.getByRole('button', { name: 'Non trasferire i progressi' }));
        await waitFor(() => expect(authState.retryGuestMigration).toHaveBeenCalledWith('skip'));

        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBe('true');
    });
});
