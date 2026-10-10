import { firebaseApp } from './firebase';
import { getAnalyticsConsent, subscribeAnalyticsConsent } from './analyticsConsent';

let analytics: import('firebase/analytics').Analytics | null = null;
let initialization: Promise<void> | null = null;
let unsubscribe: (() => void) | null = null;

async function enableAnalytics(): Promise<void> {
    if (!getAnalyticsConsent() || analytics) return;
    if (!import.meta.env.VITE_FIREBASE_MEASUREMENT_ID) return;
    if (initialization) return initialization;

    const attempt = (async () => {
        const module = await import('firebase/analytics');
        if (!getAnalyticsConsent()) return;
        if (!(await module.isSupported())) return;
        // Consent can be revoked while the asynchronous support check is in flight.
        // Re-check immediately before initializing Analytics so revocation is fail-closed.
        if (!getAnalyticsConsent()) return;
        const instance = module.initializeAnalytics(firebaseApp, { config: { send_page_view: false } });
        module.setAnalyticsCollectionEnabled(instance, true);
        analytics = instance;
        const pageLocation = window.location.origin + window.location.pathname;
        module.logEvent(instance, 'page_view', { page_location: pageLocation, page_path: window.location.pathname, page_title: document.title });
    })();

    initialization = attempt;
    try {
        await attempt;
    } finally {
        if (initialization === attempt) initialization = null;
    }
}

async function applyConsent(consent: boolean): Promise<void> {
    if (!consent) {
        if (analytics) {
            const module = await import('firebase/analytics');
            // Regrant may occur while the import is pending: only current consent can disable.
            if (getAnalyticsConsent()) return;
            module.setAnalyticsCollectionEnabled(analytics, false);
            analytics = null;
        }
        return;
    }
    try { await enableAnalytics(); }
    catch (error) { console.warn('Google Analytics non disponibile; sarà ritentato al prossimo cambio/avvio.', error); }
}

export function initOptionalGoogleAnalytics(): void {
    if (unsubscribe) return;
    void applyConsent(getAnalyticsConsent());
    unsubscribe = subscribeAnalyticsConsent((consent) => { void applyConsent(consent); });
}
