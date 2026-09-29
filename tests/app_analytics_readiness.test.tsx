import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsHarness = vi.hoisted(() => ({
    consent: false,
    listeners: new Set<(consent: boolean) => void>(),
    analyticsBeforeSend: null as ((event: unknown) => unknown) | null,
    speedBeforeSend: null as ((event: unknown) => unknown) | null,
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

vi.mock('@vercel/analytics/react', () => ({
    Analytics: ({ beforeSend }: { beforeSend?: (event: unknown) => unknown }) => {
        analyticsHarness.analyticsBeforeSend = beforeSend ?? null;
        return <div data-testid="vercel-analytics" />;
    },
}));
vi.mock('@vercel/speed-insights/react', () => ({
    SpeedInsights: ({ beforeSend }: { beforeSend?: (event: unknown) => unknown }) => {
        analyticsHarness.speedBeforeSend = beforeSend ?? null;
        return <div data-testid="vercel-speed-insights" />;
    },
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

describe('App optional analytics consent', () => {
    beforeEach(() => {
        analyticsHarness.consent = false;
        analyticsHarness.listeners.clear();
        analyticsHarness.analyticsBeforeSend = null;
        analyticsHarness.speedBeforeSend = null;
        localStorage.clear();
        sessionStorage.clear();
    });

    it('keeps Vercel analytics disabled by default', async () => {
        render(<App />);
        await screen.findByText('Home');
        expect(screen.queryByTestId('vercel-analytics')).toBeNull();
        expect(screen.queryByTestId('vercel-speed-insights')).toBeNull();
    });

    it('mounts and unmounts the Vercel analytics components when consent changes', async () => {
        render(<App />);
        await screen.findByText('Home');

        analyticsHarness.consent = true;
        act(() => {
            for (const listener of analyticsHarness.listeners) listener(true);
        });

        await waitFor(() => expect(screen.getByTestId('vercel-analytics')).toBeDefined());
        expect(screen.getByTestId('vercel-speed-insights')).toBeDefined();

        const event = { type: 'pageview' };
        expect(analyticsHarness.analyticsBeforeSend?.(event)).toBe(event);
        expect(analyticsHarness.speedBeforeSend?.(event)).toBe(event);

        analyticsHarness.consent = false;
        act(() => {
            for (const listener of analyticsHarness.listeners) listener(false);
        });

        await waitFor(() => expect(screen.queryByTestId('vercel-analytics')).toBeNull());
        expect(screen.queryByTestId('vercel-speed-insights')).toBeNull();
        expect(analyticsHarness.analyticsBeforeSend?.(event)).toBeNull();
        expect(analyticsHarness.speedBeforeSend?.(event)).toBeNull();
    });
});
