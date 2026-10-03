import type { StateCreator } from 'zustand';
import { DomainParsers } from '../../lib/schema';
import type { WorkoutSession, SyncResult } from '../../types';
import { readDeviceValue, writeDeviceValue } from '../../lib/sync/deviceStorage';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import type { AppState } from '../useAppStore';
import { assertWorkoutSessionIdentities } from '../../lib/sync/domainOperations/validation';

export interface WorkoutSlice {
    localWorkout: WorkoutSession | null;
    setLocalWorkout: (workout: WorkoutSession | null | ((prev: WorkoutSession | null) => WorkoutSession | null)) => void;
    setSyncedLocalWorkout: (workout: WorkoutSession | null | ((prev: WorkoutSession | null) => WorkoutSession | null)) => Promise<SyncResult>;
}

export const clearWorkoutTimer = () => {};

function persistLocalWorkout(workout: WorkoutSession | null, owner?: string): void {
    if (workout) writeDeviceValue('workout', JSON.stringify(workout), owner);
    else writeDeviceValue('workout', null, owner);
}

export const getInitialLocalWorkout = (owner?: string, fallback?: WorkoutSession | null): WorkoutSession | null => {
    const recoverFallback = (): WorkoutSession | null => {
        if (!fallback) return null;
        const validated = DomainParsers.parseActiveWorkout(fallback) as WorkoutSession | null;
        if (validated) persistLocalWorkout(validated, owner);
        return validated;
    };
    try {
        const saved = readDeviceValue('workout', owner);
        if (!saved) return recoverFallback();
        const parsed = JSON.parse(saved);
        if (!parsed || typeof parsed !== 'object') return recoverFallback();
        const validated = DomainParsers.parseActiveWorkout(parsed) as WorkoutSession | null;
        if (!validated) return recoverFallback();
        persistLocalWorkout(validated, owner);
        return validated;
    } catch {
        return recoverFallback();
    }
};

export const createWorkoutSlice: StateCreator<AppState, [], [], WorkoutSlice> = (set, get) => ({
    // Inizializza il workout in bozza dal localStorage, se presente (con ID univoci garantiti)
    localWorkout: getInitialLocalWorkout(),

    setLocalWorkout: (workoutOrUpdater) => {
        set((state) => {
            const nextWorkout = typeof workoutOrUpdater === 'function'
                ? (workoutOrUpdater as (prev: WorkoutSession | null) => WorkoutSession | null)(state.localWorkout)
                : workoutOrUpdater;
            persistLocalWorkout(nextWorkout);
            return { localWorkout: nextWorkout };
        });
    },

    setSyncedLocalWorkout: async (workoutOrUpdater) => {
        const currentWorkout = get().localWorkout;
        const nextWorkout = typeof workoutOrUpdater === 'function'
            ? (workoutOrUpdater as (prev: WorkoutSession | null) => WorkoutSession | null)(currentWorkout)
            : workoutOrUpdater;

        if (nextWorkout === currentWorkout) return { ok: true, status: 'synced' };
        if (!get().userData) throw new Error('Dati utente non caricati');
        if (nextWorkout) assertWorkoutSessionIdentities(nextWorkout, 'Allenamento attivo');

        // Device-critical durability precedes the optimistic in-memory update.
        persistLocalWorkout(nextWorkout);
        set({ localWorkout: nextWorkout });
        return get().dispatchDomainOperation({ type: 'active-workout.set', workout: nextWorkout });
    },
});
