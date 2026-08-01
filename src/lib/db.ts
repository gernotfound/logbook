import { auth, db, waitForPendingWrites, deleteUser } from './firebase';
import { doc, getDoc, collection, getDocs, writeBatch } from "firebase/firestore";
import deepEqual from "fast-deep-equal";
let lastSavedStateStr: string | null = null;

function checkDocSize(data: any, docName: string) {
    const jsonStr = JSON.stringify(data);
    const sizeBytes = new Blob([jsonStr]).size;
    if (sizeBytes > 950000) { // Limit threshold below 1MB
        throw new Error(`Il documento ${docName} supera il limite di dimensione di Firestore (1MB). Ridurre i dati inseriti.`);
    }
}

export const DB = {
    resetCache() {
        lastSavedStateStr = null;
    },
    async loadUserData() {
        const user = auth.currentUser;
        if (!user) return null;
        try {
            const defaultNutritionPlanning: Record<string, any> = {
                weight: 80,
                carbsPerKg: 3.5,
                proPerKg: 2.0,
                fatPerKg: 1.0,
                lockedMacro: null,
                chartPeriod: 7,
                normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
            };
            const state: Record<string, any> = { 
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
            const docRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data() as Record<string, any>;
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
            } else {
                // Seleziona il branch corretto: se è un nuovo utente, restituiamo lo stato di default invece di null,
                // in modo che l'app possa avviarsi e le viste non rimangano bloccate su loading=true.
                lastSavedStateStr = JSON.stringify(state);
                return state;
            }

            // Bucketing by Month
            const histSnap = await getDocs(collection(db, "users", user.uid, "history_months"));
            histSnap.forEach((d: any) => {
                const monthData = d.data() as Record<string, any>;
                Object.values(monthData).forEach((h: any) => state.history.push(h));
            });
            
            const nutSnap = await getDocs(collection(db, "users", user.uid, "nutrition_months"));
            nutSnap.forEach((d: any) => {
                const monthData = d.data() as Record<string, any>;
                Object.keys(monthData).forEach((date: string) => {
                    (state.nutrition as any)[date] = monthData[date];
                });
            });
            
            state.history.sort((a: any,b: any) => (b.globalStartTime || 0) - (a.globalStartTime || 0));
            lastSavedStateStr = JSON.stringify(state);
            return state;
        } catch (error: any) {
            console.error("Errore caricamento dati dal cloud:", error);
            throw error;
        }
    },
    async saveUserData(state: Record<string, any>) {
        const user = auth.currentUser;
        if (!user) return;
        try {
            let oldState: Record<string, any> = { profile: {}, library: [], routines: [], customFoods: [], history: [], nutrition: {}, activeWorkout: null, nutritionPlanning: null };
            if (lastSavedStateStr) {
                oldState = JSON.parse(lastSavedStateStr);
            }
            
            const batch = writeBatch(db);
            let hasWrites = false;
            
            // 1. User doc updates
            if (!deepEqual(state.profile, oldState.profile) ||
                !deepEqual(state.library, oldState.library) ||
                !deepEqual(state.routines, oldState.routines) ||
                !deepEqual(state.customFoods, oldState.customFoods) ||
                !deepEqual(state.activeWorkout, oldState.activeWorkout) ||
                !deepEqual(state.nutritionPlanning, oldState.nutritionPlanning)) {
                
                const userRef = doc(db, "users", user.uid);
                const userDocData = {
                    profile: state.profile,
                    library: state.library,
                    routines: state.routines,
                    customFoods: state.customFoods || [],
                    activeWorkout: state.activeWorkout || null,
                    nutritionPlanning: state.nutritionPlanning || null
                };
                checkDocSize(userDocData, "User Profile");
                batch.set(userRef, userDocData, { merge: true });
                hasWrites = true;
            }

            // 2. Group History by Month (YYYY-MM)
            const newHistMonths: Record<string, any> = {};
            state.history.forEach((h: any) => {
                const date = new Date(h.globalStartTime || Date.now());
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                if (!newHistMonths[monthKey]) newHistMonths[monthKey] = {};
                newHistMonths[monthKey][h.id] = h;
            });

            const oldHistMonths: Record<string, any> = {};
            (oldState.history || []).forEach((h: any) => {
                const date = new Date(h.globalStartTime || Date.now());
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                if (!oldHistMonths[monthKey]) oldHistMonths[monthKey] = {};
                oldHistMonths[monthKey][h.id] = h;
            });

            Object.keys(newHistMonths).forEach(month => {
                if (!deepEqual(newHistMonths[month], oldHistMonths[month])) {
                    checkDocSize(newHistMonths[month], `History ${month}`);
                    batch.set(doc(db, "users", user.uid, "history_months", month), newHistMonths[month]);
                    hasWrites = true;
                }
            });
            Object.keys(oldHistMonths).forEach(month => {
                if (!newHistMonths[month]) {
                    batch.delete(doc(db, "users", user.uid, "history_months", month));
                    hasWrites = true;
                }
            });

            // 3. Group Nutrition by Month (YYYY-MM)
            const newNutMonths: Record<string, any> = {};
            Object.keys(state.nutrition || {}).forEach(date => {
                const monthKey = date.substring(0, 7);
                if (!newNutMonths[monthKey]) newNutMonths[monthKey] = {};
                newNutMonths[monthKey][date] = state.nutrition[date];
            });

            const oldNutMonths: Record<string, any> = {};
            Object.keys(oldState.nutrition || {}).forEach(date => {
                const monthKey = date.substring(0, 7);
                if (!oldNutMonths[monthKey]) oldNutMonths[monthKey] = {};
                oldNutMonths[monthKey][date] = oldState.nutrition[date];
            });

            Object.keys(newNutMonths).forEach(month => {
                if (!deepEqual(newNutMonths[month], oldNutMonths[month])) {
                    checkDocSize(newNutMonths[month], `Nutrition ${month}`);
                    batch.set(doc(db, "users", user.uid, "nutrition_months", month), newNutMonths[month]);
                    hasWrites = true;
                }
            });
            Object.keys(oldNutMonths).forEach(month => {
                if (!newNutMonths[month]) {
                    batch.delete(doc(db, "users", user.uid, "nutrition_months", month));
                    hasWrites = true;
                }
            });

            if (hasWrites) {
                await batch.commit();
                console.log(`Sincronizzazione DB completata.`);
            }
            lastSavedStateStr = JSON.stringify(state);
        } catch (error) {
            console.error("Errore durante il salvataggio:", error);
            throw error;
        }
    },
    async secureLogOut() {
        console.log("Attendo il completamento delle scritture offline...");
        await waitForPendingWrites(db);
        console.log("Tutti i dati sincronizzati. Eseguo il Log Out.");
        await auth.signOut();
    },
    async deleteAccount() {
        const user = auth.currentUser;
        if (!user) return;
        try {
            // 1. Fetch subcollection documents while auth is valid
            const histSnap = await getDocs(collection(db, "users", user.uid, "history_months")).catch(e => {
                console.warn("Permesso negato per leggere history_months, proseguo...", e);
                return { forEach: () => {} } as any;
            });
            const nutSnap = await getDocs(collection(db, "users", user.uid, "nutrition_months")).catch(e => {
                console.warn("Permesso negato per leggere nutrition_months, proseguo...", e);
                return { forEach: () => {} } as any;
            });
            
            const batch = writeBatch(db);
            histSnap.forEach((d: any) => batch.delete(d.ref));
            nutSnap.forEach((d: any) => batch.delete(d.ref));
            
            // 2. Delete main user document
            const userDocRef = doc(db, "users", user.uid);
            batch.delete(userDocRef);
            
            await batch.commit();
            
            // 3. Delete Firebase Auth user account
            await deleteUser(user);
        } catch (error: any) {
            console.error("Errore nell'eliminazione dell'account:", error);
            if (error.code === 'auth/requires-recent-login') {
                throw new Error("Per motivi di sicurezza, devi ricaricare la pagina ed effettuare di nuovo il login prima di poter eliminare il tuo account.");
            }
            throw error;
        }
    }
};
