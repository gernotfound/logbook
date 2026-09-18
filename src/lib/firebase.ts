import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported, setAnalyticsCollectionEnabled, type Analytics } from "firebase/analytics";
import {
    getAuth,
    GoogleAuthProvider,
    EmailAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    updateEmail,
    updatePassword,
    linkWithCredential,
    linkWithPopup,
    reauthenticateWithCredential,
    reauthenticateWithPopup,
    getRedirectResult,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence,
    deleteUser
} from "firebase/auth";
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    waitForPendingWrites
} from "firebase/firestore";
import { ensureAppCheckProvider, initAppCheck, type AppCheckResult } from './appCheck';

const envVars: Record<string, string | undefined> = {
    'VITE_FIREBASE_API_KEY': import.meta.env.VITE_FIREBASE_API_KEY,
    'VITE_FIREBASE_AUTH_DOMAIN': import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    'VITE_FIREBASE_DATABASE_URL': import.meta.env.VITE_FIREBASE_DATABASE_URL,
    'VITE_FIREBASE_PROJECT_ID': import.meta.env.VITE_FIREBASE_PROJECT_ID,
    'VITE_FIREBASE_STORAGE_BUCKET': import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    'VITE_FIREBASE_MESSAGING_SENDER_ID': import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    'VITE_FIREBASE_APP_ID': import.meta.env.VITE_FIREBASE_APP_ID,
    'VITE_FIREBASE_MEASUREMENT_ID': import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const missingEnvVars = Object.entries(envVars)
    .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
    .map(([key]) => key);

if (missingEnvVars.length > 0) {
    throw new Error(`Configurazione Firebase incompleta: mancano le variabili d'ambiente necessarie: ${missingEnvVars.join(', ')}`);
}

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);

// App Check provider bootstrap is synchronous so protected Firebase services can
// never be initialized before the provider. Token acquisition remains async and
// is exposed separately through ensureAppCheck().
ensureAppCheckProvider(app);

export class AppCheckUnavailableError extends Error {
    readonly code = 'app-check-unavailable';
    readonly phase: AppCheckResult['phase'];

    constructor(result: AppCheckResult) {
        super(result.reason ?? result.tokenError ?? `App Check non disponibile (${result.phase})`);
        this.name = 'AppCheckUnavailableError';
        this.phase = result.phase;
    }
}

// Share only the in-flight token bootstrap. A failed initial token acquisition
// must be retryable on a later foreground/sync attempt instead of being cached
// for the lifetime of the page. Production cloud callers fail closed when App
// Check is unavailable; non-production runs may omit the site key so emulator and
// deterministic persistence tests can exercise Firestore without reCAPTCHA.
export let appCheckPromise: Promise<AppCheckResult> | null = null;
export const ensureAppCheck = (): Promise<AppCheckResult> => {
    if (!appCheckPromise) {
        const inFlight = initAppCheck(app).then((result) => {
            const disabledOutsideProduction = result.disabled === true && !import.meta.env.PROD;
            if (!result.success && !disabledOutsideProduction) {
                const error = new AppCheckUnavailableError(result);
                console.warn("App Check non pronto per il cloud:", result.reason ?? result.tokenError ?? result.phase);
                throw error;
            }
            return result;
        }).catch((error: unknown) => {
            console.warn("Errore durante l'inizializzazione di App Check:", error);
            throw error;
        });
        appCheckPromise = inFlight;
        void inFlight.finally(() => {
            if (appCheckPromise === inFlight) appCheckPromise = null;
        }).catch(() => {
            // The original promise carries the rejection to the caller; this
            // observer exists only to clear the in-flight singleton safely.
        });
    }
    return appCheckPromise;
};

// Analytics is initialized lazily and only while consent is active. Consumers
// await getConsentedAnalytics() instead of treating a mutable module binding as a
// readiness signal; this preserves the first SPA event even when isSupported()
// resolves after React has already processed the consent change.
let analyticsInstance: Analytics | null = null;
let analyticsInitPromise: Promise<Analytics | null> | null = null;
let currentAnalyticsConsent = false;
try {
    currentAnalyticsConsent = typeof localStorage !== 'undefined' && localStorage.getItem('logbook_analytics_consent') === 'true';
} catch {
    // Unreadable consent defaults to disabled collection.
}

const enableConsentedAnalytics = (): Promise<Analytics | null> => {
    if (!currentAnalyticsConsent) return Promise.resolve(null);

    if (analyticsInstance) {
        try {
            setAnalyticsCollectionEnabled(analyticsInstance, true);
            return Promise.resolve(analyticsInstance);
        } catch (err) {
            console.warn('Firebase Analytics non supportato o disabilitato:', err);
            return Promise.resolve(null);
        }
    }

    if (!analyticsInitPromise) {
        const inFlight = (async (): Promise<Analytics | null> => {
            try {
                const supported = await isSupported();
                // Consent can change while the asynchronous capability check is in flight.
                if (!supported || !currentAnalyticsConsent) return null;
                analyticsInstance ??= getAnalytics(app);
                if (!currentAnalyticsConsent) return null;
                setAnalyticsCollectionEnabled(analyticsInstance, true);
                return analyticsInstance;
            } catch (err) {
                console.warn('Firebase Analytics non supportato o disabilitato:', err);
                return null;
            }
        })();
        analyticsInitPromise = inFlight;
        void inFlight.finally(() => {
            if (analyticsInitPromise === inFlight) analyticsInitPromise = null;
        });
    }

    return analyticsInitPromise;
};

export const getConsentedAnalytics = async (): Promise<Analytics | null> => {
    if (!currentAnalyticsConsent) return null;
    const instance = await enableConsentedAnalytics();
    return currentAnalyticsConsent ? instance : null;
};

if (currentAnalyticsConsent) void enableConsentedAnalytics();

let _db: ReturnType<typeof initializeFirestore> | null = null;
export const getDb = () => {
    if (!_db) {
        // Idempotent guard: keeps ordering explicit even if tests reset App Check
        // state or a future caller constructs Firestore before ensureAppCheck().
        ensureAppCheckProvider(app);
        _db = initializeFirestore(app, {
            localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        });
    }
    return _db;
};

const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
setPersistence(auth, browserLocalPersistence)
    .catch((error) => console.error("Errore impostazione persistenza Auth:", error));

export const getAnalyticsConsent = () => currentAnalyticsConsent;

export const setAnalyticsConsent = (consent: boolean) => {
    currentAnalyticsConsent = consent;
    if (!consent) {
        if (analyticsInstance) setAnalyticsCollectionEnabled(analyticsInstance, false);
    } else {
        void enableConsentedAnalytics();
    }
    try {
        localStorage.setItem('logbook_analytics_consent', consent ? 'true' : 'false');
    } catch (err) {
        console.warn('Impossibile memorizzare la preferenza Analytics:', err);
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('analytics_consent_changed'));
};
export {
    auth,
    provider,
    EmailAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    updateEmail,
    updatePassword,
    linkWithCredential,
    linkWithPopup,
    reauthenticateWithCredential,
    reauthenticateWithPopup,
    getRedirectResult,
    signOut,
    onAuthStateChanged,
    waitForPendingWrites,
    deleteUser
};
