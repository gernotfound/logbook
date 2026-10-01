import { firebaseApp } from './firebase';
import { getAnalyticsConsent } from './analyticsConsent';
import { importFirebaseAnalyticsSdk, type FirebaseAnalyticsSdk } from './firebaseAnalyticsSdk';
import { createRetryableLazyLoader } from './utils/retryableLazyLoader';

type AnalyticsSdk = FirebaseAnalyticsSdk;
type AnalyticsInstance = import('firebase/analytics').Analytics;

const grantedConsent = {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    functionality_storage: 'denied',
    personalization_storage: 'denied',
    security_storage: 'denied',
} as const;

const deniedConsent = {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    functionality_storage: 'denied',
    personalization_storage: 'denied',
    security_storage: 'denied',
} as const;

let analyticsSdk: AnalyticsSdk | null = null;
let analyticsInstance: AnalyticsInstance | null = null;
let consentGeneration = 0;

const loadAnalyticsModule = createRetryableLazyLoader<AnalyticsSdk>(
    importFirebaseAnalyticsSdk,
);

async function loadAnalyticsSdk(): Promise<AnalyticsSdk> {
    const module = await loadAnalyticsModule();
    analyticsSdk = module;
    return module;
}

export async function applyFirebaseAnalyticsConsent(enabled: boolean): Promise<void> {
    const generation = ++consentGeneration;

    // Analytics is a Production-only, optional boundary. In development/tests it
    // stays completely inert and does not load Google's analytics module.
    if (!import.meta.env.PROD || typeof window === 'undefined') return;

    if (!enabled) {
        if (analyticsSdk && analyticsInstance) {
            analyticsSdk.setConsent(deniedConsent);
            analyticsSdk.setAnalyticsCollectionEnabled(analyticsInstance, false);
        }
        return;
    }

    // A stale caller must never initialize Analytics after a revocation.
    if (!getAnalyticsConsent()) return;

    try {
        const sdk = await loadAnalyticsSdk();
        if (generation !== consentGeneration || !getAnalyticsConsent()) return;
        if (!(await sdk.isSupported())) return;
        if (generation !== consentGeneration || !getAnalyticsConsent()) return;

        sdk.setConsent(grantedConsent);

        if (!analyticsInstance) {
            analyticsInstance = sdk.initializeAnalytics(firebaseApp, {
                config: {
                    send_page_view: true,
                    // Never expose PWA shortcut/query state (for example ?tab=training)
                    // through the automatic page_view payload.
                    page_location: `${window.location.origin}${window.location.pathname}`,
                    allow_google_signals: false,
                    allow_ad_personalization_signals: false,
                },
            });
        }

        if (generation !== consentGeneration || !getAnalyticsConsent()) {
            sdk.setConsent(deniedConsent);
            sdk.setAnalyticsCollectionEnabled(analyticsInstance, false);
            return;
        }

        sdk.setAnalyticsCollectionEnabled(analyticsInstance, true);
    } catch (error) {
        console.warn('Google Analytics non disponibile:', error);
    }
}
