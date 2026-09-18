import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
    currentUser: null as { uid: string } | null,
    loading: false,
    isGuest: true,
    guestMigrationStatus: 'idle' as 'idle' | 'pending' | 'failed',
    login: async () => {},
    loginAsGuest: async () => {},
    linkGoogleAccount: async () => {},
    retryGuestMigration: vi.fn(async () => {}),
    logout: async () => {},
    loginWithEmail: async () => {},
    registerWithEmail: async () => {},
}));

vi.mock('../src/hooks/useAuth', () => ({
    useAuth: () => authState,
}));

vi.mock('../src/lib/firebase', () => ({
    analytics: null,
    getAnalyticsConsent: () => false,
    getConsentedAnalytics: async () => null,
}));

vi.mock('firebase/analytics', () => ({
    logEvent: vi.fn(),
}));

vi.mock('@vercel/analytics/react', () => ({
    Analytics: () => null,
}));

vi.mock('@vercel/speed-insights/react', () => ({
    SpeedInsights: () => null,
}));

vi.mock('../src/components/UI/ErrorBoundary', () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../src/components/UI/BottomNav', () => ({
    default: () => <nav data-testid="bottom-nav" />,
}));

vi.mock('../src/components/UI/GlobalDialog', () => ({
    GlobalDialog: () => null,
}));

vi.mock('../src/components/UI/ReloadPrompt', () => ({
    default: () => null,
}));

vi.mock('../src/components/UI/InstallPrompt', () => ({
    InstallPrompt: () => null,
}));

vi.mock('../src/components/UI/ConsentOverlay', () => ({
    ConsentOverlay: () => null,
}));

vi.mock('../src/components/UI/LoginBox', () => ({
    LoginBox: ({ onCancel }: { onCancel?: () => void }) => (
        <div data-testid="guest-login-box">
            <button type="button" onClick={onCancel}>Torna alla modalità locale</button>
        </div>
    ),
}));

vi.mock('../src/components/Home/HomeView', () => ({
    default: () => <div>Home view</div>,
}));
vi.mock('../src/components/Training/TrainingView', () => ({
    default: () => <div>Training view</div>,
}));
vi.mock('../src/components/Nutrition/NutritionView', () => ({
    default: () => <div>Nutrition view</div>,
}));
vi.mock('../src/components/Data/DataView', () => ({
    default: () => <div>Data view</div>,
}));
vi.mock('../src/components/SettingsView', () => ({
    default: () => <div>Settings view</div>,
}));

import App from '../src/App';
import { useAppStore } from '../src/store/useAppStore';

const OVERLAY_SESSION_KEY = 'logbook_guest_login_overlay';

describe('guest login overlay lifecycle', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        authState.currentUser = null;
        authState.loading = false;
        authState.isGuest = true;
        authState.guestMigrationStatus = 'idle';
        authState.retryGuestMigration.mockClear();
        useAppStore.getState().resetStore({ force: true });
        useAppStore.getState().setSyncing(false);
    });

    it('blocks bottom navigation, survives account transition, then closes after migration settles', async () => {
        render(<App />);

        expect(screen.getByTestId('bottom-nav')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Accedi' }));

        expect(screen.getByTestId('guest-login-box')).toBeTruthy();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBe('true');

        authState.currentUser = { uid: 'user-a' };
        authState.isGuest = true;
        authState.guestMigrationStatus = 'pending';
        act(() => {
            useAppStore.getState().setSyncing(true);
        });

        expect(screen.queryByTestId('guest-login-box')).toBeNull();
        expect(screen.getByText('Preparazione account...')).toBeTruthy();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();

        authState.isGuest = false;
        authState.guestMigrationStatus = 'idle';
        act(() => {
            useAppStore.getState().setSyncing(false);
        });

        await waitFor(() => {
            expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        });
        expect(screen.queryByTestId('guest-login-box')).toBeNull();
        expect(screen.getByTestId('bottom-nav')).toBeTruthy();
    });

    it('restores the guest login overlay from sessionStorage after a remount', () => {
        sessionStorage.setItem(OVERLAY_SESSION_KEY, 'true');

        const firstRender = render(<App />);
        expect(screen.getByTestId('guest-login-box')).toBeTruthy();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();

        firstRender.unmount();
        render(<App />);

        expect(screen.getByTestId('guest-login-box')).toBeTruthy();
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

        fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
        await waitFor(() => expect(authState.retryGuestMigration).toHaveBeenCalledTimes(1));

        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBe('true');
    });
});
