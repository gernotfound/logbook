import { initializeApp } from "firebase/app";
import {
    initializeAuth,
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
    reauthenticateWithRedirect,
    linkWithRedirect,
    reload,
    sendEmailVerification,
    verifyBeforeUpdateEmail,
    validatePassword,
    getRedirectResult,
    signOut,
    onAuthStateChanged,
    browserLocalPersistence,
    browserPopupRedirectResolver,
    deleteUser
} from "firebase/auth";
import {
    initializeFirestore,
    memoryLocalCache,
    waitForPendingWrites
} from "firebase/firestore";
import { ensureAppCheckProvider, initAppCheck, type AppCheckResult } from './appCheck';

const envVars: Record<string, string | undefined> = {
    'VITE_FIREBASE_API_KEY': import.meta.env.VITE_FIREBASE_API_KEY,
    'VITE_FIREBASE_AUTH_DOMAIN': import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    'VITE_FIREBASE_PROJECT_ID': import.meta.env.VITE_FIREBASE_PROJECT_ID,
    'VITE_FIREBASE_APP_ID': import.meta.env.VITE_FIREBASE_APP_ID
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
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

export const firebaseApp = initializeApp(firebaseConfig);

// App Check provider bootstrap is synchronous so protected Firebase services can
// never be initialized before the provider. Token acquisition remains async and
// is exposed separately through ensureAppCheck().
ensureAppCheckProvider(firebaseApp);

export class AppCheckUnavailableError extends Error {
    readonly code = 'app-check-unavailable';
    readonly phase: AppCheckResult['phase'];
    readonly retryable: boolean;

    constructor(result: AppCheckResult) {
        super(
            result.reason ?? result.tokenError ?? `App Check non disponibile (${result.phase})`,
            result.error !== undefined ? { cause: result.error } : undefined,
        );
        this.name = 'AppCheckUnavailableError';
        this.phase = result.phase;
        this.retryable = result.retryable;
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
        const inFlight = initAppCheck(firebaseApp).then((result) => {
            const disabledOutsideProduction = result.disabled === true && !import.meta.env.PROD;
            if (!result.success && !disabledOutsideProduction) {
                const error = new AppCheckUnavailableError(result);
                void import('./errorHandler')
                    .then(({ reportError }) => reportError(error, { source: 'app_check_readiness' }))
                    .catch(() => {});
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

let _db: ReturnType<typeof initializeFirestore> | null = null;
export const getDb = () => {
    if (!_db) {
        // Idempotent guard: keeps ordering explicit even if tests reset App Check
        // state or a future caller constructs Firestore before ensureAppCheck().
        ensureAppCheckProvider(firebaseApp);
        _db = initializeFirestore(firebaseApp, {
            // Durable offline data belongs to LogBook's owner-scoped IndexedDB envelope.
            // Keep Firestore memory-only so logout/account deletion cannot leave a second
            // persistent copy of private cloud documents on the device.
            localCache: memoryLocalCache()
        });
    }
    return _db;
};

const auth = initializeAuth(firebaseApp, {
    persistence: browserLocalPersistence,
    ...(typeof window !== 'undefined' ? { popupRedirectResolver: browserPopupRedirectResolver } : {}),
});
auth.languageCode = 'it';
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

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
    reauthenticateWithRedirect,
    linkWithRedirect,
    reload,
    sendEmailVerification,
    verifyBeforeUpdateEmail,
    validatePassword,
    getRedirectResult,
    signOut,
    onAuthStateChanged,
    waitForPendingWrites,
    deleteUser
};