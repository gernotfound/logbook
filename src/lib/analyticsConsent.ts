const ANALYTICS_CONSENT_KEY = 'logbook_ga4_consent_v1';
const ANALYTICS_CONSENT_EVENT = 'ga4_consent_changed';
// A best-effort same-tab reload barrier when localStorage cannot be updated.
const REVOCATION_BARRIER_KEY = 'logbook_ga4_revocation_pending_v1';
const CONSENT_CHANNEL = 'logbook_ga4_consent';

function hasRevocationBarrier(): boolean {
    try { return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(REVOCATION_BARRIER_KEY) === 'true'; }
    catch { return false; }
}


function readAnalyticsConsentFromStorage(): boolean {
    try {
        return !hasRevocationBarrier() && typeof localStorage !== 'undefined'
            && localStorage.getItem(ANALYTICS_CONSENT_KEY) === 'true';
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
    // A failed localStorage write emits no storage event. Broadcast revocation
    // to already-open tabs without interpreting it as a persisted choice.
    let channel: BroadcastChannel | undefined;
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            channel = new BroadcastChannel(CONSENT_CHANNEL);
            channel.onmessage = event => {
                if (event.data !== 'revoke') return;
                currentAnalyticsConsent = false;
                try { sessionStorage.setItem(REVOCATION_BARRIER_KEY, 'true'); } catch { /* best effort */ }
                listener(false);
            };
        }
    } catch { /* BroadcastChannel is optional */ }
    window.addEventListener(ANALYTICS_CONSENT_EVENT, handleLocalChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
        window.removeEventListener(ANALYTICS_CONSENT_EVENT, handleLocalChange);
        window.removeEventListener('storage', handleStorageChange);
        channel?.close();
    };
};

export const setAnalyticsConsent = (consent: boolean): boolean => {
    let persisted = false;
    currentAnalyticsConsent = false;

    if (consent) {
        // Never override an unresolved revocation barrier by accident.
        try {
            if (typeof sessionStorage !== 'undefined') {
                sessionStorage.removeItem(REVOCATION_BARRIER_KEY);
                if (hasRevocationBarrier()) throw new Error('Revocation barrier still active');
            }
            localStorage.setItem(ANALYTICS_CONSENT_KEY, 'true');
            persisted = localStorage.getItem(ANALYTICS_CONSENT_KEY) === 'true';
            currentAnalyticsConsent = persisted;
        } catch (error) {
            console.warn('Impossibile memorizzare la preferenza Google Analytics:', error);
        }
    } else {
        try {
            localStorage.setItem(ANALYTICS_CONSENT_KEY, 'false');
            persisted = localStorage.getItem(ANALYTICS_CONSENT_KEY) !== 'true';
        } catch (error) {
            console.warn('Impossibile memorizzare la preferenza Google Analytics:', error);
        }
        if (!persisted) {
            // Removing the old grant often works even when a new write is blocked
            // (for example when localStorage has reached quota).
            try {
                localStorage.removeItem(ANALYTICS_CONSENT_KEY);
                persisted = localStorage.getItem(ANALYTICS_CONSENT_KEY) !== 'true';
            } catch (error) {
                console.warn('Impossibile rimuovere il precedente consenso Google Analytics:', error);
            }
        }
        if (!persisted) {
            try { sessionStorage.setItem(REVOCATION_BARRIER_KEY, 'true'); }
            catch { /* No browser storage is guaranteed writable. */ }
            try {
                const channel = new BroadcastChannel(CONSENT_CHANNEL);
                channel.postMessage('revoke');
                channel.close();
            } catch { /* Fail closed in the current tab; UI reports failed persistence. */ }
        } else {
            try { sessionStorage.removeItem(REVOCATION_BARRIER_KEY); } catch { /* conservative */ }
        }
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
    return persisted;
};
