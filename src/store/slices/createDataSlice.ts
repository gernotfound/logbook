import type { StateCreator } from 'zustand';
import { del as idbDel } from 'idb-keyval';
import equal from 'fast-deep-equal';
import { DomainParsers, UserDataSchema } from '../../lib/schema';
import type { UserData } from '../../types';
import type { AppState } from '../useAppStore';
import { getNutritionConflictFingerprint } from '../../lib/utils/object';

import { updateStorageMarker, clearStorageMarker } from '../../lib/storageTelemetry';
import { commitLocal, initializeLocal, clearNutritionConflict, readLocal } from '../../lib/sync/localRepository';
import { writeDeviceValue } from '../../lib/sync/deviceStorage';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { markTabSnapshotClean, markTabSnapshotDirty } from '../../lib/sync/tabSnapshotCausality';
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

export const saveUserDataToCache = async (data: UserData | null, base?: UserData): Promise<UserData | null> => {
        const session = captureSession();
        if (data) {
            if (base) await commitLocal(session.owner, data, base);
            else await initializeLocal(session.owner, data);
            const envelope = await readLocal(session.owner);
            if (!envelope) throw new Error('Copia locale non disponibile dopo il salvataggio.');
            if (isCurrentSession(session)) updateStorageMarker(Date.now(), undefined, session.owner);
            return envelope.data;
        }
        await idbDel(`logbook:v2:${session.owner}`);
        if (isCurrentSession(session)) clearStorageMarker(undefined, session.owner);
        return null;
};

export const createDataSlice: StateCreator<AppState, [], [], DataSlice> = (set, get) => ({
    userData: getInitialUserData(),

    setUserData: (dataOrUpdater) => {
        const state = get();
        if (state.compatibilityStatus === 'update-required') return;

        const rawNextData = typeof dataOrUpdater === 'function'
            ? (dataOrUpdater as (prev: UserData | null) => UserData | null)(state.userData)
            : dataOrUpdater;

        if (!rawNextData) {
            // Resetting the view must not erase a durable journal.
            set({ userData: null, localWorkout: state.localWorkout });
            return;
        }

        let syncedLocalWorkout = state.localWorkout;

        // PWA BUG FIX: Never let a network fetch overwrite our active local workout!
        // The local device's localStorage is the source of truth for an ongoing workout.
        if (state.localWorkout) {
            syncedLocalWorkout = state.localWorkout;
        } else if (rawNextData.activeWorkout !== undefined) {
            syncedLocalWorkout = DomainParsers.parseActiveWorkout(rawNextData.activeWorkout) ?? null;
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

        const nextData = UserDataSchema.parse({
            ...rawNextData,
            activeWorkout: syncedLocalWorkout ?? null
        }) as unknown as UserData;
        const session = captureSession();
        if (state.userData) markTabSnapshotDirty(session, state.userData);
        set({ userData: nextData, localWorkout: syncedLocalWorkout });

        void saveUserDataToCache(nextData, state.userData ?? undefined)
            .then(durable => {
                if (!durable || !isCurrentSession(session)) return;
                const current = get();
                if (!current.userData || !equal(UserDataSchema.parse(current.userData), UserDataSchema.parse(nextData))) return;
                const aligned = UserDataSchema.parse({
                    ...durable,
                    activeWorkout: current.localWorkout ?? durable.activeWorkout ?? null,
                }) as unknown as UserData;
                set({ userData: aligned });
                markTabSnapshotClean(session, aligned);
            })
            .catch(error => {
                if (!isCurrentSession(session)) return;
                if (isUpdateRequiredError(error)) get().setUpdateRequired(error);
                else set({ saveError: 'Impossibile salvare i dati su questo dispositivo.', syncHealth: 'failed' });
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
            const result = await state.dispatchDomainOperation({
                type: 'nutrition-planning.replace',
                value: localPlan,
                origin: 'user-edited',
            });
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
