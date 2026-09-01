import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
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
    .filter(([_, value]) => typeof value !== 'string' || value.trim() === '')
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

// App Check (ReCaptchaEnterpriseProvider) - On Demand Init
export let appCheckPromise: Promise<void> | null = null;
export const ensureAppCheck = () => {
    if (typeof window === 'undefined') return Promise.resolve();
    if (!appCheckPromise) {
        appCheckPromise = import('./appCheck').then(({ initAppCheck }) => {
            return initAppCheck(app).then((res) => {
                if (!res.success && !res.disabled) {
                    console.warn("Inizializzazione App Check non riuscita:", res.reason);
                }
            }).catch((err) => {
                console.warn("Errore durante l'inizializzazione di App Check:", err);
            });
        }).catch(err => {
            console.warn("Errore caricamento modulo App Check:", err);
        });
    }
    return appCheckPromise;
};

// Inizializza Analytics solo se supportato (evita crash su vecchi browser/ambienti)
let analytics: Analytics | null = null;
let currentAnalyticsConsent = typeof localStorage !== 'undefined' ? localStorage.getItem('logbook_analytics_consent') === 'true' : false;

isSupported().then((supported) => {
    if (supported && currentAnalyticsConsent) {
        analytics = getAnalytics(app);
    }
}).catch(err => {
    console.warn("Firebase Analytics non supportato o disabilitato:", err);
});

let _db: any = null;
export const getDb = () => {
    if (!_db) {
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
    localStorage.setItem('logbook_analytics_consent', consent ? 'true' : 'false');
    window.dispatchEvent(new Event('analytics_consent_changed'));
    
    if (consent && !analytics) {
        isSupported().then(supported => {
            if (supported) analytics = getAnalytics(app);
        });
    } else if (!consent && analytics) {
        analytics = null;
    }
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
    deleteUser, 
    analytics 
};
