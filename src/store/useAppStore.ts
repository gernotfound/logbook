import { create } from 'zustand';
import { DB } from '../lib/db';
import type { WorkoutSession, UserProfile, NutritionPlanning, UserData } from '../types';

export type { UserProfile, NutritionPlanning, UserData };

export interface AppState {
    userData: UserData | null;
    saveError: string | null;
    syncing: boolean;
    localWorkout: WorkoutSession | null;

    setUserData: (data: UserData | null | ((prev: UserData | null) => UserData | null)) => void;
    setSyncing: (val: boolean) => void;
    setSaveError: (error: string | null) => void;
    setLocalWorkout: (workout: WorkoutSession | null) => void;
    saveUserData: (newDataOrUpdater: UserData | null | ((prev: UserData | null) => UserData | null)) => Promise<void>;
    updateUserData: (updater: (prevUserData: UserData) => UserData) => Promise<void>;
    resetStore: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let globalSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingResolvers: (() => void)[] = [];

const debouncedSaveLocalStorage = (workout: WorkoutSession | null) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            if (workout) {
                localStorage.setItem('logbook_local_workout', JSON.stringify(workout));
            } else {
                localStorage.removeItem('logbook_local_workout');
            }
        } catch (e) {
            console.error("Errore salvataggio localWorkout:", e);
        }
    }, 300);
};

export const useAppStore = create<AppState>((set, get) => ({
    userData: null,
    saveError: null,
    syncing: false,
    
    // Inizializza il workout in bozza dal localStorage, se presente
    localWorkout: (() => {
        try {
            const saved = localStorage.getItem('logbook_local_workout');
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    })(),

    setLocalWorkout: (workout: WorkoutSession | null) => {
        set((state) => {
            debouncedSaveLocalStorage(workout);
            const nextUserData = state.userData ? { ...state.userData, activeWorkout: workout || null } : null;
            return { localWorkout: workout, userData: nextUserData };
        });
    },

    setUserData: (dataOrUpdater) => {
        set((state) => {
            const rawNextData = typeof dataOrUpdater === 'function' 
                ? (dataOrUpdater as (prev: UserData | null) => UserData | null)(state.userData) 
                : dataOrUpdater;

            if (!rawNextData) {
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
            
            return { userData: nextData, localWorkout: syncedLocalWorkout };
        });
    },

    setSyncing: (val: boolean) => set({ syncing: val }),
    setSaveError: (error: string | null) => set({ saveError: error }),

    saveUserData: async (newDataOrUpdater) => {
        const { userData, localWorkout } = get();
        const nextData = typeof newDataOrUpdater === 'function' 
            ? (newDataOrUpdater as (prev: UserData | null) => UserData | null)(userData) 
            : newDataOrUpdater;
        
        if (!nextData) {
            set({ userData: null, saveError: null });
            return;
        }

        const finalData: UserData = {
            ...nextData,
            activeWorkout: nextData.activeWorkout !== undefined ? nextData.activeWorkout : localWorkout
        };
        
        set({ userData: finalData, saveError: null });

        return new Promise<void>((resolve) => {
            pendingResolvers.push(resolve);
            if (globalSaveTimer) clearTimeout(globalSaveTimer);
            globalSaveTimer = setTimeout(async () => {
                const resolversToCall = [...pendingResolvers];
                pendingResolvers = [];
                try {
                    // Always pull the freshest state at the time of execution
                    const currentState = get().userData;
                    if (currentState) {
                        await DB.saveUserData(currentState);
                    }
                } catch (error) {
                    console.error("Errore durante il salvataggio in Zustand:", error);
                    set({ saveError: "Errore sincronizzazione. Verifica la connessione." });
                } finally {
                    resolversToCall.forEach(res => res());
                }
            }, 1000);
        });
    },

    updateUserData: async (updater: (prev: UserData) => UserData) => {
        const { userData } = get();
        if (!userData) return;
        const nextData = updater(userData);
        await get().saveUserData(nextData);
    },

    resetStore: () => {
        // Cancella i timer pendenti prima di pulire il localStorage,
        // così nessun salvataggio "fantasma" può riscrivere il workout dopo il logout.
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        if (globalSaveTimer) { clearTimeout(globalSaveTimer); globalSaveTimer = null; }
        pendingResolvers = [];
        try {
            localStorage.removeItem('logbook_local_workout');
        } catch (e) {
            console.warn("Impossibile rimuovere logbook_local_workout", e);
        }
        set({ userData: null, localWorkout: null, saveError: null, syncing: false });
    }
}));

// PWA FIX: Synchronously save the local workout to localStorage when the app goes into the background.
// This ensures that if the OS suspends or kills the PWA immediately, the last keystrokes are not lost
// due to the 300ms debounce timer.
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            const state = useAppStore.getState();
            if (state.localWorkout) {
                try {
                    localStorage.setItem('logbook_local_workout', JSON.stringify(state.localWorkout));
                } catch (e) {
                    console.error("Errore salvataggio localWorkout su visibilitychange:", e);
                }
            }
}
    });
}

// PWA FIX: Listen for online event to clear saveError if connection is restored
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        useAppStore.getState().setSaveError(null);
    });
}
