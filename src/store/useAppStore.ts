import { create } from 'zustand';
import type { UserProfile, NutritionPlanning, UserData } from '../types';
import { createDataSlice, getInitialUserData, type DataSlice } from './slices/createDataSlice';
import { createWorkoutSlice, type WorkoutSlice } from './slices/createWorkoutSlice';
import { createSyncSlice, type SyncSlice } from './slices/createSyncSlice';
import { draftRegistry } from '../lib/utils/draftRegistry';

export type { UserProfile, NutritionPlanning, UserData };

export interface AppState extends DataSlice, WorkoutSlice, SyncSlice {}

export { getInitialUserData };

export const useAppStore = create<AppState>()((...a) => ({
    ...createDataSlice(...a),
    ...createWorkoutSlice(...a),
    ...createSyncSlice(...a),
}));

// PWA FIX: Synchronously save the local workout to localStorage when the app goes into the background.
// This ensures that if the OS suspends or kills the PWA immediately, the last keystrokes are not lost
// due to the 300ms debounce timer.
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            draftRegistry.flushAll();
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

// PWA FIX: Sync App Badge with active local workout
if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
    useAppStore.subscribe((state, prevState) => {
        const hasWorkout = !!state.localWorkout;
        const hadWorkout = !!prevState.localWorkout;
        
        if (hasWorkout && !hadWorkout) {
            try {
                (navigator as any).setAppBadge(1).catch(() => {});
            } catch (e) {
                // Ignore
            }
        } else if (!hasWorkout && hadWorkout) {
            try {
                (navigator as any).clearAppBadge().catch(() => {});
            } catch (e) {
                // Ignore
            }
        }
    });
    
    // Initial check
    setTimeout(() => {
        if (useAppStore.getState().localWorkout) {
            try {
                (navigator as any).setAppBadge(1).catch(() => {});
            } catch (e) {}
        } else {
            try {
                (navigator as any).clearAppBadge().catch(() => {});
                if (import.meta.env.DEV) {
                    console.log('[AppBadge] Cleared orphan badge at startup');
                }
            } catch (e) {}
        }
    }, 1000);
}
