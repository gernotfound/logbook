// js/db.js
import { auth, db, waitForPendingWrites, deleteUser } from './firebase-config.js';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, deleteField } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let lastSavedStateStr = null;

export const DB = {
    // Carica tutti i dati dell'utente dal cloud
    async loadUserData() {
        const user = auth.currentUser;
        if (!user) return null;
        
        try {
            const state = { profile: {}, library: [], routines: [], history: [], nutrition: {}, activeWorkout: null };
            let needsMigration = false;

            const docRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const data = docSnap.data();
                if(data.profile) state.profile = data.profile;
                if(data.library) state.library = data.library;
                if(data.routines) state.routines = data.routines;
                if(data.activeWorkout !== undefined) state.activeWorkout = data.activeWorkout;
                
                // Se ci sono campi legacy history/nutrition nel doc principale, dobbiamo migrare
                if (data.history || data.nutrition) {
                    if (data.history) state.history = data.history;
                    if (data.nutrition) state.nutrition = data.nutrition;
                    needsMigration = true;
                }
            } else {
                return null;
            }

            if (!needsMigration) {
                // Carica dalle subcollections in modo efficiente
                const histSnap = await getDocs(collection(db, "users", user.uid, "history"));
                histSnap.forEach(d => state.history.push(d.data()));
                
                const nutSnap = await getDocs(collection(db, "users", user.uid, "nutrition"));
                nutSnap.forEach(d => state.nutrition[d.id] = d.data());
                
                // Ordina la cronologia (dal più recente)
                state.history.sort((a,b) => (b.globalStartTime || 0) - (a.globalStartTime || 0));
            } else {
                // Impostiamo lastSavedStateStr con array vuoti per forzare il salvataggio nelle subcollections
                // al prossimo saveToStorage()
                lastSavedStateStr = JSON.stringify({
                    profile: state.profile, 
                    library: state.library, 
                    routines: state.routines, 
                    activeWorkout: state.activeWorkout,
                    history: [], 
                    nutrition: {}
                });
                return state;
            }

            lastSavedStateStr = JSON.stringify(state);
            return state;
        } catch (error) {
            console.error("Errore caricamento dati dal cloud:", error);
            throw error;
        }
    },

    // Salva l'intero stato dell'app nel cloud (effettua un diffing per limitare le scritture e usa le subcollections)
    async saveUserData(state) {
        const user = auth.currentUser;
        if (!user) return;
        
        try {
            let oldState = { profile: {}, library: [], routines: [], history: [], nutrition: {}, activeWorkout: null };
            if (lastSavedStateStr) {
                oldState = JSON.parse(lastSavedStateStr);
            }

            const promises = [];

            // Controlla se i dati principali sono cambiati
            if (JSON.stringify(state.profile) !== JSON.stringify(oldState.profile) ||
                JSON.stringify(state.library) !== JSON.stringify(oldState.library) ||
                JSON.stringify(state.routines) !== JSON.stringify(oldState.routines) ||
                JSON.stringify(state.activeWorkout) !== JSON.stringify(oldState.activeWorkout)) {
                
                const userRef = doc(db, "users", user.uid);
                promises.push(setDoc(userRef, {
                    profile: state.profile,
                    library: state.library,
                    routines: state.routines,
                    activeWorkout: state.activeWorkout || null,
                    history: deleteField(), // Assicura che i dati legacy vengano puliti
                    nutrition: deleteField() 
                }, { merge: true }));
            }

            // Diff per la History (Allenamenti)
            const oldHistMap = {};
            oldState.history.forEach(h => oldHistMap[h.id] = h);
            
            state.history.forEach(h => {
                if (JSON.stringify(h) !== JSON.stringify(oldHistMap[h.id])) {
                    promises.push(setDoc(doc(db, "users", user.uid, "history", h.id), h));
                }
                delete oldHistMap[h.id];
            });
            Object.keys(oldHistMap).forEach(id => {
                promises.push(deleteDoc(doc(db, "users", user.uid, "history", id)));
            });

            // Diff per la Nutrition (Nutrizione)
            const oldNutMap = oldState.nutrition || {};
            Object.keys(state.nutrition).forEach(date => {
                if (JSON.stringify(state.nutrition[date]) !== JSON.stringify(oldNutMap[date])) {
                    promises.push(setDoc(doc(db, "users", user.uid, "nutrition", date), state.nutrition[date]));
                }
                delete oldNutMap[date];
            });
            Object.keys(oldNutMap).forEach(date => {
                promises.push(deleteDoc(doc(db, "users", user.uid, "nutrition", date)));
            });

            if (promises.length > 0) {
                await Promise.all(promises);
                console.log(`Sincronizzazione DB completata: ${promises.length} scritture eseguite.`);
            }
            
            lastSavedStateStr = JSON.stringify(state);
        } catch (error) {
            console.error("Errore durante il salvataggio:", error);
        }
    },

    // Log Out Sicuro
    async secureLogOut() {
        try {
            document.getElementById('sync-overlay').style.display = 'flex';
            console.log("Attendo il completamento delle scritture offline...");
            await waitForPendingWrites();
            console.log("Tutti i dati sincronizzati. Eseguo il Log Out.");
            await auth.signOut();
        } catch (error) {
            console.error("Errore durante il Log Out:", error);
            alert("Errore durante il Log Out. Controlla la connessione.");
        } finally {
            document.getElementById('sync-overlay').style.display = 'none';
        }
    },

    // Elimina definitivamente l'account e tutti i dati associati
    async deleteAccount() {
        const user = auth.currentUser;
        if (!user) return;
        
        try {
            document.getElementById('sync-overlay').style.display = 'flex';
            
            // 1. Elimina i documenti dalle subcollections (History e Nutrition)
            // Poichè non possiamo eliminare ricorsivamente da client in Firestore facilmente, 
            // recuperiamo i docs e li cancelliamo
            const histSnap = await getDocs(collection(db, "users", user.uid, "history"));
            const nutSnap = await getDocs(collection(db, "users", user.uid, "nutrition"));
            
            const delPromises = [];
            histSnap.forEach(d => delPromises.push(deleteDoc(d.ref)));
            nutSnap.forEach(d => delPromises.push(deleteDoc(d.ref)));
            await Promise.all(delPromises);

            // 2. Elimina il documento principale
            const docRef = doc(db, "users", user.uid);
            await deleteDoc(docRef);
            
            // 3. Elimina l'utente dall'Authentication
            await deleteUser(user);
            
        } catch (error) {
            console.error("Errore nell'eliminazione dell'account:", error);
            if (error.code === 'auth/requires-recent-login') {
                alert("Per motivi di sicurezza, devi ricaricare la pagina ed effettuare di nuovo il login prima di poter eliminare il tuo account.");
            } else {
                alert("Impossibile eliminare l'account in questo momento. Errore: " + error.message);
            }
        } finally {
            document.getElementById('sync-overlay').style.display = 'none';
        }
    }
};
