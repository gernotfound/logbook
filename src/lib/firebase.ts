import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
import { 
    getAuth, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signInWithRedirect,
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

const requiredEnvVars = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_DATABASE_URL',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_MEASUREMENT_ID'
] as const;

const missingEnvVars = requiredEnvVars.filter((key) => {
    const value = import.meta.env[key];
    return typeof value !== 'string' || value.trim() === '';
});

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

// Inizializza Analytics solo se supportato (evita crash su vecchi browser/ambienti)
let analytics: Analytics | null = null;
isSupported().then((supported) => {
    if (supported) {
        analytics = getAnalytics(app);
    }
}).catch(err => {
    console.warn("Firebase Analytics non supportato o disabilitato:", err);
});

const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const auth = getAuth(app);
const provider = new GoogleAuthProvider();
setPersistence(auth, browserLocalPersistence)
    .catch((error) => console.error("Errore impostazione persistenza Auth:", error));

export { auth, db, provider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, waitForPendingWrites, deleteUser, analytics };
