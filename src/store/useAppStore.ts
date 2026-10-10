import { create } from 'zustand';
import { createDataSlice, getInitialUserData, type DataSlice } from './slices/createDataSlice';
import { createWorkoutSlice, type WorkoutSlice } from './slices/createWorkoutSlice';
import { createSyncSlice, type SyncSlice } from './slices/createSyncSlice';
import { captureSession } from '../lib/sync/session';
import { persistOwnerBoundWorkoutSnapshot } from '../lib/sync/deviceCriticalState';
import { draftRegistry } from '../lib/utils/draftRegistry';
import { UPDATE_REQUIRED_EVENT } from '../lib/schemaEvolution';

export interface AppState extends DataSlice, WorkoutSlice, SyncSlice {}

export { getInitialUserData };

export const useAppStore = create<AppState>()((...a) => ({
    ...createDataSlice(...a),
    ...createWorkoutSlice(...a),
    ...createSyncSlice(...a),
}));

if (typeof window !== 'undefined') {
    window.addEventListener(UPDATE_REQUIRED_EVENT, event => {
        useAppStore.getState().setUpdateRequired((event as CustomEvent).detail);
    });
}

// PWA FIX: Synchronously save the local workout to localStorage when the app goes into the background.
// This ensures that if the OS suspends or kills the PWA immediately, the last keystrokes are not lost
// due to the 300ms debounce timer.
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            const state = useAppStore.getState();
            // An unauthenticated landing screen has no device-critical drafts to flush.
            // Preserve the fail-closed path whenever any owner or workout data exists.
            if (state.userData === null && state.dataOwner === null && state.localWorkout === null) return;
            const session = captureSession();
            try {
                draftRegistry.flushAll({ strict: true });
                persistOwnerBoundWorkoutSnapshot(session, state.dataOwner, state.localWorkout);
            } catch (error) {
                console.error('Persistenza device-critical fallita durante visibilitychange:', error);
                useAppStore.setState({
                    localPersistenceBlocked: true,
                    syncHealth: 'failed',
                    syncPresentation: 'normal',
                    saveError: 'Impossibile mettere al sicuro le ultime modifiche sul dispositivo. Riapri TheLogBook prima di continuare.',
                });
            }
        }
    });
}

// Reopening, reconnection and foreground resume all use the same durable journal.
if (typeof window !== 'undefined') {
    const replay = () => {
        void useAppStore.getState().flushPendingSyncs().catch(error => {
            console.warn('Ripresa sincronizzazione non completata:', error);
        });
    };
    window.addEventListener('online', replay);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') replay(); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'LOGBOOK_SYNC_REQUIRED') replay();
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
