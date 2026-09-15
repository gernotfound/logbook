import type { StateCreator } from 'zustand';
import { Logic } from '../../lib/logic';
import { WorkoutSessionSchema } from '../../lib/schema';
import type { WorkoutSession, SessionExercise, SessionExerciseSet, SyncResult } from '../../types';
import { DEBOUNCE_DELAY_LOCAL } from '../../constants';
import { readDeviceValue, writeDeviceValue } from '../../lib/sync/deviceStorage';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import type { AppState } from '../useAppStore';

export interface WorkoutSlice {
    localWorkout: WorkoutSession | null;
    setLocalWorkout: (workout: WorkoutSession | null | ((prev: WorkoutSession | null) => WorkoutSession | null)) => void;
    setSyncedLocalWorkout: (workout: WorkoutSession | null | ((prev: WorkoutSession | null) => WorkoutSession | null)) => Promise<SyncResult>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const clearWorkoutTimer = () => {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
};

const debouncedSaveLocalStorage = (workout: WorkoutSession | null) => {
    const session = captureSession();
    if (saveTimer) clearTimeout(saveTimer);
    if (!workout) {
        saveTimer = null;
        try {
            writeDeviceValue('workout', null, session.owner);
        } catch (error) {
            console.error('Impossibile rimuovere il workout locale:', error);
            throw error;
        }
        return;
    }
    saveTimer = setTimeout(() => {
        if (!isCurrentSession(session)) return;
        try {
            if (workout) {
                writeDeviceValue('workout', JSON.stringify(workout), session.owner);
            } else {
                writeDeviceValue('workout', null, session.owner);
            }
        } catch (e) {
            console.error("Errore salvataggio localWorkout:", e);
        }
    }, DEBOUNCE_DELAY_LOCAL);
};

export const getInitialLocalWorkout = (): WorkoutSession | null => {
    try {
        const saved = readDeviceValue('workout');
        if (!saved) return null;
        const parsed = JSON.parse(saved);
        if (!parsed || typeof parsed !== 'object') return null;
        const validated = WorkoutSessionSchema.parse(parsed) as unknown as WorkoutSession;
        if (validated && Array.isArray(validated.exercises)) {
            validated.exercises = validated.exercises.map((ex: SessionExercise) => ({
                ...ex,
                id: ex.id || Logic.generateId('se'),
                sets: (ex.sets || []).map((s: SessionExerciseSet) => ({
                    ...s,
                    id: s.id || Logic.generateId('s'),
                    dropsets: (s.dropsets || []).map((ds: any) => ({ ...ds, id: ds.id || Logic.generateId('ds') })),
                    isometrics: (s.isometrics || []).map((iso: any) => ({ ...iso, id: iso.id || Logic.generateId('iso') }))
                }))
            }));
        }
        return validated;
    } catch {
        return null;
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
            debouncedSaveLocalStorage(nextWorkout);
            const nextUserData = state.userData ? { ...state.userData, activeWorkout: nextWorkout || null } : null;
            return { localWorkout: nextWorkout, userData: nextUserData };
        });
    },

    setSyncedLocalWorkout: async (workoutOrUpdater) => {
        const currentWorkout = get().localWorkout;
        const nextWorkout = typeof workoutOrUpdater === 'function'
            ? (workoutOrUpdater as (prev: WorkoutSession | null) => WorkoutSession | null)(currentWorkout)
            : workoutOrUpdater;

        if (nextWorkout === currentWorkout) return { ok: true, status: 'synced' };
        if (!get().userData) throw new Error('Dati utente non caricati');
        if (nextWorkout) {
            const id = String(nextWorkout.id ?? '').trim();
            if (!id || id === 'undefined' || id === 'null' || id.includes('/')) {
                throw new Error('Allenamento attivo: identificativo non valido');
            }
        }

        // Persist the device-local draft first, but leave userData untouched until the
        // DomainOperation reducer runs. This preserves the old snapshot as compiler base.
        debouncedSaveLocalStorage(nextWorkout);
        set({ localWorkout: nextWorkout });
        return get().dispatchDomainOperation({ type: 'active-workout.set', workout: nextWorkout });
    },
});
