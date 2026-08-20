import type { StateCreator } from 'zustand';
import { Logic } from '../../lib/logic';
import { WorkoutSessionSchema } from '../../lib/schema';
import type { WorkoutSession, SessionExercise, SessionExerciseSet } from '../../types';
import { DEBOUNCE_DELAY_LOCAL } from '../../constants';
import type { AppState } from '../useAppStore';

export interface WorkoutSlice {
    localWorkout: WorkoutSession | null;
    setLocalWorkout: (workout: WorkoutSession | null | ((prev: WorkoutSession | null) => WorkoutSession | null)) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const clearWorkoutTimer = () => {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
};

export const debouncedSaveLocalStorage = (workout: WorkoutSession | null) => {
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
    }, DEBOUNCE_DELAY_LOCAL);
};

export const getInitialLocalWorkout = (): WorkoutSession | null => {
    try {
        const saved = localStorage.getItem('logbook_local_workout');
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

export const createWorkoutSlice: StateCreator<AppState, [], [], WorkoutSlice> = (set) => ({
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
});
