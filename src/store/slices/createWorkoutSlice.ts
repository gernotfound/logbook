import type { StateCreator } from 'zustand';
import { DomainParsers } from '../../lib/schema';
import { Logic } from '../../lib/logic';
import { normalizeBusinessId } from '../../lib/businessIdentity';
import type { WorkoutSession, SyncResult } from '../../types';
import { readDeviceValueStrict, writeDeviceValue } from '../../lib/sync/deviceStorage';
import type { AppState } from '../useAppStore';
import { assertWorkoutSessionIdentities } from '../../lib/sync/domainOperations/validation';

export interface WorkoutSlice {
    localWorkout: WorkoutSession | null;
    setLocalWorkout: (workout: WorkoutSession | null | ((prev: WorkoutSession | null) => WorkoutSession | null)) => void;
    setSyncedLocalWorkout: (workout: WorkoutSession | null | ((prev: WorkoutSession | null) => WorkoutSession | null)) => Promise<SyncResult>;
}

export const clearWorkoutTimer = () => {};

const DEVICE_WORKOUT_PERSISTENCE_MESSAGE = 'Impossibile salvare l’allenamento sul dispositivo. Le modifiche sono bloccate per evitare perdita di dati; libera spazio o riabilita lo storage e riapri TheLogBook.';

export class DeviceWorkoutCorruptError extends Error {
    readonly code = 'device-workout-corrupt';

    constructor(message = 'Snapshot workout locale non leggibile.') {
        super(message);
        this.name = 'DeviceWorkoutCorruptError';
    }
}

function blockWorkoutPersistence(set: (partial: Partial<AppState>) => void, error: unknown): void {
    console.error('Persistenza device-critical del workout fallita:', error);
    set({
        localPersistenceBlocked: true,
        syncHealth: 'failed',
        syncPresentation: 'normal',
        saveError: DEVICE_WORKOUT_PERSISTENCE_MESSAGE,
    });
}

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

export const getInitialLocalWorkout = (owner?: string, fallback?: WorkoutSession | null, history?: ReadonlyArray<WorkoutSession>, lastClosedWorkoutId?: string, closedWorkoutIds?: ReadonlyArray<string>): WorkoutSession | null => {
    const recoverFallback = (): WorkoutSession | null => {
        if (!fallback) return null;
        const normalized = normalizeDeviceWorkout(fallback);
        const validated = normalized ? DomainParsers.parseActiveWorkout(normalized) as WorkoutSession | null : null;
        if (!validated) throw new DeviceWorkoutCorruptError('Fallback activeWorkout locale non valido.');
        persistLocalWorkout(validated, owner);
        return validated;
    };

    const saved = readDeviceValueStrict('workout', owner);
    if (saved === null) return recoverFallback();

    let parsed: unknown;
    try {
        parsed = JSON.parse(saved);
    } catch (error) {
        throw new DeviceWorkoutCorruptError(
            error instanceof Error ? `Snapshot workout locale corrotto: ${error.message}` : undefined,
        );
    }
    if (!parsed || typeof parsed !== 'object') throw new DeviceWorkoutCorruptError();

    const normalized = normalizeDeviceWorkout(parsed as WorkoutSession);
    if (!normalized) throw new DeviceWorkoutCorruptError('Snapshot workout locale privo di identità valida.');
    const validated = DomainParsers.parseActiveWorkout(normalized) as WorkoutSession | null;
    if (!validated) throw new DeviceWorkoutCorruptError('Snapshot workout locale non valido.');
    const savedWorkoutId = normalizeBusinessId(validated.id);
    if (!savedWorkoutId) throw new DeviceWorkoutCorruptError('Snapshot workout locale privo di identità valida.');

    // A crash between the atomic IndexedDB workout.complete commit and the
    // device-key cleanup must never resurrect a workout already in history.
    if (!validated.isEditingHistory && fallback?.id !== validated.id
        && (lastClosedWorkoutId === validated.id || closedWorkoutIds?.includes(savedWorkoutId) || history?.some(item => item.id === validated.id))) {
        persistLocalWorkout(null, owner);
        return recoverFallback();
    }
    persistLocalWorkout(validated, owner);
    return validated;
};

export const createWorkoutSlice: StateCreator<AppState, [], [], WorkoutSlice> = (set, get) => ({
    // Ownership-aware bootstrap installs the device-critical workout only after
    // the owner is known. Never guess an owner while constructing the global store.
    localWorkout: null,

    setLocalWorkout: (workoutOrUpdater) => {
        const currentWorkout = get().localWorkout;
        const nextWorkout = typeof workoutOrUpdater === 'function'
            ? (workoutOrUpdater as (prev: WorkoutSession | null) => WorkoutSession | null)(currentWorkout)
            : workoutOrUpdater;
        try {
            persistLocalWorkout(nextWorkout);
        } catch (error) {
            blockWorkoutPersistence(set, error);
            throw error;
        }
        set({ localWorkout: nextWorkout });
    },

    setSyncedLocalWorkout: async (workoutOrUpdater) => {
        if (get().localPersistenceBlocked) throw new Error(DEVICE_WORKOUT_PERSISTENCE_MESSAGE);

        const currentWorkout = get().localWorkout;
        const nextWorkout = typeof workoutOrUpdater === 'function'
            ? (workoutOrUpdater as (prev: WorkoutSession | null) => WorkoutSession | null)(currentWorkout)
            : workoutOrUpdater;

        if (nextWorkout === currentWorkout) return { ok: true, status: 'synced' };
        if (!get().userData) throw new Error('Dati utente non caricati');

        // The transition from transient/device state to persisted activeWorkout is
        // the one authorized repair point for missing instance identities.
        const persistedWorkout = nextWorkout ? normalizeDeviceWorkout(nextWorkout) : null;
        if (nextWorkout && !persistedWorkout) throw new Error('Allenamento attivo: identificativo non valido');
        if (persistedWorkout) assertWorkoutSessionIdentities(persistedWorkout, 'Allenamento attivo');

        // Device-critical durability precedes the optimistic in-memory update.
        try {
            persistLocalWorkout(persistedWorkout);
        } catch (error) {
            blockWorkoutPersistence(set, error);
            throw error;
        }
        set({ localWorkout: persistedWorkout });
        return get().dispatchDomainOperation({ type: 'active-workout.set', workout: persistedWorkout });
    },
});
