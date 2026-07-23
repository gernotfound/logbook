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
            const defaultNutritionPlanning = {
                weight: 80,
                carbsPerKg: 3.5,
                proPerKg: 2.0,
                fatPerKg: 1.0,
                lockedMacro: null,
                chartPeriod: 7,
                normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
            };
            const state = { 
                profile: {}, 
                library: [], 
                routines: [], 
                history: [], 
                nutrition: {}, 
                customFoods: [],
                activeWorkout: null,
                nutritionPlanning: Object.assign({}, defaultNutritionPlanning, {
                    normocalorica: Object.assign({}, defaultNutritionPlanning.normocalorica)
                })
            };
            let needsMigration = false;

            const docRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const data = docSnap.data();
                if(data.profile) state.profile = data.profile;
                if(data.library) state.library = data.library;
                if(data.routines) state.routines = data.routines;
                if(data.customFoods) state.customFoods = data.customFoods;
                if(data.activeWorkout !== undefined) state.activeWorkout = data.activeWorkout;
                if (data.nutritionPlanning) {
                    state.nutritionPlanning = Object.assign({}, defaultNutritionPlanning, data.nutritionPlanning);
                    if (data.nutritionPlanning.normocalorica && typeof data.nutritionPlanning.normocalorica === 'object') {
                        state.nutritionPlanning.normocalorica = Object.assign({}, defaultNutritionPlanning.normocalorica, data.nutritionPlanning.normocalorica);
                    } else {
                        state.nutritionPlanning.normocalorica = Object.assign({}, defaultNutritionPlanning.normocalorica);
                    }
                }
                
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
                    customFoods: state.customFoods,
                    activeWorkout: state.activeWorkout,
                    nutritionPlanning: state.nutritionPlanning,
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
            let oldState = { profile: {}, library: [], routines: [], customFoods: [], history: [], nutrition: {}, activeWorkout: null, nutritionPlanning: null };
            if (lastSavedStateStr) {
                oldState = JSON.parse(lastSavedStateStr);
            }

            const promises = [];

            // Controlla se i dati principali sono cambiati
            if (JSON.stringify(state.profile) !== JSON.stringify(oldState.profile) ||
                JSON.stringify(state.library) !== JSON.stringify(oldState.library) ||
                JSON.stringify(state.routines) !== JSON.stringify(oldState.routines) ||
                JSON.stringify(state.customFoods) !== JSON.stringify(oldState.customFoods) ||
                JSON.stringify(state.activeWorkout) !== JSON.stringify(oldState.activeWorkout) ||
                JSON.stringify(state.nutritionPlanning) !== JSON.stringify(oldState.nutritionPlanning)) {
                
                const userRef = doc(db, "users", user.uid);
                promises.push(setDoc(userRef, {
                    profile: state.profile,
                    library: state.library,
                    routines: state.routines,
                    customFoods: state.customFoods || [],
                    activeWorkout: state.activeWorkout || null,
                    nutritionPlanning: state.nutritionPlanning || null,
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
            await waitForPendingWrites(db);
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
            
            // 1. Elimina i documenti dalle subcollections
            // Usiamo try/catch separati così se mancano i permessi per una subcollection, non si blocca l'intero processo
            const delPromises = [];
            try {
                const histSnap = await getDocs(collection(db, "users", user.uid, "history"));
                histSnap.forEach(d => delPromises.push(deleteDoc(d.ref)));
            } catch(e) { console.warn("Permesso negato per leggere history, proseguo...", e); }

            try {
                const nutSnap = await getDocs(collection(db, "users", user.uid, "nutrition"));
                nutSnap.forEach(d => delPromises.push(deleteDoc(d.ref)));
            } catch(e) { console.warn("Permesso negato per leggere nutrition, proseguo...", e); }
            
            if (delPromises.length > 0) {
                await Promise.all(delPromises);
            }

            // 2. Elimina il documento principale
            try {
                const docRef = doc(db, "users", user.uid);
                await deleteDoc(docRef);
            } catch(e) { console.warn("Permesso negato per eliminare il doc user, proseguo...", e); }
            
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
