import { auth, getDb, waitForPendingWrites, deleteUser, ensureAppCheck } from './firebase';
import { doc, getDoc, collection, getDocs, writeBatch } from "firebase/firestore";
import deepEqual from "fast-deep-equal";
import { DomainParsers } from './schema';
import type { UserData, CatalogOverrides, SyncResult } from '../types';
import { getLocalDateString } from './utils/date';
import { removeUndefinedValues } from './utils/object';
import { checkDocSize } from './checkDocSize';
import { syncGlobalCatalog, getInMemoryCatalog, getCachedCatalog, getSeedCatalog } from './catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods, extractCustomExercisesAndOverrides, extractCustomFoodsAndOverrides } from './catalog/deltaResolver';
import { wrapInFirestoreDocument } from './firestore-rest';
import { set, get, del } from 'idb-keyval';
import { useDialogStore } from '../store/useDialogStore';

export class SyncTimeoutError extends Error {
    constructor(message: string = "Timeout operazione Firestore") {
        super(message);
        this.name = "SyncTimeoutError";
    }
}

let lastSavedStateStr: string | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, errMsg = "Timeout operazione Firestore"): Promise<T> {
    let timer: any;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SyncTimeoutError(errMsg)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const DB = {
    resetCache() {
        lastSavedStateStr = null;
    },
    async loadUserData(): Promise<UserData | null> {
        const user = auth.currentUser;
        if (!user) return null;
        try {
            // App is open: clear SW pending sync payloads, Firestore SDK will handle its own offline queue
            Promise.all([
                get('sync_failed').then(failed => {
                    if (failed) {
                        console.warn("Precedente Background Sync fallito. Ci penserà l'SDK di Firestore ora.");
                        useDialogStore.getState().showAlert(
                            "Sincronizzazione in background interrotta",
                            "Mentre eri offline, l'app ha provato a salvare i dati in background ma la connessione era instabile o il token è scaduto. Nessun problema: il salvataggio verrà completato automaticamente adesso che sei online."
                        );
                    }
                    return set('sync_failed', false);
                }),
                del('pending_sync_payload'),
                del('pending_sync_token')
            ]).catch(() => {});

            const state: Record<string, any> = { 
                profile: {}, 
                library: [], 
                routines: [], 
                history: [], 
                nutrition: {}, 
                customFoods: [],
                activeWorkout: null,
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null,
                supplements: [],
                activePains: [],
                legalConsent: null
            };
            await ensureAppCheck();
            const docRef = doc(getDb(), "users", user.uid);
            // 1. Get cached/seed catalog (offline-resilient)
            const catalog = await getCachedCatalog();
            // Background sync manifest if online (fire-and-forget)
            syncGlobalCatalog(getDb()).catch(() => {});

            const docSnap = await withTimeout(getDoc(docRef), 6000, "Timeout recupero profilo utente");
            if (docSnap && typeof docSnap.exists === 'function' && docSnap.exists()) {
                const data = docSnap.data() as Record<string, any>;
                if(data.profile) state.profile = data.profile;
                
                state.catalogOverrides = data.catalogOverrides || {};
                
                // 2. Resolve Library and CustomFoods using deltaResolver!
                const customExercises = data.library || [];
                const customFoods = data.customFoods || [];
                
                state.library = resolveEffectiveExercises(catalog.exercises, customExercises, state.catalogOverrides);
                state.customFoods = resolveEffectiveFoods(catalog.foods, customFoods, state.catalogOverrides);
                
                if(data.routines) state.routines = data.routines;
                if(data.activeWorkout !== undefined) state.activeWorkout = data.activeWorkout;
                if(data.trainingCycles) state.trainingCycles = data.trainingCycles;
                if(data.activeCycleId !== undefined) state.activeCycleId = data.activeCycleId;
                if(data.supplements) state.supplements = data.supplements;
                if(data.nutritionPlanning) state.nutritionPlanning = data.nutritionPlanning;
                if(data.activePains) state.activePains = data.activePains;
                if(data.legalConsent) state.legalConsent = data.legalConsent;
            } else if (!docSnap || (typeof docSnap.exists === 'function' && !docSnap.exists())) {
                state.library = resolveEffectiveExercises(catalog.exercises, [], state.catalogOverrides);
                state.customFoods = resolveEffectiveFoods(catalog.foods, [], state.catalogOverrides);
                // Seleziona il branch corretto: se è un nuovo utente, restituiamo lo stato di default invece di null,
                // in modo che l'app possa avviarsi e le viste non rimangano bloccate su loading=true.
                state.profile = DomainParsers.parseProfile(state.profile);
                state.library = DomainParsers.parseLibrary(state.library);
                state.routines = DomainParsers.parseRoutines(state.routines);
                state.history = DomainParsers.parseHistory(state.history);
                state.nutrition = DomainParsers.parseNutrition(state.nutrition);
                state.customFoods = DomainParsers.parseCustomFoods(state.customFoods);
                state.trainingCycles = DomainParsers.parseTrainingCycles(state.trainingCycles);
                state.supplements = DomainParsers.parseSupplements(state.supplements);
                state.activePains = DomainParsers.parseActivePains(state.activePains);
                if (state.activeWorkout) state.activeWorkout = DomainParsers.parseWorkoutSession(state.activeWorkout);
                if (state.nutritionPlanning) state.nutritionPlanning = DomainParsers.parseNutritionPlanning(state.nutritionPlanning);
                if (state.legalConsent) state.legalConsent = DomainParsers.parseLegalConsent(state.legalConsent);
                
                lastSavedStateStr = JSON.stringify(state);
                return state as unknown as UserData;
            }

            // Windowed loading: target current month and previous 2 months (O(1) reads)
            const now = new Date();
            const targetMonths = [0, 1, 2].map(offset => {
                const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            });

            const historyDocs = await withTimeout(
                Promise.all(targetMonths.map(m => getDoc(doc(getDb(), "users", user.uid, "history_months", m)))),
                6000,
                "Timeout recupero storico"
            );
            historyDocs.forEach(d => {
                if (d && typeof d.exists === 'function' && d.exists()) {
                    const monthData = d.data() as Record<string, any>;
                    if (monthData) {
                        Object.values(monthData).forEach((h: any) => state.history.push(h));
                    }
                }
            });
            
            const nutritionDocs = await withTimeout(
                Promise.all(targetMonths.map(m => getDoc(doc(getDb(), "users", user.uid, "nutrition_months", m)))),
                6000,
                "Timeout recupero nutrizione"
            );
            nutritionDocs.forEach(d => {
                if (d && typeof d.exists === 'function' && d.exists()) {
                    const monthData = d.data() as Record<string, any>;
                    if (monthData) {
                        Object.keys(monthData).forEach((date: string) => {
                            (state.nutrition as any)[date] = monthData[date];
                        });
                    }
                }
            });
            
            state.history.sort((a: any,b: any) => (b.globalStartTime || 0) - (a.globalStartTime || 0));
            
            state.profile = DomainParsers.parseProfile(state.profile);
            state.library = DomainParsers.parseLibrary(state.library);
            state.routines = DomainParsers.parseRoutines(state.routines);
            state.history = DomainParsers.parseHistory(state.history);
            state.nutrition = DomainParsers.parseNutrition(state.nutrition);
            state.customFoods = DomainParsers.parseCustomFoods(state.customFoods);
            state.trainingCycles = DomainParsers.parseTrainingCycles(state.trainingCycles);
            state.supplements = DomainParsers.parseSupplements(state.supplements);
            state.activePains = DomainParsers.parseActivePains(state.activePains);
            if (state.activeWorkout) state.activeWorkout = DomainParsers.parseWorkoutSession(state.activeWorkout);
            if (state.nutritionPlanning) state.nutritionPlanning = DomainParsers.parseNutritionPlanning(state.nutritionPlanning);
            if (state.legalConsent) state.legalConsent = DomainParsers.parseLegalConsent(state.legalConsent);
            
            lastSavedStateStr = JSON.stringify(state);
            return state as unknown as UserData;
        } catch (error: any) {
            console.error("Errore caricamento dati dal cloud:", error);
            throw error;
        }
    },
    async saveUserData(state: Record<string, any>): Promise<SyncResult> {
        const user = auth.currentUser;
        if (!user) return { ok: true, status: 'synced' };
        try {
            let oldState: Record<string, any> = { 
                profile: {}, 
                library: [], 
                routines: [], 
                customFoods: [], 
                history: [], 
                nutrition: {}, 
                activeWorkout: null, 
                trainingCycles: [],
                activeCycleId: null,
                nutritionPlanning: null,
                supplements: [],
                activePains: [],
                catalogOverrides: {},
                legalConsent: null
            };
            if (lastSavedStateStr) {
                oldState = JSON.parse(lastSavedStateStr);
            }
            
            await ensureAppCheck();
            const batch = writeBatch(getDb());
            let hasWrites = false;
            const restWrites: any[] = [];
            const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
            
            // Re-split library & customFoods into pure overrides/custom so we don't save the whole catalog
            const catalog = getInMemoryCatalog(true) || getSeedCatalog();
            const { customExercises, overrides: exOverrides } = extractCustomExercisesAndOverrides(state.library || [], catalog.exercises);
            const { customFoods, overrides: foodOverrides } = extractCustomFoodsAndOverrides(state.customFoods || [], catalog.foods);
            
            const overridesToSave: CatalogOverrides = {
                ...(state.catalogOverrides || {}),
                exercises: {
                    ...(state.catalogOverrides?.exercises || {}),
                    ...(exOverrides.exercises || {})
                },
                hiddenExerciseIds: Array.from(new Set([
                    ...(state.catalogOverrides?.hiddenExerciseIds || []),
                    ...(exOverrides.hiddenExerciseIds || [])
                ])),
                foods: {
                    ...(state.catalogOverrides?.foods || {}),
                    ...(foodOverrides.foods || {})
                },
                hiddenFoodIds: Array.from(new Set([
                    ...(state.catalogOverrides?.hiddenFoodIds || []),
                    ...(foodOverrides.hiddenFoodIds || [])
                ]))
            };
            const effectiveCustomExercises = customExercises;
            const effectiveCustomFoods = customFoods;
            
            // 1. User doc updates
            if (!deepEqual(state.profile, oldState.profile) ||
                !deepEqual(state.library, oldState.library) ||
                !deepEqual(state.routines, oldState.routines) ||
                !deepEqual(state.customFoods, oldState.customFoods) ||
                !deepEqual(state.activeWorkout, oldState.activeWorkout) ||
                !deepEqual(state.trainingCycles, oldState.trainingCycles) ||
                !deepEqual(state.activeCycleId, oldState.activeCycleId) ||
                !deepEqual(state.nutritionPlanning, oldState.nutritionPlanning) ||
                !deepEqual(state.supplements, oldState.supplements) ||
                !deepEqual(state.activePains, oldState.activePains) ||
                !deepEqual(state.catalogOverrides, oldState.catalogOverrides) ||
                !deepEqual(state.legalConsent, oldState.legalConsent) ||
                !deepEqual(state.nutritionPlanningOrigin, oldState.nutritionPlanningOrigin)) {
                
                const userRef = doc(getDb(), "users", user.uid);
                const userDocData = {
                    profile: state.profile || {},
                    library: effectiveCustomExercises,
                    routines: state.routines || [],
                    customFoods: effectiveCustomFoods,
                    activeWorkout: state.activeWorkout || null,
                    trainingCycles: state.trainingCycles || [],
                    activeCycleId: state.activeCycleId !== undefined ? state.activeCycleId : null,
                    nutritionPlanning: state.nutritionPlanning || null,
                    supplements: state.supplements || [],
                    activePains: state.activePains || [],
                    catalogOverrides: overridesToSave,
                    legalConsent: state.legalConsent || null,
                    nutritionPlanningOrigin: state.nutritionPlanningOrigin || null
                };
                const cleanUserDocData = removeUndefinedValues(userDocData);
                checkDocSize(cleanUserDocData, "User Profile");
                batch.set(userRef, cleanUserDocData, { merge: true });
                restWrites.push({
                    update: {
                        name: `projects/${projectId}/databases/(default)/documents/users/${user.uid}`,
                        ...wrapInFirestoreDocument(cleanUserDocData)
                    },
                    updateMask: {
                        fieldPaths: Object.keys(cleanUserDocData)
                    }
                });
                hasWrites = true;
            }

            // 2. Group History by Month (YYYY-MM) with timezone-safe monthKey
            const newHistMonths: Record<string, any> = {};
            state.history.forEach((h: any) => {
                const monthKey = (h.date && typeof h.date === 'string' && h.date.length >= 7)
                    ? h.date.substring(0, 7)
                    : (h.globalStartTime ? getLocalDateString(h.globalStartTime).substring(0, 7) : getLocalDateString().substring(0, 7));
                if (!newHistMonths[monthKey]) newHistMonths[monthKey] = {};
                newHistMonths[monthKey][h.id] = h;
            });

            const oldHistMonths: Record<string, any> = {};
            (oldState.history || []).forEach((h: any) => {
                const monthKey = (h.date && typeof h.date === 'string' && h.date.length >= 7)
                    ? h.date.substring(0, 7)
                    : (h.globalStartTime ? getLocalDateString(h.globalStartTime).substring(0, 7) : getLocalDateString().substring(0, 7));
                if (!oldHistMonths[monthKey]) oldHistMonths[monthKey] = {};
                oldHistMonths[monthKey][h.id] = h;
            });

            Object.keys(newHistMonths).forEach(month => {
                if (!deepEqual(newHistMonths[month], oldHistMonths[month])) {
                    const cleanDoc = removeUndefinedValues(newHistMonths[month]);
                    checkDocSize(cleanDoc, `History ${month}`);
                    batch.set(doc(getDb(), "users", user.uid, "history_months", month), cleanDoc);
                    restWrites.push({
                        update: {
                            name: `projects/${projectId}/databases/(default)/documents/users/${user.uid}/history_months/${month}`,
                            ...wrapInFirestoreDocument(cleanDoc)
                        }
                    });
                    hasWrites = true;
                }
            });
            Object.keys(oldHistMonths).forEach(month => {
                if (!newHistMonths[month]) {
                    batch.delete(doc(getDb(), "users", user.uid, "history_months", month));
                    restWrites.push({
                        delete: `projects/${projectId}/databases/(default)/documents/users/${user.uid}/history_months/${month}`
                    });
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
                    const cleanDoc = removeUndefinedValues(newNutMonths[month]);
                    checkDocSize(cleanDoc, `Nutrition ${month}`);
                    batch.set(doc(getDb(), "users", user.uid, "nutrition_months", month), cleanDoc);
                    restWrites.push({
                        update: {
                            name: `projects/${projectId}/databases/(default)/documents/users/${user.uid}/nutrition_months/${month}`,
                            ...wrapInFirestoreDocument(cleanDoc)
                        }
                    });
                    hasWrites = true;
                }
            });
            Object.keys(oldNutMonths).forEach(month => {
                if (!newNutMonths[month]) {
                    batch.delete(doc(getDb(), "users", user.uid, "nutrition_months", month));
                    restWrites.push({
                        delete: `projects/${projectId}/databases/(default)/documents/users/${user.uid}/nutrition_months/${month}`
                    });
                    hasWrites = true;
                }
            });

            if (hasWrites) {
                try {
                    await withTimeout(batch.commit(), 7000, "Timeout sincronizzazione Firestore");
                    console.log(`Sincronizzazione DB completata.`);
                    lastSavedStateStr = JSON.stringify(state);
                    await set('sync_failed', false); // Clear flag on success
                    return { ok: true, status: 'synced' };
                } catch (batchErr: unknown) {
                    const code = (batchErr && typeof batchErr === 'object' && 'code' in batchErr) 
                        ? (batchErr as any).code 
                        : undefined;
                        
                    if (code === 'permission-denied') {
                        return { ok: false, status: 'rejected', error: batchErr };
                    }
                    if (batchErr instanceof SyncTimeoutError || code === 'unavailable' || (typeof navigator !== 'undefined' && !navigator.onLine)) {
                        console.warn("Scrittura archiviata nella cache locale Firestore (offline):", batchErr);
                        // Do NOT update lastSavedStateStr: diffing will retry when back online
                        
                        try {
                            const token = await user.getIdToken();
                            await set('pending_sync_payload', { writes: restWrites, projectId });
                            await set('pending_sync_token', token);
                            
                            if ('serviceWorker' in navigator) {
                                const reg = await navigator.serviceWorker.ready;
                                if ('sync' in reg) {
                                    await (reg as any).sync.register('logbook-sync');
                                    console.log("Background Sync registrato con successo.");
                                }
                            }
                        } catch (syncErr) {
                            console.error("Errore durante la registrazione del Background Sync:", syncErr);
                        }
                        return { ok: false, status: 'local-pending', error: batchErr };
                    } else {
                        console.error("Errore critico durante il salvataggio Firestore:", batchErr);
                        return { ok: false, status: 'failed', error: batchErr };
                    }
                }
            } else {
                lastSavedStateStr = JSON.stringify(state);
                return { ok: true, status: 'synced' };
            }
        } catch (error) {
            console.error("Errore durante il salvataggio:", error);
            return { ok: false, status: 'failed', error };
        }
    },
    async secureLogOut() {
        console.log("Attendo il completamento delle scritture offline...");
        try {
            await withTimeout(waitForPendingWrites(getDb()), 2500, "Timeout scritture offline");
            console.log("Tutti i dati sincronizzati. Eseguo il Log Out.");
        } catch (err) {
            console.warn("Disconnessione con scritture in cache locale:", err);
        }
        await auth.signOut();
        try {
            await del('logbook_cached_user_data');
            localStorage.removeItem('logbook_local_workout');
            localStorage.removeItem('logbook_is_guest');
            // Nota: non eliminiamo le cache del Service Worker (caches.keys()) perché 
            // contengono solo gli asset statici (App Shell) e non i dati sensibili.
            // Cancellarle romperebbe il supporto offline della PWA.
        } catch (e) {
            console.warn("Errore pulizia storage offline al logout:", e);
        }
    },
    async deleteAccount() {
        const user = auth.currentUser;
        if (!user) throw new Error("Nessun utente autenticato.");
        try {
            try {
                await del('logbook_cached_user_data');
                localStorage.removeItem('logbook_local_workout');
                localStorage.removeItem('logbook_is_guest');
            } catch (e) {}
            // 1. Fetch subcollection documents while auth is valid
            await ensureAppCheck();
            const [histSnap, nutSnap, errSnap, evtSnap, anomSnap] = await Promise.all([
                getDocs(collection(getDb(), "users", user.uid, "history_months")).catch(e => {
                    console.warn("Permesso negato per leggere history_months, proseguo...", e);
                    return { forEach: () => {} } as any;
                }),
                getDocs(collection(getDb(), "users", user.uid, "nutrition_months")).catch(e => {
                    console.warn("Permesso negato per leggere nutrition_months, proseguo...", e);
                    return { forEach: () => {} } as any;
                }),
                getDocs(collection(getDb(), "users", user.uid, "telemetry_errors")).catch(e => {
                    console.warn("Permesso negato per leggere telemetry_errors, proseguo...", e);
                    return { forEach: () => {} } as any;
                }),
                getDocs(collection(getDb(), "users", user.uid, "telemetry_events")).catch(e => {
                    console.warn("Permesso negato per leggere telemetry_events, proseguo...", e);
                    return { forEach: () => {} } as any;
                }),
                getDocs(collection(getDb(), "users", user.uid, "telemetry_anomalies")).catch(e => {
                    console.warn("Permesso negato per leggere telemetry_anomalies, proseguo...", e);
                    return { forEach: () => {} } as any;
                })
            ]);

            const allRefs: any[] = [];
            histSnap?.forEach?.((d: any) => allRefs.push(d.ref));
            nutSnap?.forEach?.((d: any) => allRefs.push(d.ref));
            errSnap?.forEach?.((d: any) => allRefs.push(d.ref));
            evtSnap?.forEach?.((d: any) => allRefs.push(d.ref));
            anomSnap?.forEach?.((d: any) => allRefs.push(d.ref));
            allRefs.push(doc(getDb(), "users", user.uid));

            // Chunk in max 400 operations per batch to strictly adhere to Firestore 500 limit
            const CHUNK_SIZE = 400;
            for (let i = 0; i < allRefs.length; i += CHUNK_SIZE) {
                const chunk = allRefs.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(getDb());
                chunk.forEach(ref => batch.delete(ref));
                try {
                    await withTimeout(batch.commit(), 7000, "Timeout eliminazione batch account");
                } catch (batchErr: any) {
                    if (batchErr?.code === 'permission-denied') {
                        console.warn("Impossibile eliminare i dati cloud (permesso Firestore), procedo con l'eliminazione dell'account Auth.");
                    } else {
                        throw batchErr;
                    }
                }
            }

            // 2. Delete Firebase Auth user account
            await deleteUser(user);
            console.log("Account e relative subcollection eliminati con successo.");
        } catch (error: any) {
            console.error("Errore nell'eliminazione dell'account:", error);
            if (error.code === 'auth/requires-recent-login') {
                throw new Error("Per motivi di sicurezza, devi ricaricare la pagina ed effettuare di nuovo il login prima di poter eliminare il tuo account.");
            }
            throw error;
        }
    }
};
