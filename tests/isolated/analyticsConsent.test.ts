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
    vi.unstubAllGlobals();
});

it('defaults optional analytics to disabled and persists explicit choices', async () => {
    const consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(false);

    expect(consent.setAnalyticsConsent(true)).toBe(true);
    expect(consent.getAnalyticsConsent()).toBe(true);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('logbook_analytics_consent', 'true');

    expect(consent.setAnalyticsConsent(false)).toBe(true);
    expect(consent.getAnalyticsConsent()).toBe(false);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('logbook_analytics_consent', 'false');
});

it('restores a persisted Vercel analytics opt-in after a module reload', async () => {
    storedValue = 'true';
    let consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(true);

    vi.resetModules();
    consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(true);
    expect(localStorage.getItem).toHaveBeenCalledWith('logbook_analytics_consent');
});

it('fails closed when enabling analytics cannot be persisted', async () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('blocked storage'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consent = await import('../../src/lib/analyticsConsent');

    expect(consent.setAnalyticsConsent(true)).toBe(false);
    expect(consent.getAnalyticsConsent()).toBe(false);

    vi.resetModules();
    consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(false);
    expect(warn).toHaveBeenCalledWith('Impossibile memorizzare la preferenza Analytics:', expect.any(Error));
    warn.mockRestore();
});

it('persists revocation through remove fallback when the write path is blocked', async () => {
    storedValue = 'true';
    let consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(true);

    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('blocked storage'); });
    expect(consent.setAnalyticsConsent(false)).toBe(true);
    expect(consent.getAnalyticsConsent()).toBe(false);
    expect(localStorage.removeItem).toHaveBeenCalledWith('logbook_analytics_consent');

    vi.resetModules();
    consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(false);
});

it('keeps the current session fail-closed and reports failure when revocation cannot be persisted', async () => {
    storedValue = 'true';
    const consent = await import('../../src/lib/analyticsConsent');
    expect(consent.getAnalyticsConsent()).toBe(true);

    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('blocked write'); });
    vi.mocked(localStorage.removeItem).mockImplementation(() => { throw new Error('blocked remove'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(consent.setAnalyticsConsent(false)).toBe(false);
    expect(consent.getAnalyticsConsent()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
});
