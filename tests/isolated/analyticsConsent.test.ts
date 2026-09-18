import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ getAnalytics: vi.fn(() => ({ name: 'analytics-test' })), isSupported: vi.fn(), setAnalyticsCollectionEnabled: vi.fn() }));
vi.mock('firebase/analytics', () => sdk);
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', async importOriginal => ({
    ...await importOriginal<typeof import('firebase/auth')>(),
    getAuth: vi.fn(() => ({})), setPersistence: vi.fn(async () => {}),
}));

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sdk.isSupported.mockResolvedValue(true);
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
    for (const key of ['API_KEY', 'AUTH_DOMAIN', 'DATABASE_URL', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID', 'MEASUREMENT_ID']) vi.stubEnv(`VITE_FIREBASE_${key}`, 'isolated-test');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('disables the initialized SDK immediately on revocation and supports a later grant', async () => {
    const firebase = await import('../../src/lib/firebase');
    firebase.setAnalyticsConsent(true);
    expect(await firebase.getConsentedAnalytics()).toEqual({ name: 'analytics-test' });
    expect(sdk.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith({ name: 'analytics-test' }, true);

    firebase.setAnalyticsConsent(false);
    expect(sdk.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith({ name: 'analytics-test' }, false);
    expect(await firebase.getConsentedAnalytics()).toBeNull();

    firebase.setAnalyticsConsent(true);
    expect(await firebase.getConsentedAnalytics()).toEqual({ name: 'analytics-test' });
    expect(sdk.getAnalytics).toHaveBeenCalledTimes(1);
    expect(sdk.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith({ name: 'analytics-test' }, true);
});

it('does not enable collection after a pending grant has been revoked', async () => {
    let resolveSupport!: (value: boolean) => void;
    sdk.isSupported.mockImplementation(() => new Promise(resolve => { resolveSupport = resolve; }));
    const firebase = await import('../../src/lib/firebase');
    firebase.setAnalyticsConsent(true);
    const pending = firebase.getConsentedAnalytics();
    firebase.setAnalyticsConsent(false);
    resolveSupport(true);

    expect(await pending).toBeNull();
    expect(sdk.getAnalytics).not.toHaveBeenCalled();
    expect(sdk.setAnalyticsCollectionEnabled).not.toHaveBeenCalled();
});

it('awaits delayed Analytics readiness when consent was already stored', async () => {
    let resolveSupport!: (value: boolean) => void;
    sdk.isSupported.mockImplementation(() => new Promise(resolve => { resolveSupport = resolve; }));
    vi.mocked(localStorage.getItem).mockReturnValue('true');

    const firebase = await import('../../src/lib/firebase');
    const pending = firebase.getConsentedAnalytics();
    expect(sdk.getAnalytics).not.toHaveBeenCalled();

    resolveSupport(true);
    expect(await pending).toEqual({ name: 'analytics-test' });
    expect(sdk.getAnalytics).toHaveBeenCalledTimes(1);
    expect(sdk.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith({ name: 'analytics-test' }, true);
});

it('revokes the SDK even if persisting the preference fails', async () => {
    const firebase = await import('../../src/lib/firebase');
    firebase.setAnalyticsConsent(true);
    await firebase.getConsentedAnalytics();
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('blocked storage'); });
    firebase.setAnalyticsConsent(false);
    expect(sdk.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith({ name: 'analytics-test' }, false);
    expect(firebase.getAnalyticsConsent()).toBe(false);
});
