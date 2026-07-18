// js/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { 
    getAuth, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signInWithRedirect,
    signOut, 
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    getFirestore, 
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    waitForPendingWrites
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// INSERISCI QUI LA TUA CONFIGURAZIONE FIREBASE
// Puoi trovarla nelle impostazioni del tuo progetto Firebase -> App Web
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

// Inizializza Firebase
const app = initializeApp(firebaseConfig);

// Inizializza Firestore con supporto multi-tab offline (Fix per Problema 5)
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// Inizializza Auth
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Fissa la persistenza locale dell'Auth per evitare logout in background (Fix Problema 6 su iOS)
setPersistence(auth, browserLocalPersistence)
    .catch((error) => console.error("Errore impostazione persistenza Auth:", error));

export { auth, db, provider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged, waitForPendingWrites };
