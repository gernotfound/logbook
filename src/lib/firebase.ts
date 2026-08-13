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

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD3kkRIXqIZAbpBNGTYkumYa_pr31naRD4",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "logbook-db-98cc4.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://logbook-db-98cc4-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "logbook-db-98cc4",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "logbook-db-98cc4.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "135243298458",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:135243298458:web:ee8346adb4634ff953d123",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-560HT9M19Y"
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
