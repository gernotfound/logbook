import type { StateCreator } from 'zustand';
import { del as idbDel } from 'idb-keyval';
import { UserDataSchema } from '../../lib/schema';
import type { UserData } from '../../types';
import type { AppState } from '../useAppStore';
import { getNutritionConflictFingerprint } from '../../lib/utils/object';

import { updateStorageMarker, clearStorageMarker } from '../../lib/storageTelemetry';
import { commitLocal, initializeLocal, clearNutritionConflict } from '../../lib/sync/localRepository';
import { writeDeviceValue } from '../../lib/sync/deviceStorage';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { isUpdateRequiredError } from '../../lib/schemaEvolution';

export interface DataSlice {
    userData: UserData | null;
    setUserData: (data: UserData | null | ((prev: UserData | null) => UserData | null)) => void;
    resolveNutritionConflict: (input: import('../../types').ResolveNutritionConflictInput) => Promise<import('../../types').SyncResult>;
}

export const getInitialUserData = (): UserData | null => {
    try {
        if (typeof window === 'undefined') return null;
        const cached = window.__INITIAL_USER_DATA__;
        if (!cached) return null;
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        if (!parsed || typeof parsed !== 'object') return null;

        const start = performance.now();
        const validated = UserDataSchema.parse(parsed) as unknown as UserData;
        const end = performance.now();
        console.log(`[BOOT] Parsing Zod completato in ${(end - start).toFixed(2)}ms`);

        return validated;
    } catch (err) {
        console.warn("[BOOT] Errore parsing Zod:", err);
        return null;
    }
};

export const saveUserDataToCache = async (data: UserData | null, base?: UserData) => {
        const session = captureSession();
        if (data) {
            if (base) await commitLocal(session.owner, data, base);
            else await initializeLocal(session.owner, data);
            if (isCurrentSession(session)) updateStorageMarker();
        } else {
            await idbDel(`logbook:v2:${session.owner}`);
            if (isCurrentSession(session)) clearStorageMarker();
        }
};

const persistHydration = (data: UserData | null, onFailure: (error: unknown) => void) => {
    const session = captureSession();
    void saveUserDataToCache(data).catch(error => { if (isCurrentSession(session)) onFailure(error); });
};

export const createDataSlice: StateCreator<AppState, [], [], DataSlice> = (set, get) => ({
    userData: getInitialUserData(),

    setUserData: (dataOrUpdater) => {
        set((state) => {
            if (state.compatibilityStatus === 'update-required') return state;

            const rawNextData = typeof dataOrUpdater === 'function'
                ? (dataOrUpdater as (prev: UserData | null) => UserData | null)(state.userData)
                : dataOrUpdater;

            if (!rawNextData) {
                // Resetting the view must not erase a durable journal.
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
                            writeDeviceValue('workout', JSON.stringify(syncedLocalWorkout));
                        } catch (e) {
                            console.error("Errore salvataggio localWorkout in localStorage:", e);
                        }
                    } else {
                        try {
                            writeDeviceValue('workout', null);
                        } catch {
                            // Ignore removal error
                        }
                    }
                }
            }

            const nextData = UserDataSchema.parse({
                ...rawNextData,
                activeWorkout: syncedLocalWorkout ?? null
            }) as unknown as UserData;
            persistHydration(nextData, error => {
                if (isUpdateRequiredError(error)) get().setUpdateRequired(error);
                else set({ saveError: 'Impossibile salvare i dati su questo dispositivo.', syncHealth: 'failed' });
            });
            return { userData: nextData, localWorkout: syncedLocalWorkout };
        });
    },

    resolveNutritionConflict: async ({ resolution, expectedUid, expectedConflictFingerprint }) => {
        const state = get();
        if (state.compatibilityStatus === 'update-required') {
            return { ok: false, status: 'failed', error: new Error(state.compatibilityError ?? 'Aggiornamento richiesto.') };
        }
        const userData = state.userData;

        // 1. Check if conflict exists
        if (!userData || !userData.pendingConflicts?.nutritionPlanning) {
            return { ok: false, status: 'failed', error: new Error("conflict-resolved-elsewhere") };
        }

        const session = captureSession();
        if (!expectedUid || session.owner !== `user:${expectedUid}`) {
            return { ok: false, status: 'failed', error: new Error('Sessione utente non corrispondente') };
        }

        const currentFingerprint = getNutritionConflictFingerprint(userData.pendingConflicts.nutritionPlanning);

        if (!currentFingerprint || !expectedConflictFingerprint) {
            return { ok: false, status: 'failed', error: new Error("Nutrition conflict is missing or invalid") };
        }

        if (currentFingerprint !== expectedConflictFingerprint) {
            return { ok: false, status: 'failed', error: new Error("Stale conflict data.") };
        }

        // Keep the recoverable alternative visible and durable until both saves succeed.
        if (resolution === 'local') {
            const localPlan = userData.pendingConflicts.nutritionPlanning;
            const result = await state.updateUserData(prev => ({
                ...prev, nutritionPlanning: localPlan, nutritionPlanningOrigin: 'user-edited',
            }));
            if (!result.ok || !isCurrentSession(session)) return result;
        }
        if (!isCurrentSession(session)) throw new Error('Sessione cambiata durante la risoluzione');
        const currentData = get().userData;
        if (!currentData) throw new Error('Dati utente non disponibili');
        await clearNutritionConflict(session.owner, expectedConflictFingerprint, currentData);
        if (!isCurrentSession(session)) throw new Error('Sessione cambiata durante la risoluzione');
        set(draft => {
            if (!draft.userData || getNutritionConflictFingerprint(draft.userData.pendingConflicts?.nutritionPlanning) !== expectedConflictFingerprint) return draft;
            const { nutritionPlanning: _resolved, ...remaining } = draft.userData.pendingConflicts ?? {};
            const { pendingConflicts: _old, ...rest } = draft.userData;
            return { userData: Object.keys(remaining).length ? { ...rest, pendingConflicts: remaining } : rest };
        });
        return { ok: true, status: 'synced' };
    }
});
