import { create } from 'zustand';
import { DB } from '../lib/db';

export interface UserProfile {
    dob?: string;
    height?: string;
    gender?: string;
    neck?: string;
    waist?: string;
    hip?: string;
    manualBf?: string;
}

export interface NutritionPlanning {
    weight?: number;
    carbsPerKg?: number;
    proPerKg?: number;
    fatPerKg?: number;
    lockedMacro?: string | null;
    chartPeriod?: number;
    normocalorica?: {
        kcal?: number;
        carbs?: number;
        pro?: number;
        fat?: number;
    };
    totalKcal?: number;
}

import { Exercise, WorkoutRoutine, WorkoutSession, NutritionDay, Food } from '../types';

export interface UserData {
    profile?: UserProfile;
    library?: Exercise[];
    routines?: WorkoutRoutine[];
    history?: WorkoutSession[];
    nutrition?: Record<string, NutritionDay>;
    customFoods?: Food[];
    activeWorkout?: WorkoutSession | null;
    nutritionPlanning?: NutritionPlanning;
}

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
        } catch (e) {
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
            let activeWorkout = rawNextData.activeWorkout;
            
            if (rawNextData.activeWorkout === null) {
                syncedLocalWorkout = null;
                localStorage.removeItem('logbook_local_workout');
            } else if (rawNextData.activeWorkout !== undefined) {
                syncedLocalWorkout = rawNextData.activeWorkout;
                if (syncedLocalWorkout) {
                    try {
                        localStorage.setItem('logbook_local_workout', JSON.stringify(syncedLocalWorkout));
                    } catch (e) {
                        console.error("Errore salvataggio localWorkout in localStorage:", e);
                    }
                }
            } else if (state.localWorkout) {
                activeWorkout = state.localWorkout;
            }
            
            const nextData: UserData = {
                ...rawNextData,
                activeWorkout: activeWorkout ?? null
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

        try {
            await DB.saveUserData(finalData);
        } catch (error) {
            console.error("Errore durante il salvataggio in Zustand:", error);
            set({ saveError: "Errore sincronizzazione. Verifica la connessione." });
        }
    },

    updateUserData: async (updater: (prev: UserData) => UserData) => {
        const { userData } = get();
        if (!userData) return;
        const nextData = updater(userData);
        await get().saveUserData(nextData);
    },

    resetStore: () => {
        try {
            localStorage.removeItem('logbook_local_workout');
        } catch (e) {
            console.warn("Impossibile rimuovere logbook_local_workout", e);
        }
        set({ userData: null, localWorkout: null, saveError: null, syncing: false });
    }
}));

