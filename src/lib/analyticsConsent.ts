const ANALYTICS_CONSENT_KEY = 'logbook_ga4_consent_v1';
const ANALYTICS_CONSENT_EVENT = 'ga4_consent_changed';

function readAnalyticsConsentFromStorage(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(ANALYTICS_CONSENT_KEY) === 'true';
    } catch {
        return false;
    }
}

let currentAnalyticsConsent = readAnalyticsConsentFromStorage();

export const getAnalyticsConsent = () => currentAnalyticsConsent;

export const subscribeAnalyticsConsent = (listener: (consent: boolean) => void) => {
    if (typeof window === 'undefined') return () => {};
    const handleLocalChange = () => listener(currentAnalyticsConsent);
    const handleStorageChange = (event: StorageEvent) => {
        if (event.key !== null && event.key !== ANALYTICS_CONSENT_KEY) return;
        try {
            if (event.storageArea !== null && event.storageArea !== localStorage) return;
        } catch {
            currentAnalyticsConsent = false;
            listener(false);
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
    currentAnalyticsConsent = false;
    try {
        localStorage.setItem(ANALYTICS_CONSENT_KEY, consent ? 'true' : 'false');
        persisted = consent
            ? localStorage.getItem(ANALYTICS_CONSENT_KEY) === 'true'
            : localStorage.getItem(ANALYTICS_CONSENT_KEY) !== 'true';
        currentAnalyticsConsent = consent && persisted;
    } catch (error) {
        console.warn('Impossibile memorizzare la preferenza Google Analytics:', error);
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
    return persisted;
};
