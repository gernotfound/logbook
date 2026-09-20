import type { StateCreator } from 'zustand';
import { DB } from '../../lib/db';
import type { UserData, SyncResult } from '../../types';
import { DEBOUNCE_DELAY_GLOBAL } from '../../constants';
import { saveUserDataToCache } from './createDataSlice';
import { clearWorkoutTimer } from './createWorkoutSlice';
import type { AppState } from '../useAppStore';
import { captureSession, invalidateSession, isCurrentSession } from '../../lib/sync/session';
import { commitDomainOperations, readLocal, revertRejectedConsent } from '../../lib/sync/localRepository';
import { findPendingAccountDeletion, readAccountDeletionMarker } from '../../lib/sync/accountGate';
import { UserDataSchema } from '../../lib/schema';
import { isUpdateRequiredError } from '../../lib/schemaEvolution';
import { applyDomainOperations, type DomainOperationBatch } from '../../lib/sync/domainOperations';

export type SyncHealth = 'saving' | 'synced' | 'local-pending' | 'rejected' | 'failed';
export type CompatibilityStatus = 'ok' | 'update-required';
export interface SyncSlice {
    saveError: string | null;
    syncing: boolean;
    syncHealth: SyncHealth;
    syncGeneration: number;
    localPersistenceBlocked: boolean;
    compatibilityStatus: CompatibilityStatus;
    compatibilityError: string | null;
    setSyncing: (value: boolean) => void;
    setSaveError: (value: string | null) => void;
    setUpdateRequired: (error: unknown) => void;
    saveUserData: (data: UserData | null | ((previous: UserData | null) => UserData | null)) => Promise<SyncResult>;
    updateUserData: (updater: (previous: UserData) => UserData) => Promise<SyncResult>;
    dispatchDomainOperation: (operation: DomainOperationBatch) => Promise<SyncResult>;
    submitLegalConsent: (consent: NonNullable<UserData['legalConsent']>) => Promise<void>;
    flushPendingSyncs: () => Promise<void>;
    cancelPendingSyncs: () => void;
    resetStore: (options?: { force?: boolean }) => void;
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
const LOCAL_PERSISTENCE_BLOCKED_MESSAGE = 'Archivio locale non leggibile dopo un errore di salvataggio. Le modifiche sono bloccate per evitare perdita di dati; riapri LogBook prima di continuare.';
const updateRequiredMessage = (error: unknown) => error instanceof Error
    ? error.message
    : 'Questi dati sono stati scritti da una versione più recente di LogBook. Aggiorna l’app prima di continuare.';
const updateRequiredResult = (message: string): SyncResult => ({ ok: false, status: 'failed', error: new Error(message) });

function relevantDeletionPending(): boolean {
    let guestOptIn = false;
    try { guestOptIn = localStorage.getItem('logbook_is_guest') === 'true'; }
    catch { /* Fail closed below when the owner cannot be resolved as an authenticated user. */ }
    if (guestOptIn) return false;

    const owner = captureSession().owner;
    if (owner.startsWith('user:')) return readAccountDeletionMarker(owner) !== null;
    return findPendingAccountDeletion() !== null;
}

export function clearSyncTimers() {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = [];
}

export const createSyncSlice: StateCreator<AppState, [], [], SyncSlice> = (set, get) => {
    const assertLocalPersistenceWritable = () => {
        if (get().localPersistenceBlocked) throw new Error(LOCAL_PERSISTENCE_BLOCKED_MESSAGE);
    };

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
        if (!pending.length || get().compatibilityStatus === 'update-required' || get().localPersistenceBlocked) return;
        const jobs = pending;
        pending = [];
        active = jobs;
        const last = jobs[jobs.length - 1];
        const session = last.session;
        const current = () => isCurrentSession(session);
        running = (async () => {
            let failureStatus: SyncHealth = 'failed';
            let blockLocalPersistence = false;
            try {
                const commits = await Promise.all(jobs.map(job => job.cache));
                const failed = commits.find(result => !result.ok);
                if (failed && !failed.ok) {
                    if (current() && get().syncGeneration === last.generation) {
                        try {
                            const durable = await readLocal(session.owner);
                            if (current() && get().syncGeneration === last.generation) {
                                if (!durable) blockLocalPersistence = true;
                                else set({ userData: { ...durable.data, activeWorkout: get().localWorkout } });
                            }
                        } catch {
                            if (current() && get().syncGeneration === last.generation) blockLocalPersistence = true;
                        }
                    }
                    throw failed.error;
                }
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
                    else if (blockLocalPersistence) set({ localPersistenceBlocked: true, syncHealth: 'failed', saveError: LOCAL_PERSISTENCE_BLOCKED_MESSAGE });
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

    const enqueue = (session: ReturnType<typeof captureSession>, generation: number, cache: Promise<CacheResult>) =>
        new Promise<SyncResult>((resolve, reject) => {
            pending.push({ session, generation, cache, resolve, reject });
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { timer = null; void run(); }, DEBOUNCE_DELAY_GLOBAL);
        });

    return {
        saveError: null,
        syncing: false,
        syncHealth: 'synced',
        syncGeneration: 0,
        localPersistenceBlocked: false,
        compatibilityStatus: 'ok',
        compatibilityError: null,
        setSyncing: value => set({ syncing: value }),
        setSaveError: value => set({ saveError: value }),
        setUpdateRequired: enterUpdateRequired,
        saveUserData: async dataOrUpdater => {
            if (get().compatibilityStatus === 'update-required') {
                return updateRequiredResult(get().compatibilityError ?? 'Aggiornamento richiesto.');
            }
            assertLocalPersistenceWritable();
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
            // Snapshot writes remain for bulk boundaries (hydration/import/guest merge), not ordinary domain actions.
            const cache = saveUserDataToCache(data, userData ?? UserDataSchema.parse({}) as unknown as UserData)
                .then<CacheResult>(() => ({ ok: true })).catch<CacheResult>(error => ({ ok: false, error }));
            return enqueue(session, generation, cache);
        },
        updateUserData: updater => {
            if (get().compatibilityStatus === 'update-required') {
                return Promise.resolve(updateRequiredResult(get().compatibilityError ?? 'Aggiornamento richiesto.'));
            }
            try { assertLocalPersistenceWritable(); }
            catch (error) { return Promise.reject(error); }
            const data = get().userData;
            if (!data) return Promise.reject(new Error('Dati utente non caricati'));
            return get().saveUserData(updater(data));
        },
        dispatchDomainOperation: async operation => {
            if (get().compatibilityStatus === 'update-required') {
                return updateRequiredResult(get().compatibilityError ?? 'Aggiornamento richiesto.');
            }
            assertLocalPersistenceWritable();
            const userData = get().userData;
            if (!userData) throw new Error('Dati utente non caricati');

            const data = applyDomainOperations(userData, operation);
            const generation = get().syncGeneration + 1;
            const session = captureSession();
            set({ userData: data, syncing: true, syncHealth: 'saving', saveError: null, syncGeneration: generation });

            // The business state and compiled SemanticOperation batch are committed by one IndexedDB update.
            const cache = commitDomainOperations(session.owner, operation, userData)
                .then<CacheResult>(() => ({ ok: true }))
                .catch<CacheResult>(error => ({ ok: false, error }));
            return enqueue(session, generation, cache);
        },
        submitLegalConsent: async consent => {
            if (get().compatibilityStatus === 'update-required') throw new Error(get().compatibilityError ?? 'Aggiornamento richiesto.');
            assertLocalPersistenceWritable();
            const session = captureSession();
            const previous = get().userData?.legalConsent;
            const result = get().dispatchDomainOperation({ type: 'legal-consent.set', consent });
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
            if (get().compatibilityStatus === 'update-required' || get().localPersistenceBlocked) return;
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
        resetStore: options => {
            // Preserve the recovery view only for the deletion that belongs to the active
            // authenticated owner, or for an auth-less post-deletion restart. A stale marker
            // from account A must not block/reset account B or an explicitly active guest.
            if (!options?.force && relevantDeletionPending()) {
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
                localPersistenceBlocked: false,
                compatibilityStatus: 'ok',
                compatibilityError: null,
            });
        },
    };
};
