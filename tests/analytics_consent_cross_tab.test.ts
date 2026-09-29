import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ANALYTICS_CONSENT_KEY = 'logbook_analytics_consent';

function dispatchStorageChange(
    key: string | null,
    newValue: string | null,
    storageArea: Storage | null = localStorage,
) {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea }));
}

describe('Analytics consent cross-tab synchronization', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('synchronizes opt-in and revocation from another tab without writing back to storage', async () => {
        const consent = await import('../src/lib/analyticsConsent');
        const observed: boolean[] = [];
        const unsubscribe = consent.subscribeAnalyticsConsent(value => observed.push(value));

        localStorage.setItem(ANALYTICS_CONSENT_KEY, 'true');
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
        setItemSpy.mockClear();

        dispatchStorageChange(ANALYTICS_CONSENT_KEY, 'true');

        expect(consent.getAnalyticsConsent()).toBe(true);
        expect(observed).toEqual([true]);
        expect(setItemSpy).not.toHaveBeenCalled();

        localStorage.setItem(ANALYTICS_CONSENT_KEY, 'false');
        setItemSpy.mockClear();

        dispatchStorageChange(ANALYTICS_CONSENT_KEY, 'false');

        expect(consent.getAnalyticsConsent()).toBe(false);
        expect(observed).toEqual([true, false]);
        expect(setItemSpy).not.toHaveBeenCalled();

        unsubscribe();
    });

    it('fails closed when another tab clears localStorage', async () => {
        localStorage.setItem(ANALYTICS_CONSENT_KEY, 'true');
        const consent = await import('../src/lib/analyticsConsent');
        const observed: boolean[] = [];
        const unsubscribe = consent.subscribeAnalyticsConsent(value => observed.push(value));

        expect(consent.getAnalyticsConsent()).toBe(true);

        localStorage.clear();
        dispatchStorageChange(null, null);

        expect(consent.getAnalyticsConsent()).toBe(false);
        expect(observed).toEqual([false]);

        unsubscribe();
    });

    it('ignores unrelated keys and sessionStorage events', async () => {
        const consent = await import('../src/lib/analyticsConsent');
        const listener = vi.fn();
        const unsubscribe = consent.subscribeAnalyticsConsent(listener);

        localStorage.setItem('unrelated_key', 'true');
        dispatchStorageChange('unrelated_key', 'true');

        sessionStorage.setItem(ANALYTICS_CONSENT_KEY, 'true');
        dispatchStorageChange(ANALYTICS_CONSENT_KEY, 'true', sessionStorage);

        expect(consent.getAnalyticsConsent()).toBe(false);
        expect(listener).not.toHaveBeenCalled();

        unsubscribe();
    });

    it('fails closed if preference storage becomes unreadable during a cross-tab update', async () => {
        const consent = await import('../src/lib/analyticsConsent');
        consent.setAnalyticsConsent(true);
        const listener = vi.fn();
        const unsubscribe = consent.subscribeAnalyticsConsent(listener);

        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked storage');
        });

        dispatchStorageChange(ANALYTICS_CONSENT_KEY, 'true');

        expect(consent.getAnalyticsConsent()).toBe(false);
        expect(listener).toHaveBeenLastCalledWith(false);

        unsubscribe();
    });
});
