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

export type SyncHealth = 'synced' | 'local-pending' | 'rejected' | 'failed';

export interface SyncSlice {
    saveError: string | null;
    syncing: boolean;
    syncHealth: SyncHealth;
    syncGeneration: number;
    setSyncing: (val: boolean) => void;
    setSaveError: (error: string | null) => void;
    saveUserData: (newDataOrUpdater: UserData | null | ((prev: UserData | null) => UserData | null)) => Promise<SyncResult>;
    updateUserData: (updater: (prevUserData: UserData) => UserData) => Promise<SyncResult>;
    submitLegalConsent: (consent: NonNullable<UserData['legalConsent']>) => Promise<void>;
    cancelPendingSyncs: () => void;
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
    syncHealth: 'synced',
    syncGeneration: 0,

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
                        set({ saveError: null, syncHealth: 'synced' });
                        promisesToCall.forEach(p => p.resolve(result));
                    } else {
                        if (result.status === 'local-pending') {
                            const newGen = get().syncGeneration + 1;
                            set({
                                saveError: "Salvato localmente. Sincronizzazione in attesa.",
                                syncHealth: 'local-pending',
                                syncGeneration: newGen
                            });
                            promisesToCall.forEach(p => p.resolve(result));

                            // Listen for background sync completion to automatically update syncHealth
                            import('firebase/firestore').then(({ waitForPendingWrites }) => {
                                import('../../lib/firebase').then(({ getDb }) => {
                                    waitForPendingWrites(getDb()).then(() => {
                                        const latest = get();
                                        if (latest.syncHealth === 'local-pending' && latest.syncGeneration === newGen) {
                                            set({ saveError: null, syncHealth: 'synced' });
                                        }
                                    }).catch(() => {});
                                });
                            });
                        } else if (result.status === 'rejected') {
                            set({ saveError: "Sincronizzazione rifiutata dal server. Verifica l'accesso e riprova.", syncHealth: 'rejected', syncGeneration: get().syncGeneration + 1 });
                            promisesToCall.forEach(p => p.reject(new Error("Sincronizzazione rifiutata dal server")));
                        } else {
                            set({ saveError: "Errore inatteso durante il salvataggio.", syncHealth: 'failed', syncGeneration: get().syncGeneration + 1 });
                            promisesToCall.forEach(p => p.reject(new Error("Errore inatteso durante il salvataggio")));
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

                    set({ saveError: formattedError.message, syncHealth: 'failed', syncGeneration: get().syncGeneration + 1 });
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

    submitLegalConsent: async (consent) => {
        const { userData, localWorkout } = get();
        if (!userData) throw new Error("Dati utente non caricati");

        const nextData: UserData = { ...userData, legalConsent: consent };
        const finalData: UserData = {
            ...nextData,
            activeWorkout: nextData.activeWorkout !== undefined ? nextData.activeWorkout : localWorkout
        };

        const result = await DB.saveUserData(finalData);

        if (result.ok || result.status === 'local-pending') {
            saveUserDataToCache(finalData);
            set({ userData: finalData, saveError: null, syncHealth: result.status });
            return;
        }

        // Se arriviamo qui, il risultato è rejected o failed
        if (result.status === 'rejected') {
            set({ saveError: "Sincronizzazione rifiutata dal server.", syncHealth: 'rejected' });
        } else {
            set({ saveError: "Errore inatteso durante il salvataggio.", syncHealth: 'failed' });
        }

        throw new Error("Salvataggio del consenso fallito o rifiutato");
    },

    cancelPendingSyncs: () => {
        clearWorkoutTimer();
        if (globalSaveTimer) {
            clearTimeout(globalSaveTimer);
            globalSaveTimer = null;
        }

        // Resolve or reject all pending promises immediately to unblock callers
        pendingPromises.forEach(p => p.reject(new Error("Sync cancelled due to logout/reset")));
        pendingPromises = [];

        set({ syncing: false });
    },

    resetStore: () => {
        // Just call cancelPendingSyncs for safety in case caller forgot
        get().cancelPendingSyncs();

        try {
            clearStorageMarker();
        } catch (e) {
            console.warn("Impossibile pulire il marker di storage", e);
        }
        set({ userData: null, localWorkout: null, saveError: null, syncing: false });
    }
});
