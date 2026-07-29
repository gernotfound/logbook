import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
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
  apiKey: "AIzaSyD3kkRIXqIZAbpBNGTYkumYa_pr31naRD4",
  authDomain: "logbook-db-98cc4.firebaseapp.com",
  databaseURL: "https://logbook-db-98cc4-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "logbook-db-98cc4",
  storageBucket: "logbook-db-98cc4.firebasestorage.app",
  messagingSenderId: "135243298458",
  appId: "1:135243298458:web:ee8346adb4634ff953d123",
  measurementId: "G-560HT9M19Y"
};

const app = initializeApp(firebaseConfig);

// Inizializza Analytics solo se supportato (evita crash su vecchi browser/ambienti)
let analytics = null;
isSupported().then((supported) => {
    if (supported) {
        analytics = getAnalytics(app);
    }
});

const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const auth = getAuth(app);
const provider = new GoogleAuthProvider();
setPersistence(auth, browserLocalPersistence)
    .catch((error) => console.error("Errore impostazione persistenza Auth:", error));

export { auth, db, provider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, waitForPendingWrites, deleteUser, analytics };
