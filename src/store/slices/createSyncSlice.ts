import type { StateCreator } from 'zustand';
import { DB } from '../../lib/db';
import type { UserData, SyncResult } from '../../types';
import { DEBOUNCE_DELAY_GLOBAL } from '../../constants';
import { saveUserDataToCache } from './createDataSlice';
import { clearWorkoutTimer } from './createWorkoutSlice';
import type { AppState } from '../useAppStore';
import { captureSession, invalidateSession, isCurrentSession } from '../../lib/sync/session';
import { readLocal, revertRejectedConsent } from '../../lib/sync/localRepository';
import { findPendingAccountDeletion } from '../../lib/sync/accountGate';
import { UserDataSchema } from '../../lib/schema';
import { isUpdateRequiredError } from '../../lib/schemaEvolution';

export type SyncHealth = 'saving' | 'synced' | 'local-pending' | 'rejected' | 'failed';
export type CompatibilityStatus = 'ok' | 'update-required';
export interface SyncSlice {
    saveError: string | null;
    syncing: boolean;
    syncHealth: SyncHealth;
    syncGeneration: number;
    compatibilityStatus: CompatibilityStatus;
    compatibilityError: string | null;
    setSyncing: (value: boolean) => void;
    setSaveError: (value: string | null) => void;
    setUpdateRequired: (error: unknown) => void;
    saveUserData: (data: UserData | null | ((previous: UserData | null) => UserData | null)) => Promise<SyncResult>;
    updateUserData: (updater: (previous: UserData) => UserData) => Promise<SyncResult>;
    submitLegalConsent: (consent: NonNullable<UserData['legalConsent']>) => Promise<void>;
    flushPendingSyncs: () => Promise<void>;
    cancelPendingSyncs: () => void;
    resetStore: () => void;
}

type CacheResult = { ok: true } | { ok: false; error: unknown };
type Job = {
    session: ReturnType<typeof captureSession>;
    generation: number;
    cache: Promise<CacheResult>;
    resolve: (result: SyncResult) => void;
    reject: (error: unknown) => void;
};
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Job[] = [];
let active: Job[] = [];
let running: Promise<void> | null = null;
const synced: SyncResult = { ok: true, status: 'synced' };
const updateRequiredMessage = (error: unknown) => error instanceof Error
    ? error.message
    : 'Questi dati sono stati scritti da una versione più recente di LogBook. Aggiorna l’app prima di continuare.';
const updateRequiredResult = (message: string): SyncResult => ({ ok: false, status: 'failed', error: new Error(message) });

export function clearSyncTimers() {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = [];
}

export const createSyncSlice: StateCreator<AppState, [], [], SyncSlice> = (set, get) => {
    const enterUpdateRequired = (error: unknown) => {
        const message = updateRequiredMessage(error);
        invalidateSession();
        clearWorkoutTimer();
        if (timer) clearTimeout(timer);
        timer = null;
        const queued = pending;
        pending = [];
        const blocked = updateRequiredResult(message);
        queued.forEach(job => job.resolve(blocked));
        set({
            compatibilityStatus: 'update-required',
            compatibilityError: message,
            syncing: false,
            syncHealth: 'failed',
            saveError: null,
            syncGeneration: get().syncGeneration + 1,
        });
    };

    const run = async (): Promise<void> => {
        if (running) {
            await running;
            if (pending.length) await run();
            return;
        }
        if (!pending.length || get().compatibilityStatus === 'update-required') return;
        const jobs = pending;
        pending = [];
        active = jobs;
        const last = jobs[jobs.length - 1];
        const session = last.session;
        const current = () => isCurrentSession(session);
        running = (async () => {
            let failureStatus: SyncHealth = 'failed';
            try {
                const commits = await Promise.all(jobs.map(job => job.cache));
                const failed = commits.find(result => !result.ok);
                if (failed && !failed.ok) throw failed.error;
                if (!current()) throw new Error('Sessione cambiata durante il salvataggio');
                const envelope = await readLocal(session.owner);
                if (!current()) throw new Error('Sessione cambiata durante il salvataggio');
                if (!envelope) throw new Error('Copia locale non disponibile');
                const result = await DB.saveUserData(envelope.data, envelope.revision);
                if (!current()) throw new Error('Sessione cambiata durante la sincronizzazione');
                if (result.ok) {
                    const saved = await readLocal(session.owner);
                    if (saved && current() && get().syncGeneration === last.generation) {
                        set({ userData: { ...saved.data, activeWorkout: get().localWorkout } });
                    }
                } else if (result.status !== 'local-pending') {
                    failureStatus = result.status;
                    throw result.status === 'rejected'
                        ? new Error("Sincronizzazione rifiutata dal server. Verifica l'accesso e riprova.", { cause: result.error })
                        : result.error instanceof Error ? result.error : new Error('Salvataggio fallito', { cause: result.error });
                }
                if (current() && get().syncGeneration === last.generation) {
                    set({ syncHealth: result.status, saveError: result.status === 'local-pending' ? 'Salvato localmente. Sincronizzazione in attesa.' : null });
                }
                jobs.forEach(job => job.resolve(result));
            } catch (error) {
                if (current() && get().syncGeneration === last.generation) {
                    if (isUpdateRequiredError(error)) enterUpdateRequired(error);
                    else set({ syncHealth: failureStatus, saveError: error instanceof Error ? error.message : 'Impossibile salvare i dati.' });
                }
                jobs.forEach(job => job.reject(error));
            } finally {
                active = [];
                if (current() && !pending.length && get().compatibilityStatus !== 'update-required') set({ syncing: false });
            }
        })();
        try { await running; } finally { running = null; }
    };

    return {
        saveError: null,
        syncing: false,
        syncHealth: 'synced',
        syncGeneration: 0,
        compatibilityStatus: 'ok',
        compatibilityError: null,
        setSyncing: value => set({ syncing: value }),
        setSaveError: value => set({ saveError: value }),
        setUpdateRequired: enterUpdateRequired,
        saveUserData: async dataOrUpdater => {
            if (get().compatibilityStatus === 'update-required') {
                return updateRequiredResult(get().compatibilityError ?? 'Aggiornamento richiesto.');
            }
            const { userData, localWorkout } = get();
            const next = typeof dataOrUpdater === 'function' ? dataOrUpdater(userData) : dataOrUpdater;
            if (!next) {
                // A reset clears only the view; deletion requires the explicit purge flow.
                get().cancelPendingSyncs();
                set({ userData: null, saveError: null });
                return synced;
            }
            const data = UserDataSchema.parse({ ...next, activeWorkout: next.activeWorkout !== undefined ? next.activeWorkout : localWorkout }) as unknown as UserData;
            const generation = get().syncGeneration + 1;
            const session = captureSession();
            set({ userData: data, syncing: true, syncHealth: 'saving', saveError: null, syncGeneration: generation });
            // Start the durable write before the cloud debounce. Observe rejection immediately.
            const cache = saveUserDataToCache(data, userData ?? UserDataSchema.parse({}) as unknown as UserData)
                .then<CacheResult>(() => ({ ok: true })).catch<CacheResult>(error => ({ ok: false, error }));
            return new Promise<SyncResult>((resolve, reject) => {
                pending.push({ session, generation, cache, resolve, reject });
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => { timer = null; void run(); }, DEBOUNCE_DELAY_GLOBAL);
            });
        },
        updateUserData: updater => {
            if (get().compatibilityStatus === 'update-required') {
                return Promise.resolve(updateRequiredResult(get().compatibilityError ?? 'Aggiornamento richiesto.'));
            }
            const data = get().userData;
            if (!data) return Promise.reject(new Error('Dati utente non caricati'));
            return get().saveUserData(updater(data));
        },
        submitLegalConsent: async consent => {
            if (get().compatibilityStatus === 'update-required') throw new Error(get().compatibilityError ?? 'Aggiornamento richiesto.');
            const session = captureSession();
            const previous = get().userData?.legalConsent;
            const result = get().updateUserData(data => ({ ...data, legalConsent: consent }));
            // Keep the form mounted until the durable operation has an explicit outcome.
            set(state => ({ userData: state.userData ? { ...state.userData, legalConsent: previous } : null }));
            const observed = result.then(value => ({ value }), error => ({ error }));
            await get().flushPendingSyncs();
            const settled = await observed;
            if ('error' in settled) {
                await revertRejectedConsent(session.owner, consent, previous);
                throw settled.error;
            }
            if (isCurrentSession(session)) set(state => ({ userData: state.userData ? { ...state.userData, legalConsent: consent } : null }));
        },
        flushPendingSyncs: async () => {
            if (get().compatibilityStatus === 'update-required') return;
            if (timer) clearTimeout(timer);
            timer = null;
            if (pending.length || running) {
                await run();
                return;
            }
            const session = captureSession();
            const saved = await readLocal(session.owner);
            if (!isCurrentSession(session) || !saved?.pending.length) return;
            const generation = get().syncGeneration + 1;
            set({ syncing: true, syncHealth: 'saving', syncGeneration: generation });
            const completion = new Promise<SyncResult>((resolve, reject) => pending.push({ session, generation, cache: Promise.resolve({ ok: true }), resolve, reject }));
            const observed = completion.then(() => undefined, error => { throw error; });
            void observed.catch(() => {});
            await run();
            await observed;
        },
        cancelPendingSyncs: () => {
            invalidateSession();
            clearWorkoutTimer();
            [...pending, ...active].forEach(job => job.reject(new Error('Sincronizzazione annullata per cambio sessione')));
            clearSyncTimers();
            set({ syncing: false, syncGeneration: get().syncGeneration + 1 });
        },
        resetStore: () => {
            // A server-coordinated deletion may remove Firebase Auth before this device has
            // verified completion and purged its local recovery copy. Auth callbacks must
            // therefore fail closed while any durable deletion receipt remains.
            if (findPendingAccountDeletion()) {
                get().cancelPendingSyncs();
                set({ syncing: false, saveError: 'Cancellazione account in verifica. Copia locale conservata fino alla conferma del server.' });
                return;
            }
            get().cancelPendingSyncs();
            set({
                userData: null,
                localWorkout: null,
                saveError: null,
                syncing: false,
                syncHealth: 'synced',
                compatibilityStatus: 'ok',
                compatibilityError: null,
            });
        },
    };
};

