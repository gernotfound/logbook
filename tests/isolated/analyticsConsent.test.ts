import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let stored = new Map<string, string>();

beforeEach(() => {
    vi.resetModules();
    stored = new Map();
    vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => stored.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => { stored.set(key, value); }),
        removeItem: vi.fn((key: string) => { stored.delete(key); }),
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

it('defaults Google Analytics to disabled and persists explicit choices', async () => {
    const consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(false);

    expect(consent.setAnalyticsConsent(true)).toBe(true);
    expect(consent.getAnalyticsConsent()).toBe(true);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('logbook_google_analytics_consent_v1', 'true');

    expect(consent.setAnalyticsConsent(false)).toBe(true);
    expect(consent.getAnalyticsConsent()).toBe(false);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('logbook_google_analytics_consent_v1', 'false');
});

it('does not inherit the retired Vercel Analytics opt-in', async () => {
    stored.set('logbook_analytics_consent', 'true');
    const consent = await import('../../src/lib/analyticsConsent');

    expect(consent.getAnalyticsConsent()).toBe(false);
    expect(localStorage.removeItem).toHaveBeenCalledWith('logbook_analytics_consent');
});

it('restores only the provider-specific Google Analytics opt-in after a module reload', async () => {
    stored.set('logbook_google_analytics_consent_v1', 'true');
    let consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(true);

    vi.resetModules();
    consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(true);
    expect(localStorage.getItem).toHaveBeenCalledWith('logbook_google_analytics_consent_v1');
});

it('fails closed when enabling Analytics cannot be persisted', async () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('blocked storage'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consent = await import('../../src/lib/analyticsConsent');

    expect(consent.setAnalyticsConsent(true)).toBe(false);
    expect(consent.getAnalyticsConsent()).toBe(false);
    expect(warn).toHaveBeenCalledWith('Impossibile memorizzare la preferenza Analytics:', expect.any(Error));
});

it('keeps the current session revoked and reports failure when revocation cannot be persisted', async () => {
    stored.set('logbook_google_analytics_consent_v1', 'true');
    const consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(true);

    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('blocked write'); });
    vi.mocked(localStorage.removeItem).mockImplementation(() => { throw new Error('blocked remove'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warn.mockClear();

    expect(consent.setAnalyticsConsent(false)).toBe(false);
    expect(consent.getAnalyticsConsent()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
});
