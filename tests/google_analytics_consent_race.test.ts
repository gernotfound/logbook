import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const analytics = vi.hoisted(() => ({
    isSupported: vi.fn(),
    initializeAnalytics: vi.fn(() => ({ id: 'analytics' })),
    setAnalyticsCollectionEnabled: vi.fn(),
    logEvent: vi.fn(),
}));

vi.mock('../src/lib/firebase', () => ({
    firebaseApp: { name: 'test-app' },
}));

vi.mock('firebase/analytics', () => analytics);

describe('GA4 consent race', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubEnv('VITE_FIREBASE_MEASUREMENT_ID', 'G-TEST');
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('does not initialize or emit after consent is revoked while support detection is pending', async () => {
        let resolveSupported!: (supported: boolean) => void;
        analytics.isSupported.mockReturnValueOnce(new Promise<boolean>(resolve => {
            resolveSupported = resolve;
        }));

        localStorage.setItem('logbook_ga4_consent_v1', 'true');
        const consent = await import('../src/lib/analyticsConsent');
        const module = await import('../src/lib/googleAnalytics');

        module.initOptionalGoogleAnalytics();
        await vi.waitFor(() => expect(analytics.isSupported).toHaveBeenCalledTimes(1));

        expect(consent.setAnalyticsConsent(false)).toBe(true);
        resolveSupported(true);
        await Promise.resolve();
        await Promise.resolve();

        expect(analytics.initializeAnalytics).not.toHaveBeenCalled();
        expect(analytics.setAnalyticsCollectionEnabled).not.toHaveBeenCalled();
        expect(analytics.logEvent).not.toHaveBeenCalled();
    });
});
