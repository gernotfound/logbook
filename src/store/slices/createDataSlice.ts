import type { StateCreator } from 'zustand';
import { set as idbSet, del as idbDel } from 'idb-keyval';
import { UserDataSchema } from '../../lib/schema';
import type { UserData } from '../../types';
import type { AppState } from '../useAppStore';

export interface DataSlice {
    userData: UserData | null;
    setUserData: (data: UserData | null | ((prev: UserData | null) => UserData | null)) => void;
}

export const getInitialUserData = (): UserData | null => {
    try {
        if (typeof window === 'undefined') return null;
        const cached = window.__INITIAL_USER_DATA__;
        if (!cached) return null;
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        if (!parsed || typeof parsed !== 'object') return null;
        return UserDataSchema.parse(parsed) as unknown as UserData;
    } catch {
        return null;
    }
};

export const saveUserDataToCache = (data: UserData | null) => {
    try {
        if (data) {
            idbSet('logbook_cached_user_data', data).catch((e) => {
                console.warn("Errore salvataggio cache userData in IndexedDB:", e);
            });
        } else {
            idbDel('logbook_cached_user_data').catch((e) => {
                console.warn("Errore rimozione cache userData da IndexedDB:", e);
            });
        }
    } catch (e) {
        console.warn("Errore salvataggio cache userData in IndexedDB:", e);
    }
};

export const createDataSlice: StateCreator<AppState, [], [], DataSlice> = (set) => ({
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
});
