const ANALYTICS_CONSENT_KEY = 'logbook_analytics_consent';
const ANALYTICS_CONSENT_EVENT = 'analytics_consent_changed';

function readAnalyticsConsentFromStorage(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(ANALYTICS_CONSENT_KEY) === 'true';
    } catch {
        // Unreadable preference storage defaults non-essential analytics to disabled.
        return false;
    }
}

let currentAnalyticsConsent = readAnalyticsConsentFromStorage();

export const getAnalyticsConsent = () => currentAnalyticsConsent;

export const subscribeAnalyticsConsent = (listener: (consent: boolean) => void) => {
    if (typeof window === 'undefined') return () => {};

    const handleLocalChange = () => {
        listener(currentAnalyticsConsent);
    };

    const handleStorageChange = (event: StorageEvent) => {
        if (event.key !== null && event.key !== ANALYTICS_CONSENT_KEY) return;
        try {
            if (event.storageArea !== null && event.storageArea !== localStorage) return;
        } catch {
            currentAnalyticsConsent = false;
            listener(currentAnalyticsConsent);
            return;
        }
        currentAnalyticsConsent = readAnalyticsConsentFromStorage();
        listener(currentAnalyticsConsent);
    };

    window.addEventListener(ANALYTICS_CONSENT_EVENT, handleLocalChange);
    window.addEventListener('storage', handleStorageChange);

    return () => {
        window.removeEventListener(ANALYTICS_CONSENT_EVENT, handleLocalChange);
        window.removeEventListener('storage', handleStorageChange);
    };
};

export const setAnalyticsConsent = (consent: boolean): boolean => {
    let persisted = false;
    try {
        localStorage.setItem(ANALYTICS_CONSENT_KEY, consent ? 'true' : 'false');
        persisted = localStorage.getItem(ANALYTICS_CONSENT_KEY) === (consent ? 'true' : 'false');
    } catch (err) {
        console.warn('Impossibile memorizzare la preferenza Analytics:', err);
    }

    // Non-essential analytics may only be enabled after the opt-in is durably
    // observable. Revocation stays fail-closed even when preference storage fails.
    currentAnalyticsConsent = consent && persisted;
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
    return consent ? persisted : !currentAnalyticsConsent;
};
