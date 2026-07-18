// js/db.js
import { auth, db, waitForPendingWrites } from './firebase-config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

export const DB = {
    // Carica tutti i dati dell'utente dal cloud
    async loadUserData() {
        const user = auth.currentUser;
        if (!user) return null;
        
        try {
            const docRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                return docSnap.data();
            } else {
                // Primo login: documento non esiste
                return null;
            }
        } catch (error) {
            console.error("Errore caricamento dati dal cloud:", error);
            // In caso di errore (es. offline) Firestore restituisce i dati in cache se ci sono,
            // altrimenti lancia un'eccezione
            throw error;
        }
    },

    // Salva l'intero stato dell'app nel cloud (protetto da try/catch)
    async saveUserData(state) {
        const user = auth.currentUser;
        if (!user) return; // Non salvare se l'utente non è loggato
        
        try {
            const docRef = doc(db, "users", user.uid);
            // setDoc sovrascrive, merge: true aggiorna solo i campi passati
            await setDoc(docRef, state, { merge: true });
            console.log("Dati salvati con successo");
        } catch (error) {
            console.error("Errore durante il salvataggio:", error);
            // Il crash silenzioso è risolto: l'errore viene loggato ma non blocca l'UI
        }
    },

    // Log Out Sicuro: aspetta che i dati siano inviati prima di sloggare (Fix Problema 7)
    async secureLogOut() {
        try {
            document.getElementById('sync-overlay').style.display = 'flex'; // Mostra caricamento
            console.log("Attendo il completamento delle scritture offline...");
            await waitForPendingWrites(); // Aspetta che tutto sia sul cloud
            console.log("Tutti i dati sincronizzati. Eseguo il Log Out.");
            await auth.signOut();
        } catch (error) {
            console.error("Errore durante il Log Out:", error);
            alert("Errore durante il Log Out. Controlla la connessione.");
        } finally {
            document.getElementById('sync-overlay').style.display = 'none';
        }
    }
};
