import type { StateCreator } from 'zustand';
import { del as idbDel } from 'idb-keyval';
import equal from 'fast-deep-equal';
import { DomainParsers, UserDataSchema } from '../../lib/schema';
import type { ResolveNutritionConflictInput, SyncResult, UserData } from '../../types';
import type { AppState } from '../useAppStore';
import { getNutritionConflictFingerprint } from '../../lib/utils/object';

import { updateStorageMarker, clearStorageMarker } from '../../lib/storageTelemetry';
import { commitLocal, initializeLocal, clearNutritionConflict, readLocal, StaleLocalRevisionError } from '../../lib/sync/localRepository';
import { writeDeviceValue } from '../../lib/sync/deviceStorage';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { markTabSnapshotClean, markTabSnapshotDirty } from '../../lib/sync/tabSnapshotCausality';
import { isUpdateRequiredError } from '../../lib/schemaEvolution';

export interface DataSlice {
    userData: UserData | null;
    dataOwner: string | null;
    setUserData: (data: UserData | null | ((prev: UserData | null) => UserData | null)) => void;
    resolveNutritionConflict: (input: ResolveNutritionConflictInput) => Promise<SyncResult>;
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

export const saveUserDataToCache = async (data: UserData | null, base?: UserData, expectedRevision?: number): Promise<UserData | null> => {
        const session = captureSession();
        if (data) {
            const current = await readLocal(session.owner);
            if (expectedRevision !== undefined && current?.revision !== expectedRevision) {
                throw new StaleLocalRevisionError(expectedRevision, current?.revision ?? null);
            }
            if (!current || !equal(UserDataSchema.parse(current.data), UserDataSchema.parse(data))) {
                if (base) await commitLocal(session.owner, data, base, undefined, expectedRevision);
                else if (current) await commitLocal(session.owner, data, current.data, undefined, expectedRevision);
                else {
                    if (expectedRevision !== undefined) throw new StaleLocalRevisionError(expectedRevision, null);
                    await initializeLocal(session.owner, data);
                }
            }
            const envelope = await readLocal(session.owner);
            if (!envelope) throw new Error('Copia locale non disponibile dopo il salvataggio.');
            if (isCurrentSession(session)) updateStorageMarker(Date.now(), undefined, session.owner);
            return envelope.data;
        }
        await idbDel(`logbook:v2:${session.owner}`);
        if (isCurrentSession(session)) clearStorageMarker(undefined, session.owner);
        return null;
};

function alignActiveWorkout(
    incoming: UserData['activeWorkout'],
    localWorkout: AppState['localWorkout'],
): { persisted: UserData['activeWorkout']; local: AppState['localWorkout'] } {
    const parsedIncoming = DomainParsers.parseActiveWorkout(incoming) ?? null;
    // Persisted business state and the device draft are separate authorities.
    // Bulk hydration may preserve only the same live session (device keystrokes can
    // be newer than IndexedDB) or a deliberately isolated history edit.
    if (localWorkout) return { persisted: parsedIncoming, local: localWorkout };
    return { persisted: parsedIncoming, local: parsedIncoming };
}

export const createDataSlice: StateCreator<AppState, [], [], DataSlice> = (set, get) => ({
    userData: getInitialUserData(),
    dataOwner: null,

    setUserData: (dataOrUpdater) => {
        const state = get();
        if (state.compatibilityStatus === 'update-required') return;

        const rawNextData = typeof dataOrUpdater === 'function'
            ? (dataOrUpdater as (prev: UserData | null) => UserData | null)(state.userData)
            : dataOrUpdater;

        if (!rawNextData) {
            // Resetting the view must not erase a durable journal.
            set({ userData: null, dataOwner: null, localWorkout: state.localWorkout });
            return;
        }

        const session = captureSession();
        const aligned = alignActiveWorkout(rawNextData.activeWorkout, state.localWorkout);
        if (aligned.local !== state.localWorkout) {
            try {
                if (aligned.local) writeDeviceValue('workout', JSON.stringify(aligned.local), session.owner);
                else writeDeviceValue('workout', null, session.owner);
            } catch (error) {
                console.error('Allineamento device-critical del workout fallito:', error);
                set({
                    localPersistenceBlocked: true,
                    syncHealth: 'failed',
                    syncPresentation: 'normal',
                    saveError: 'Impossibile salvare l’allenamento sul dispositivo. I dati in memoria non vengono avanzati per evitare perdita o sovrascritture.',
                });
                return;
            }
        }

        const nextData = UserDataSchema.parse({
            ...rawNextData,
            activeWorkout: aligned.persisted,
        }) as unknown as UserData;
        if (state.userData) markTabSnapshotDirty(session, state.userData);
        set({ userData: nextData, dataOwner: session.owner, localWorkout: aligned.local });

        void saveUserDataToCache(nextData, state.userData ?? undefined)
            .then(durable => {
                if (!durable || !isCurrentSession(session)) return;
                const current = get();
                // Only the exact state instance installed by this setUserData call may
                // reconcile the async durable result. A later direct/store update can be
                // structurally equal while representing a newer lifecycle decision.
                if (current.userData !== nextData) return;
                const reconciled = alignActiveWorkout(durable.activeWorkout, current.localWorkout);
                const alignedData = UserDataSchema.parse({
                    ...durable,
                    activeWorkout: reconciled.persisted,
                }) as unknown as UserData;
                set({ userData: alignedData, dataOwner: session.owner, localWorkout: reconciled.local });
                markTabSnapshotClean(session, alignedData);
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
