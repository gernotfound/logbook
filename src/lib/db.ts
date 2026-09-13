import { auth, getDb, ensureAppCheck } from './firebase';
import { doc, getDoc, collection, getDocsFromServer, query, limit, orderBy, documentId, startAfter, type QueryDocumentSnapshot } from "firebase/firestore";
// import deepEqual from "fast-deep-equal";
import { DomainParsers } from './schema';
import type { UserData, SyncResult } from '../types';
// import { removeUndefinedValues } from './utils/object';
// import { checkDocSize } from './checkDocSize';
import { syncGlobalCatalog, getCachedCatalog } from './catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from './catalog/deltaResolver';
// import { wrapInFirestoreDocument } from './firestore-rest';
import { set, get, del } from 'idb-keyval';
import { useDialogStore } from '../store/useDialogStore';

// Nuovi import per la parte splittata del DB
import { withTimeout, setLastSavedStateStr } from './db/db_core';
import { loadHistoryMonths } from './db/db_training';
import { loadNutritionMonths } from './db/db_nutrition';
import { purgeAllLocalUserData, deleteAccount } from './db/db_account';
import { storageOwner } from './sync/session';

export const DB = {
    resetCache() {
        setLastSavedStateStr(null);
    },
    async loadUserData(options?: { allMonths?: boolean }): Promise<UserData | null> {
        const user = auth.currentUser;
        if (!user) return null;
        try {
            // App is open: clear SW pending sync payloads, Firestore SDK will handle its own offline queue
            Promise.all([
                get('sync_failed').then(failed => {
                    if (failed) {
                        console.warn("Precedente Background Sync fallito. Ci penserÃ  l'SDK di Firestore ora.");
                        useDialogStore.getState().showAlert(
                            "Sincronizzazione in background interrotta",
                            "Mentre eri offline, l'app ha provato a salvare i dati in background ma la connessione era instabile o il token Ã¨ scaduto. Nessun problema: il salvataggio verrÃ  completato automaticamente adesso che sei online."
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
                // Strict normalization: only accept known enum values, never trust raw Firestore data
                state.nutritionPlanningOrigin = (data.nutritionPlanningOrigin === 'generated-default' || data.nutritionPlanningOrigin === 'user-edited')
                    ? data.nutritionPlanningOrigin
                    : undefined;
                if(data.activePains) state.activePains = data.activePains;
                if(data.legalConsent) state.legalConsent = data.legalConsent;
            } else if (!docSnap || (typeof docSnap.exists === 'function' && !docSnap.exists())) {
                state.library = resolveEffectiveExercises(catalog.exercises, [], state.catalogOverrides);
                state.customFoods = resolveEffectiveFoods(catalog.foods, [], state.catalogOverrides);
                // Seleziona il branch corretto: se Ã¨ un nuovo utente, restituiamo lo stato di default invece di null,
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

                setLastSavedStateStr(JSON.stringify(state));
                return state as unknown as UserData;
            }

            if (options?.allMonths) {
                // Complete paginated retrieval for guest-to-cloud linking / migration
                const db = getDb();
                for (const colName of ['history_months', 'nutrition_months']) {
                    let cursor: QueryDocumentSnapshot | undefined;
                    do {
                        const constraints: any[] = [orderBy(documentId()), limit(400)];
                        if (cursor) constraints.push(startAfter(cursor));
                        const page = await withTimeout(
                            getDocsFromServer(query(collection(db, "users", user.uid, colName), ...constraints)),
                            10000,
                            `Timeout recupero ${colName} completo`
                        );
                        for (const d of page.docs) {
                            const mData = d.data() as Record<string, any>;
                            if (mData) {
                                if (colName === 'history_months') {
                                    Object.values(mData).forEach((h: any) => state.history.push(h));
                                } else {
                                    Object.keys(mData).forEach(dt => { (state.nutrition as any)[dt] = mData[dt]; });
                                }
                            }
                        }
                        cursor = page.size === 400 ? page.docs[page.docs.length - 1] : undefined;
                    } while (cursor);
                }
            } else {
                // Windowed loading: target current month and previous 2 months (O(1) reads)
                const now = new Date();
                const targetMonths = [0, 1, 2].map(offset => {
                    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                });

                await loadHistoryMonths(user, targetMonths, state);
                await loadNutritionMonths(user, targetMonths, state);
            }

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

            setLastSavedStateStr(JSON.stringify(state));
            return state as unknown as UserData;
        } catch (error: any) {
            console.error("Errore caricamento dati dal cloud:", error);
            throw error;
        }
    },
    async saveUserData(state: Record<string, any>, _revision?: any): Promise<SyncResult> {
        const user = auth.currentUser;
        if (!user) return { ok: true, status: 'synced' };
        try {
            await ensureAppCheck();
            const { replicateJournal } = await import('./sync/replicateJournal');
            
            const result = await replicateJournal();
            if (result.ok) {
                setLastSavedStateStr(JSON.stringify(state));
            }
            return result;
        } catch (error) {
            console.error('Errore durante il salvataggio:', error);
            return { ok: false, status: 'local-pending', error };
        }
    },
    async purgeAllLocalUserData(owner?: string) {
        return purgeAllLocalUserData(owner);
    },
    async secureLogOut() {
        console.log("Eseguo il Log Out protetto...");
        const owner = storageOwner();
        await auth.signOut();
        await this.purgeAllLocalUserData(owner);
    },
    async deleteAccount() {
        return deleteAccount(this);
    }
};


