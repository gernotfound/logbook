import type { StateCreator } from 'zustand';
import { DomainParsers } from '../../lib/schema';
import { Logic } from '../../lib/logic';
import { normalizeBusinessId } from '../../lib/businessIdentity';
import type { WorkoutSession, SyncResult } from '../../types';
import { readDeviceValue, writeDeviceValue } from '../../lib/sync/deviceStorage';
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

function uniqueRecoveredId(raw: unknown, prefix: string, seen: Set<string>): string {
    let id = normalizeBusinessId(raw);
    if (!id || seen.has(id)) {
        do { id = Logic.generateId(prefix); } while (seen.has(id));
    }
    seen.add(id);
    return id;
}

function normalizeDeviceWorkout(raw: WorkoutSession): WorkoutSession | null {
    const workoutId = normalizeBusinessId(raw.id);
    if (!workoutId) return null;

    const exerciseIds = new Set<string>();
    const exercises = (Array.isArray(raw.exercises) ? raw.exercises : []).flatMap(exercise => {
        const exId = normalizeBusinessId(exercise?.exId);
        if (!exId) return [];
        const setIds = new Set<string>();
        const sets = (Array.isArray(exercise.sets) ? exercise.sets : []).map(set => {
            const segmentIds = new Set<string>();
            const dropIds = new Set<string>();
            const isometricIds = new Set<string>();
            return {
                ...set,
                id: uniqueRecoveredId(set?.id, 's', setIds),
                segments: Array.isArray(set?.segments)
                    ? set.segments.map(segment => ({ ...segment, id: uniqueRecoveredId(segment?.id, 'seg', segmentIds) }))
                    : set?.segments,
                dropsets: Array.isArray(set?.dropsets)
                    ? set.dropsets.map(drop => ({ ...drop, id: uniqueRecoveredId(drop?.id, 'ds', dropIds) }))
                    : set?.dropsets,
                isometrics: Array.isArray(set?.isometrics)
                    ? set.isometrics.map(item => ({ ...item, id: uniqueRecoveredId(item?.id, 'iso', isometricIds) }))
                    : set?.isometrics,
            };
        });
        return [{
            ...exercise,
            id: uniqueRecoveredId(exercise?.id, 'se', exerciseIds),
            exId,
            sets,
        }];
    });

    return { ...raw, id: workoutId, exercises };
}

export const getInitialLocalWorkout = (owner?: string, fallback?: WorkoutSession | null): WorkoutSession | null => {
    const recoverFallback = (): WorkoutSession | null => {
        if (!fallback) return null;
        const normalized = normalizeDeviceWorkout(fallback);
        const validated = normalized ? DomainParsers.parseActiveWorkout(normalized) as WorkoutSession | null : null;
        if (validated) persistLocalWorkout(validated, owner);
        return validated;
    };
    try {
        const saved = readDeviceValue('workout', owner);
        if (!saved) return recoverFallback();
        const parsed = JSON.parse(saved);
        if (!parsed || typeof parsed !== 'object') return recoverFallback();
        const normalized = normalizeDeviceWorkout(parsed as WorkoutSession);
        if (!normalized) return recoverFallback();
        const validated = DomainParsers.parseActiveWorkout(normalized) as WorkoutSession | null;
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
