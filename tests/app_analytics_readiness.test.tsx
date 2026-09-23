import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsHarness = vi.hoisted(() => ({ consent: false }));

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
}));

vi.mock('@vercel/analytics/react', () => ({ Analytics: () => <div data-testid="vercel-analytics" /> }));
vi.mock('@vercel/speed-insights/react', () => ({ SpeedInsights: () => <div data-testid="vercel-speed-insights" /> }));
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
        localStorage.clear();
        sessionStorage.clear();
    });

    it('keeps Vercel analytics disabled by default', async () => {
        render(<App />);
        await screen.findByText('Home');
        expect(screen.queryByTestId('vercel-analytics')).toBeNull();
        expect(screen.queryByTestId('vercel-speed-insights')).toBeNull();
    });

    it('enables only the Vercel analytics components after opt-in changes', async () => {
        render(<App />);
        await screen.findByText('Home');
        analyticsHarness.consent = true;
        act(() => window.dispatchEvent(new Event('analytics_consent_changed')));

        await waitFor(() => expect(screen.getByTestId('vercel-analytics')).toBeDefined());
        expect(screen.getByTestId('vercel-speed-insights')).toBeDefined();
    });
});
