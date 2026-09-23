const ANALYTICS_CONSENT_KEY = 'logbook_analytics_consent';

let currentAnalyticsConsent = false;
try {
    currentAnalyticsConsent = typeof localStorage !== 'undefined' && localStorage.getItem(ANALYTICS_CONSENT_KEY) === 'true';
} catch {
    // Unreadable preference storage defaults non-essential analytics to disabled.
}

export const getAnalyticsConsent = () => currentAnalyticsConsent;

export const setAnalyticsConsent = (consent: boolean) => {
    currentAnalyticsConsent = consent;
    try {
        localStorage.setItem(ANALYTICS_CONSENT_KEY, consent ? 'true' : 'false');
    } catch (err) {
        console.warn('Impossibile memorizzare la preferenza Analytics:', err);
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('analytics_consent_changed'));
};
