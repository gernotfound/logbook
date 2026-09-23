import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

it('defaults optional analytics to disabled and persists explicit choices', async () => {
    const consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(false);

    consent.setAnalyticsConsent(true);
    expect(consent.getAnalyticsConsent()).toBe(true);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('logbook_analytics_consent', 'true');

    consent.setAnalyticsConsent(false);
    expect(consent.getAnalyticsConsent()).toBe(false);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('logbook_analytics_consent', 'false');
});

it('restores an existing Vercel analytics opt-in without loading Firebase Analytics', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue('true');
    const consent = await import('../../src/lib/analyticsConsent');

    expect(consent.getAnalyticsConsent()).toBe(true);
    expect(localStorage.getItem).toHaveBeenCalledWith('logbook_analytics_consent');
});

it('updates the in-memory choice even when preference storage is unavailable', async () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('blocked storage'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consent = await import('../../src/lib/analyticsConsent');

    consent.setAnalyticsConsent(true);

    expect(consent.getAnalyticsConsent()).toBe(true);
    expect(warn).toHaveBeenCalledWith('Impossibile memorizzare la preferenza Analytics:', expect.any(Error));
    warn.mockRestore();
});
