import { auth, getDb, ensureAppCheck } from './firebase';
import { doc, getDoc, writeBatch } from "firebase/firestore";
import deepEqual from "fast-deep-equal";
import { DomainParsers } from './schema';
import type { UserData, CatalogOverrides, SyncResult } from '../types';
import { removeUndefinedValues } from './utils/object';
import { checkDocSize } from './checkDocSize';
import { syncGlobalCatalog, getInMemoryCatalog, getCachedCatalog, getSeedCatalog } from './catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods, extractCustomExercisesAndOverrides, extractCustomFoodsAndOverrides } from './catalog/deltaResolver';
import { wrapInFirestoreDocument } from './firestore-rest';
import { set, get, del } from 'idb-keyval';
import { useDialogStore } from '../store/useDialogStore';

// Nuovi import per la parte splittata del DB
import { SyncTimeoutError, withTimeout, dbState, setLastSavedStateStr } from './db/db_core';
import { loadHistoryMonths, syncHistoryMonths } from './db/db_training';
import { loadNutritionMonths, syncNutritionMonths } from './db/db_nutrition';
import { purgeAllLocalUserData, deleteAccount } from './db/db_account';

export const DB = {
    resetCache() {
        setLastSavedStateStr(null);
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
                // Strict normalization: only accept known enum values, never trust raw Firestore data
                state.nutritionPlanningOrigin = (data.nutritionPlanningOrigin === 'generated-default' || data.nutritionPlanningOrigin === 'user-edited')
                    ? data.nutritionPlanningOrigin
                    : undefined;
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

                setLastSavedStateStr(JSON.stringify(state));
                return state as unknown as UserData;
            }

            // Windowed loading: target current month and previous 2 months (O(1) reads)
            const now = new Date();
            const targetMonths = [0, 1, 2].map(offset => {
                const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            });

            await loadHistoryMonths(user, targetMonths, state);
            await loadNutritionMonths(user, targetMonths, state);

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
            if (dbState.lastSavedStateStr) {
                oldState = JSON.parse(dbState.lastSavedStateStr);
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

            // 2. Group History by Month
            const hasHistoryWrites = syncHistoryMonths(batch, user, state, oldState, restWrites, projectId);
            if (hasHistoryWrites) hasWrites = true;

            // 3. Group Nutrition by Month
            const hasNutritionWrites = syncNutritionMonths(batch, user, state, oldState, restWrites, projectId);
            if (hasNutritionWrites) hasWrites = true;

            if (hasWrites) {
                try {
                    await withTimeout(batch.commit(), 7000, "Timeout sincronizzazione Firestore");
                    console.log(`Sincronizzazione DB completata.`);
                    setLastSavedStateStr(JSON.stringify(state));
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
                setLastSavedStateStr(JSON.stringify(state));
                return { ok: true, status: 'synced' };
            }
        } catch (error) {
            console.error("Errore durante il salvataggio:", error);
            return { ok: false, status: 'failed', error };
        }
    },
    async purgeAllLocalUserData() {
        return purgeAllLocalUserData();
    },
    async secureLogOut() {
        console.log("Eseguo il Log Out protetto...");
        try {
            await auth.signOut();
        } catch (error) {
            console.error("Errore durante auth.signOut, proseguo comunque con la purga:", error);
        } finally {
            await this.purgeAllLocalUserData();
        }
    },
    async deleteAccount() {
        return deleteAccount(this);
    }
};
