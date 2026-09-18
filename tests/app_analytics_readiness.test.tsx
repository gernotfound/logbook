import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsHarness = vi.hoisted(() => ({
    consent: true,
    getConsentedAnalytics: vi.fn<() => Promise<any>>(),
    logEvent: vi.fn(),
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

vi.mock('../src/lib/firebase', () => ({
    getAnalyticsConsent: () => analyticsHarness.consent,
    getConsentedAnalytics: analyticsHarness.getConsentedAnalytics,
}));

vi.mock('firebase/analytics', () => ({
    logEvent: analyticsHarness.logEvent,
}));

vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }));
vi.mock('@vercel/speed-insights/react', () => ({ SpeedInsights: () => null }));
vi.mock('../src/components/UI/ErrorBoundary', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../src/components/UI/BottomNav', () => ({ default: () => null }));
vi.mock('../src/components/UI/GlobalDialog', () => ({ GlobalDialog: () => null }));
vi.mock('../src/components/UI/ReloadPrompt', () => ({ default: () => null }));
vi.mock('../src/components/UI/InstallPrompt', () => ({ InstallPrompt: () => null }));
vi.mock('../src/components/UI/ConsentOverlay', () => ({ ConsentOverlay: () => null }));
vi.mock('../src/components/UI/LoginBox', () => ({ LoginBox: () => null }));
vi.mock('../src/components/Home/HomeView', () => ({ default: () => <div>Home</div> }));
vi.mock('../src/components/Training/TrainingView', () => ({ default: () => <div>Training</div> }));
vi.mock('../src/components/Nutrition/NutritionView', () => ({ default: () => <div>Nutrition</div> }));
vi.mock('../src/components/Data/DataView', () => ({ default: () => <div>Data</div> }));
vi.mock('../src/components/SettingsView', () => ({ default: () => <div>Settings</div> }));

import App from '../src/App';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => { resolve = res; });
    return { promise, resolve };
}

describe('App Firebase Analytics readiness', () => {
    beforeEach(() => {
        analyticsHarness.consent = true;
        analyticsHarness.getConsentedAnalytics.mockReset();
        analyticsHarness.logEvent.mockReset();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('emits the initial screen_view after delayed cold-start Analytics readiness without navigation', async () => {
        const readiness = deferred<any>();
        analyticsHarness.getConsentedAnalytics.mockReturnValue(readiness.promise);

        render(<App />);

        await waitFor(() => expect(analyticsHarness.getConsentedAnalytics).toHaveBeenCalledTimes(1));
        expect(analyticsHarness.logEvent).not.toHaveBeenCalled();

        await act(async () => {
            readiness.resolve({ name: 'analytics-test' });
            await readiness.promise;
        });

        await waitFor(() => expect(analyticsHarness.logEvent).toHaveBeenCalledWith(
            { name: 'analytics-test' },
            'screen_view',
            { screen_name: 'home', screen_class: 'App' }
        ));
    });

    it('emits the current screen_view when consent is granted before Analytics becomes ready', async () => {
        analyticsHarness.consent = false;
        const readiness = deferred<any>();
        analyticsHarness.getConsentedAnalytics.mockReturnValue(readiness.promise);

        render(<App />);
        expect(analyticsHarness.getConsentedAnalytics).not.toHaveBeenCalled();

        analyticsHarness.consent = true;
        act(() => {
            window.dispatchEvent(new Event('analytics_consent_changed'));
        });

        await waitFor(() => expect(analyticsHarness.getConsentedAnalytics).toHaveBeenCalledTimes(1));
        expect(analyticsHarness.logEvent).not.toHaveBeenCalled();

        await act(async () => {
            readiness.resolve({ name: 'analytics-test' });
            await readiness.promise;
        });

        await waitFor(() => expect(analyticsHarness.logEvent).toHaveBeenCalledWith(
            { name: 'analytics-test' },
            'screen_view',
            { screen_name: 'home', screen_class: 'App' }
        ));
    });
});
