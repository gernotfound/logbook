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
        const instance = module.getAnalytics(firebaseApp);
        module.setAnalyticsCollectionEnabled(instance, true);
        analytics = instance;
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
