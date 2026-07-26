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

export interface UserData {
    profile?: UserProfile;
    library?: any[];
    routines?: any[];
    history?: any[];
    nutrition?: Record<string, any>;
    customFoods?: any[];
    activeWorkout?: any;
    nutritionPlanning?: NutritionPlanning;
}

export interface AppState {
    userData: UserData | null;
    saveError: string | null;
    syncing: boolean;
    localWorkout: any;

    setUserData: (data: UserData | null | ((prev: UserData | null) => UserData | null)) => void;
    setSyncing: (val: boolean) => void;
    setSaveError: (error: string | null) => void;
    setLocalWorkout: (workout: any) => void;
    saveUserData: (newDataOrUpdater: UserData | null | ((prev: UserData | null) => UserData | null)) => Promise<void>;
    updateUserData: (updater: (prevUserData: UserData) => UserData) => Promise<void>;
}

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

    setLocalWorkout: (workout: any) => {
        set((state) => {
            if (workout) {
                try {
                    localStorage.setItem('logbook_local_workout', JSON.stringify(workout));
                } catch (e) {
                    console.error("Errore salvataggio localWorkout in localStorage:", e);
                }
            } else {
                localStorage.removeItem('logbook_local_workout');
            }
            const nextUserData = state.userData ? { ...state.userData, activeWorkout: workout || null } : null;
            return { localWorkout: workout, userData: nextUserData };
        });
    },

    setUserData: (dataOrUpdater) => {
        set((state) => {
            const nextData = typeof dataOrUpdater === 'function' 
                ? (dataOrUpdater as (prev: UserData | null) => UserData | null)(state.userData) 
                : dataOrUpdater;

            let syncedLocalWorkout = state.localWorkout;
            if (nextData && nextData.activeWorkout !== undefined) {
                syncedLocalWorkout = nextData.activeWorkout;
                if (syncedLocalWorkout) {
                    try {
                        localStorage.setItem('logbook_local_workout', JSON.stringify(syncedLocalWorkout));
                    } catch (e) {
                        console.error("Errore salvataggio localWorkout in localStorage:", e);
                    }
                } else {
                    localStorage.removeItem('logbook_local_workout');
                }
            }
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
    }
}));

