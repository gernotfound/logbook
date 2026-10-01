const ANALYTICS_CONSENT_KEY = 'logbook_google_analytics_consent_v1';
const LEGACY_VERCEL_ANALYTICS_CONSENT_KEY = 'logbook_analytics_consent';
const ANALYTICS_CONSENT_EVENT = 'analytics_consent_changed';

function readAnalyticsConsentFromStorage(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(ANALYTICS_CONSENT_KEY) === 'true';
    } catch {
        // Unreadable preference storage defaults non-essential analytics to disabled.
        return false;
    }
}

function retireLegacyVercelConsent(): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(LEGACY_VERCEL_ANALYTICS_CONSENT_KEY);
        }
    } catch {
        // Legacy cleanup is best-effort; it is never interpreted as Google Analytics consent.
    }
}

let currentAnalyticsConsent = readAnalyticsConsentFromStorage();
retireLegacyVercelConsent();

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

    retireLegacyVercelConsent();

    if (consent) {
        try {
            localStorage.setItem(ANALYTICS_CONSENT_KEY, 'true');
            persisted = localStorage.getItem(ANALYTICS_CONSENT_KEY) === 'true';
        } catch (error) {
            console.warn('Impossibile memorizzare la preferenza Analytics:', error);
        }
        currentAnalyticsConsent = persisted;
    } else {
        currentAnalyticsConsent = false;
        try {
            localStorage.setItem(ANALYTICS_CONSENT_KEY, 'false');
            persisted = localStorage.getItem(ANALYTICS_CONSENT_KEY) !== 'true';
        } catch (writeError) {
            try {
                localStorage.removeItem(ANALYTICS_CONSENT_KEY);
                persisted = localStorage.getItem(ANALYTICS_CONSENT_KEY) !== 'true';
            } catch (removeError) {
                console.warn('Impossibile memorizzare la preferenza Analytics:', writeError);
                console.warn('Impossibile rimuovere la preferenza Analytics:', removeError);
            }
        }
    }

    if (typeof window !== 'undefined') window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
    return persisted;
};
