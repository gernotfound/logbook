import { create } from 'zustand';
import { DB } from '../lib/db';

export const useAppStore = create((set, get) => ({
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

    setLocalWorkout: (workout) => {
        set({ localWorkout: workout });
        if (workout) {
            localStorage.setItem('logbook_local_workout', JSON.stringify(workout));
        } else {
            localStorage.removeItem('logbook_local_workout');
        }
    },

    setUserData: (data) => set({ userData: data }),
    setSyncing: (val) => set({ syncing: val }),
    setSaveError: (error) => set({ saveError: error }),

    saveUserData: async (newDataOrUpdater) => {
        const { userData } = get();
        const nextData = typeof newDataOrUpdater === 'function' ? newDataOrUpdater(userData) : newDataOrUpdater;
        
        set({ userData: nextData, saveError: null });

        try {
            // DB.saveUserData manages its own async saving.
            await DB.saveUserData(nextData);
        } catch (error) {
            console.error("Errore durante il salvataggio in Zustand:", error);
            set({ saveError: "Errore sincronizzazione. Verifica la connessione." });
        }
    }
}));
