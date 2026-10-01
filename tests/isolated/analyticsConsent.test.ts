import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let storedValue: string | null;

beforeEach(() => {
    vi.resetModules();
    storedValue = null;
    vi.stubGlobal('localStorage', {
        getItem: vi.fn(() => storedValue),
        setItem: vi.fn((_key: string, value: string) => { storedValue = value; }),
        removeItem: vi.fn(() => { storedValue = null; }),
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

it('defaults optional analytics to disabled and persists explicit choices', async () => {
    const consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(false);

    expect(consent.setAnalyticsConsent(true)).toBe(true);
    expect(consent.getAnalyticsConsent()).toBe(true);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('logbook_ga4_consent_v1', 'true');

    expect(consent.setAnalyticsConsent(false)).toBe(true);
    expect(consent.getAnalyticsConsent()).toBe(false);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('logbook_ga4_consent_v1', 'false');
});

it('restores only the provider-specific GA4 opt-in after a module reload', async () => {
    storedValue = 'true';
    let consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(true);

    vi.resetModules();
    consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(true);
    expect(localStorage.getItem).toHaveBeenCalledWith('logbook_ga4_consent_v1');
});

it('fails closed when enabling analytics cannot be persisted', async () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('blocked storage'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let consent = await import('../../src/lib/analyticsConsent');

    expect(consent.setAnalyticsConsent(true)).toBe(false);
    expect(consent.getAnalyticsConsent()).toBe(false);

    vi.resetModules();
    consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(false);
    expect(warn).toHaveBeenCalledWith('Impossibile memorizzare la preferenza Google Analytics:', expect.any(Error));
});

