import type { StateCreator } from 'zustand';
import { del as idbDel } from 'idb-keyval';
import { DB } from '../../lib/db';
import { mapFirebaseErrorCode } from '../../lib/errorHandler';
import type { UserData } from '../../types';
import { DEBOUNCE_DELAY_GLOBAL } from '../../constants';
import { saveUserDataToCache } from './createDataSlice';
import { clearWorkoutTimer } from './createWorkoutSlice';
import type { AppState } from '../useAppStore';

import { clearStorageMarker } from '../../lib/storageTelemetry';
import { telemetryHub } from '../../lib/telemetryHub';

import type { SyncResult } from '../../types';

export interface SyncSlice {
    saveError: string | null;
    syncing: boolean;
    setSyncing: (val: boolean) => void;
    setSaveError: (error: string | null) => void;
    saveUserData: (newDataOrUpdater: UserData | null | ((prev: UserData | null) => UserData | null)) => Promise<SyncResult>;
    updateUserData: (updater: (prevUserData: UserData) => UserData) => Promise<SyncResult>;
    resetStore: () => void;
}

let globalSaveTimer: ReturnType<typeof setTimeout> | null = null;
const SYNCED_RESULT: SyncResult = { ok: true, status: 'synced' };
type PendingPromise = { resolve: (result: SyncResult) => void; reject: (err: unknown) => void };
let pendingPromises: PendingPromise[] = [];

export const clearSyncTimers = () => {
    if (globalSaveTimer) {
        clearTimeout(globalSaveTimer);
        globalSaveTimer = null;
    }
    pendingPromises = [];
};

export const createSyncSlice: StateCreator<AppState, [], [], SyncSlice> = (set, get) => ({
    saveError: null,
    syncing: false,

    setSyncing: (val: boolean) => set((state) => state.syncing === val ? state : { syncing: val }),
    setSaveError: (error: string | null) => set({ saveError: error }),

    saveUserData: async (newDataOrUpdater) => {
        const { userData, localWorkout } = get();
        const nextData = typeof newDataOrUpdater === 'function' 
            ? (newDataOrUpdater as (prev: UserData | null) => UserData | null)(userData) 
            : newDataOrUpdater;
        
        if (!nextData) {
            if (globalSaveTimer) {
                clearTimeout(globalSaveTimer);
                globalSaveTimer = null;
            }
            const promises = [...pendingPromises];
            pendingPromises = [];
            promises.forEach(p => p.resolve(SYNCED_RESULT));
            saveUserDataToCache(null);
            set({ userData: null, saveError: null, syncing: false });
            return SYNCED_RESULT;
        }

        const finalData: UserData = {
            ...nextData,
            activeWorkout: nextData.activeWorkout !== undefined ? nextData.activeWorkout : localWorkout
        };
        
        saveUserDataToCache(finalData);
        set({ userData: finalData, saveError: null, syncing: true });

        return new Promise<SyncResult>((resolve, reject) => {
            pendingPromises.push({ resolve, reject });
            if (globalSaveTimer) clearTimeout(globalSaveTimer);
            globalSaveTimer = setTimeout(async () => {
                globalSaveTimer = null;
                const promisesToCall = [...pendingPromises];
                pendingPromises = [];
                try {
                    // Always pull the freshest state at the time of execution
                    const currentState = get().userData;
                    if (!currentState) {
                        promisesToCall.forEach(p => p.resolve(SYNCED_RESULT));
                        return;
                    }
                    
                    const result = await DB.saveUserData(currentState);
                    
                    if (result.ok) {
                        set({ saveError: null });
                        promisesToCall.forEach(p => p.resolve(result));
                    } else {
                        if (result.status === 'local-pending') {
                            set({ saveError: "Salvato localmente. Sincronizzazione in attesa." });
                            promisesToCall.forEach(p => p.resolve(result));
                        } else if (result.status === 'rejected') {
                            set({ saveError: "Sincronizzazione rifiutata dal server. Verifica l'accesso e riprova." });
                            promisesToCall.forEach(p => p.resolve(result));
                        } else {
                            set({ saveError: "Errore inatteso durante il salvataggio." });
                            promisesToCall.forEach(p => p.resolve(result));
                        }
                    }
                } catch (error) {
                    const formattedError = mapFirebaseErrorCode(error);
                    console.error("[SyncSlice] Errore durante il salvataggio:", formattedError);

                    try {
                        telemetryHub.trackError(error, {
                            source: 'app_error',
                            customMessage: `Firestore save error: ${formattedError.code} - ${formattedError.message}`,
                        });
                    } catch {
                        // Non-blocking safe fail-through
                    }

                    set({ saveError: formattedError.message });
                    promisesToCall.forEach(p => p.reject(error));
                } finally {
                    if (!globalSaveTimer && pendingPromises.length === 0) {
                        set({ syncing: false });
                    }
                }
            }, DEBOUNCE_DELAY_GLOBAL);
        });
    },

    updateUserData: async (updater: (prev: UserData) => UserData): Promise<SyncResult> => {
        const { userData } = get();
        if (!userData) return SYNCED_RESULT;
        const nextData = updater(userData);
        return get().saveUserData(nextData);
    },

    resetStore: () => {
        // Cancella i timer pendenti prima di pulire il localStorage,
        // così nessun salvataggio "fantasma" può riscrivere il workout dopo il logout.
        clearWorkoutTimer();
        if (globalSaveTimer) {
            clearTimeout(globalSaveTimer);
            globalSaveTimer = null;
        }
        pendingPromises = [];
        try {
            localStorage.removeItem('logbook_local_workout');
            clearStorageMarker();
            idbDel('logbook_cached_user_data').catch((e) => {
                console.warn("Impossibile rimuovere cache da IndexedDB", e);
            });
        } catch (e) {
            console.warn("Impossibile rimuovere cache", e);
        }
        set({ userData: null, localWorkout: null, saveError: null, syncing: false });
    }
});
