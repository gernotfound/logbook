import type { StateCreator } from 'zustand';
import { set as idbSet, del as idbDel } from 'idb-keyval';
import { UserDataSchema } from '../../lib/schema';
import type { UserData } from '../../types';
import type { AppState } from '../useAppStore';

import { updateStorageMarker, clearStorageMarker } from '../../lib/storageTelemetry';

export interface DataSlice {
    userData: UserData | null;
    setUserData: (data: UserData | null | ((prev: UserData | null) => UserData | null)) => void;
    resolveNutritionConflict: (input: import('../../types').ResolveNutritionConflictInput) => Promise<import('../../types').SyncResult>;
}

export const getInitialUserData = (): UserData | null => {
    try {
        if (typeof window === 'undefined') return null;
        const cached = window.__INITIAL_USER_DATA__;
        if (!cached) return null;
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        if (!parsed || typeof parsed !== 'object') return null;
        
        const start = performance.now();
        const validated = UserDataSchema.parse(parsed) as unknown as UserData;
        const end = performance.now();
        console.log(`[BOOT] Parsing Zod completato in ${(end - start).toFixed(2)}ms`);
        
        return validated;
    } catch (err) {
        console.warn("[BOOT] Errore parsing Zod:", err);
        return null;
    }
};

export const saveUserDataToCache = (data: UserData | null) => {
    try {
        if (data) {
            idbSet('logbook_cached_user_data', data).then(() => {
                updateStorageMarker();
            }).catch((e) => {
                console.warn("Errore salvataggio cache userData in IndexedDB:", e);
            });
        } else {
            idbDel('logbook_cached_user_data').then(() => {
                clearStorageMarker();
            }).catch((e) => {
                console.warn("Errore rimozione cache userData da IndexedDB:", e);
            });
        }
    } catch (e) {
        console.warn("Errore salvataggio cache userData in IndexedDB:", e);
    }
};

export const createDataSlice: StateCreator<AppState, [], [], DataSlice> = (set, get) => ({
    userData: getInitialUserData(),

    setUserData: (dataOrUpdater) => {
        set((state) => {
            const rawNextData = typeof dataOrUpdater === 'function' 
                ? (dataOrUpdater as (prev: UserData | null) => UserData | null)(state.userData) 
                : dataOrUpdater;

            if (!rawNextData) {
                saveUserDataToCache(null);
                return { userData: null, localWorkout: state.localWorkout };
            }

            let syncedLocalWorkout = state.localWorkout;
            
            // PWA BUG FIX: Never let a network fetch overwrite our active local workout!
            // The local device's localStorage is the source of truth for an ongoing workout.
            if (state.localWorkout) {
                // If we already have a local workout, KEEP IT. Ignore what comes from the network.
                syncedLocalWorkout = state.localWorkout;
            } else {
                // If we DON'T have a local workout, but the network gives us one, we can adopt it.
                if (rawNextData.activeWorkout !== undefined) {
                    syncedLocalWorkout = rawNextData.activeWorkout;
                    if (syncedLocalWorkout) {
                        try {
                            localStorage.setItem('logbook_local_workout', JSON.stringify(syncedLocalWorkout));
                        } catch (e) {
                            console.error("Errore salvataggio localWorkout in localStorage:", e);
                        }
                    } else {
                        try {
                            localStorage.removeItem('logbook_local_workout');
                        } catch {
                            // Ignore removal error
                        }
                    }
                }
            }
            
            const nextData: UserData = {
                ...rawNextData,
                activeWorkout: syncedLocalWorkout ?? null
            };
            saveUserDataToCache(nextData);
            return { userData: nextData, localWorkout: syncedLocalWorkout };
        });
    },

    resolveNutritionConflict: async ({ resolution, expectedUid, expectedConflictFingerprint }) => {
        const state = get();
        const userData = state.userData;

        // 1. Check if conflict exists
        if (!userData || !userData.pendingConflicts?.nutritionPlanning) {
            return { ok: false, status: 'failed', error: new Error("No conflict pending.") };
        }

        // 2. Auth Context checking:
        // We ensure a valid expectedUid was provided by the UI layer to prevent cross-account bugs
        if (!expectedUid) {
            return { ok: false, status: 'failed', error: new Error("Missing expectedUid context.") };
        }
        
        const currentFingerprint = JSON.stringify(userData.pendingConflicts.nutritionPlanning);
        if (currentFingerprint !== expectedConflictFingerprint) {
            return { ok: false, status: 'failed', error: new Error("Stale conflict data.") };
        }

        if (resolution === 'cloud') {
            // Mantieni Cloud: Rimuove pendingConflicts localmente, senza invocare Firestore.
            set((draftState) => {
                if (!draftState.userData || !draftState.userData.pendingConflicts) return draftState;
                const nextData = { ...draftState.userData };
                const nextConflicts = { ...nextData.pendingConflicts };
                delete nextConflicts.nutritionPlanning;
                
                if (Object.keys(nextConflicts).length === 0) {
                    delete nextData.pendingConflicts;
                } else {
                    nextData.pendingConflicts = nextConflicts;
                }
                
                saveUserDataToCache(nextData);
                return { userData: nextData };
            });
            return { ok: true, status: 'synced' };
        } else {
            // Mantieni Locale: Sovrascrive il cloud plan
            const localPlan = userData.pendingConflicts.nutritionPlanning;
            const result = await state.updateUserData((prev: import('../../types').UserData) => {
                const nextConflicts = { ...prev.pendingConflicts };
                delete nextConflicts.nutritionPlanning;
                
                const nextData = {
                    ...prev,
                    nutritionPlanning: localPlan,
                    nutritionPlanningOrigin: 'user-edited' as const,
                };

                if (Object.keys(nextConflicts).length === 0) {
                    delete nextData.pendingConflicts;
                } else {
                    nextData.pendingConflicts = nextConflicts;
                }
                return nextData;
            });

            // Se il risultato NON è synced, revertiamo il pendingConflicts in store in modo che resti recuperabile
            if (!result.ok || result.status !== 'synced') {
                set((draftState) => {
                    if (!draftState.userData) return draftState;
                    const nextData = { ...draftState.userData };
                    nextData.pendingConflicts = {
                        ...(nextData.pendingConflicts || {}),
                        nutritionPlanning: localPlan
                    };
                    saveUserDataToCache(nextData);
                    return { userData: nextData };
                });
            }
            return result;
        }
    }
});
