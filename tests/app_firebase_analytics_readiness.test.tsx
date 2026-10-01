import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsHarness = vi.hoisted(() => ({
    consent: false,
    listeners: new Set<(consent: boolean) => void>(),
    apply: vi.fn(async (_enabled: boolean) => undefined),
}));

const storeState = vi.hoisted(() => ({
    syncing: false,
    userData: null as any,
    saveError: null as string | null,
    setSaveError: vi.fn(),
    compatibilityStatus: 'compatible',
    compatibilityError: null as string | null,
}));

vi.mock('../src/hooks/useAuth', () => ({
    useAuth: () => ({
        currentUser: { uid: 'analytics-user' },
        loading: false,
        isGuest: false,
        guestMigrationStatus: 'idle',
        retryGuestMigration: vi.fn(),
    }),
}));

vi.mock('../src/store/useAppStore', () => {
    const useAppStore = Object.assign(
        (selector: (state: typeof storeState) => unknown) => selector(storeState),
        { getState: () => storeState }
    );
    return { useAppStore };
});

vi.mock('../src/lib/analyticsConsent', () => ({
    getAnalyticsConsent: () => analyticsHarness.consent,
    subscribeAnalyticsConsent: (listener: (consent: boolean) => void) => {
        analyticsHarness.listeners.add(listener);
        return () => analyticsHarness.listeners.delete(listener);
    },
}));

vi.mock('../src/lib/firebaseAnalytics', () => ({
    applyFirebaseAnalyticsConsent: analyticsHarness.apply,
}));

vi.mock('../src/components/UI/ErrorBoundary', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../src/components/UI/BottomNav', () => ({ default: () => null }));
vi.mock('../src/components/UI/GlobalDialog', () => ({ GlobalDialog: () => null }));
vi.mock('../src/components/UI/ReloadPrompt', () => ({ default: () => null }));
vi.mock('../src/components/UI/ConsentOverlay', () => ({ ConsentOverlay: () => null }));
vi.mock('../src/components/UI/LoginBox', () => ({ LoginBox: () => null }));
vi.mock('../src/components/Home/HomeView', () => ({ default: () => <div>Home</div> }));
vi.mock('../src/components/Training/TrainingView', () => ({ default: () => <div>Training</div> }));
vi.mock('../src/components/Nutrition/NutritionView', () => ({ default: () => <div>Nutrition</div> }));
vi.mock('../src/components/Data/DataView', () => ({ default: () => <div>Data</div> }));
vi.mock('../src/components/SettingsView', () => ({ default: () => <div>Settings</div> }));

import App from '../src/App';

describe('App Firebase Analytics consent boundary', () => {
    beforeEach(() => {
        analyticsHarness.consent = false;
        analyticsHarness.listeners.clear();
        analyticsHarness.apply.mockClear();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('applies disabled analytics on startup and reacts immediately to consent changes', async () => {
        render(<App />);
        await screen.findByText('Home');
        await waitFor(() => expect(analyticsHarness.apply).toHaveBeenCalledWith(false));

        analyticsHarness.consent = true;
        act(() => {
            for (const listener of analyticsHarness.listeners) listener(true);
        });
        await waitFor(() => expect(analyticsHarness.apply).toHaveBeenCalledWith(true));

        analyticsHarness.consent = false;
        act(() => {
            for (const listener of analyticsHarness.listeners) listener(false);
        });
        await waitFor(() => expect(analyticsHarness.apply).toHaveBeenLastCalledWith(false));
    });
});
