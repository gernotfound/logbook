import { auth, db, waitForPendingWrites, deleteUser } from './firebase.js';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, deleteField } from "firebase/firestore";

let lastSavedStateStr = null;

export const DB = {
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
                // Check if monolithic data still exists (for future migration safety)
                if (data.history || data.nutrition) {
                    if (data.history) state.history = data.history;
                    if (data.nutrition) state.nutrition = data.nutrition;
                    needsMigration = true;
                }
            } else {
                return null;
            }

            if (!needsMigration) {
                // Bucketing by Month
                const histSnap = await getDocs(collection(db, "users", user.uid, "history_months"));
                histSnap.forEach(d => {
                    const monthData = d.data();
                    Object.values(monthData).forEach(h => state.history.push(h));
                });
                
                const nutSnap = await getDocs(collection(db, "users", user.uid, "nutrition_months"));
                nutSnap.forEach(d => {
                    const monthData = d.data();
                    Object.keys(monthData).forEach(date => {
                        state.nutrition[date] = monthData[date];
                    });
                });
                
                state.history.sort((a,b) => (b.globalStartTime || 0) - (a.globalStartTime || 0));
            } else {
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
                return state; // Will trigger a full resave on first interaction, migrating data.
            }
            lastSavedStateStr = JSON.stringify(state);
            return state;
        } catch (error) {
            console.error("Errore caricamento dati dal cloud:", error);
            throw error;
        }
    },
    async saveUserData(state) {
        const user = auth.currentUser;
        if (!user) return;
        try {
            let oldState = { profile: {}, library: [], routines: [], customFoods: [], history: [], nutrition: {}, activeWorkout: null, nutritionPlanning: null };
            if (lastSavedStateStr) {
                oldState = JSON.parse(lastSavedStateStr);
            }
            const promises = [];
            
            // 1. User doc updates
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
                    history: deleteField(), // Force cleanup of legacy monolithic fields
                    nutrition: deleteField() 
                }, { merge: true }));
            }

            // 2. Group History by Month (YYYY-MM)
            const newHistMonths = {};
            state.history.forEach(h => {
                const date = new Date(h.globalStartTime || Date.now());
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                if (!newHistMonths[monthKey]) newHistMonths[monthKey] = {};
                newHistMonths[monthKey][h.id] = h;
            });

            const oldHistMonths = {};
            (oldState.history || []).forEach(h => {
                const date = new Date(h.globalStartTime || Date.now());
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                if (!oldHistMonths[monthKey]) oldHistMonths[monthKey] = {};
                oldHistMonths[monthKey][h.id] = h;
            });

            Object.keys(newHistMonths).forEach(month => {
                if (JSON.stringify(newHistMonths[month]) !== JSON.stringify(oldHistMonths[month])) {
                    promises.push(setDoc(doc(db, "users", user.uid, "history_months", month), newHistMonths[month]));
                }
            });
            Object.keys(oldHistMonths).forEach(month => {
                if (!newHistMonths[month]) {
                    promises.push(deleteDoc(doc(db, "users", user.uid, "history_months", month)));
                }
            });

            // 3. Group Nutrition by Month (YYYY-MM)
            const newNutMonths = {};
            Object.keys(state.nutrition || {}).forEach(date => {
                // date format: YYYY-MM-DD
                const monthKey = date.substring(0, 7);
                if (!newNutMonths[monthKey]) newNutMonths[monthKey] = {};
                newNutMonths[monthKey][date] = state.nutrition[date];
            });

            const oldNutMonths = {};
            Object.keys(oldState.nutrition || {}).forEach(date => {
                const monthKey = date.substring(0, 7);
                if (!oldNutMonths[monthKey]) oldNutMonths[monthKey] = {};
                oldNutMonths[monthKey][date] = oldState.nutrition[date];
            });

            Object.keys(newNutMonths).forEach(month => {
                if (JSON.stringify(newNutMonths[month]) !== JSON.stringify(oldNutMonths[month])) {
                    promises.push(setDoc(doc(db, "users", user.uid, "nutrition_months", month), newNutMonths[month]));
                }
            });
            Object.keys(oldNutMonths).forEach(month => {
                if (!newNutMonths[month]) {
                    promises.push(deleteDoc(doc(db, "users", user.uid, "nutrition_months", month)));
                }
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
    async secureLogOut() {
        try {
            console.log("Attendo il completamento delle scritture offline...");
            await waitForPendingWrites(db);
            console.log("Tutti i dati sincronizzati. Eseguo il Log Out.");
            await auth.signOut();
        } catch (error) {
            console.error("Errore durante il Log Out:", error);
            alert("Errore durante il Log Out. Controlla la connessione.");
        }
    },
    async deleteAccount() {
        const user = auth.currentUser;
        if (!user) return;
        try {
            const delPromises = [];
            try {
                const histSnap = await getDocs(collection(db, "users", user.uid, "history_months"));
                histSnap.forEach(d => delPromises.push(deleteDoc(d.ref)));
            } catch(e) { console.warn("Permesso negato per leggere history_months, proseguo...", e); }
            try {
                const nutSnap = await getDocs(collection(db, "users", user.uid, "nutrition_months"));
                nutSnap.forEach(d => delPromises.push(deleteDoc(d.ref)));
            } catch(e) { console.warn("Permesso negato per leggere nutrition_months, proseguo...", e); }
            
            if (delPromises.length > 0) {
                await Promise.all(delPromises);
            }
            
            try {
                const docRef = doc(db, "users", user.uid);
                await deleteDoc(docRef);
            } catch(e) { console.warn("Permesso negato per eliminare il doc user, proseguo...", e); }
            
            await deleteUser(user);
        } catch (error) {
            console.error("Errore nell'eliminazione dell'account:", error);
            if (error.code === 'auth/requires-recent-login') {
                alert("Per motivi di sicurezza, devi ricaricare la pagina ed effettuare di nuovo il login prima di poter eliminare il tuo account.");
            } else {
                alert("Impossibile eliminare l'account in questo momento. Errore: " + error.message);
            }
            throw error;
        }
    }
};
