import { useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';
import { User } from 'firebase/auth';
import { auth, getDb, waitForPendingWrites, provider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from '../lib/firebase';
import { DB } from '../lib/db';
import { useAppStore } from '../store/useAppStore';
import { UserData } from '../types';
import { UserDataSchema } from '../lib/schema';
import { AuthContext } from './AuthContextDef';
import { useDialogStore } from '../store/useDialogStore';
import { getCachedCatalog, getInMemoryCatalog, isCatalogInMemory } from '../lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../lib/catalog/deltaResolver';
import { draftRegistry } from '../lib/utils/draftRegistry';
import { getResolvedDefaultUserData } from './auth/defaultUserData';
import { loadAuthenticatedData } from './auth/loadAuthenticatedData';
import { migrateGuestAccount } from './auth/migrateGuestAccount';
import { replicateJournal } from '../lib/sync/replicateJournal';
import { captureSession, invalidateSession, isCurrentSession, userOwner } from '../lib/sync/session';
import { classifySyncFailure } from '../lib/sync/syncFailure';
import { SyncTimeoutError } from '../lib/db/db_core';
import {
    readBrowserValue,
    removeBrowserValue,
    tryRemoveBrowserValue,
    writeBrowserValue,
} from '../lib/sync/browserStorage';
import { safeHardReload } from '../lib/sync/safeReload';

const GUEST_KEY = 'logbook_is_guest';
const GUEST_MIGRATION_POLICY_KEY = 'guest_migration_policy';
const GUEST_MIGRATION_SYNC_RECOVERY_KEY = 'logbook_guest_migration_sync_recovery';
const AWAITING_REDIRECT_KEY = 'logbook_awaiting_redirect';

function isStoredGuest(): boolean {
    return readBrowserValue(GUEST_KEY) === 'true';
}

function readGuestMigrationSyncRecovery(): string | null {
    return readBrowserValue(GUEST_MIGRATION_SYNC_RECOVERY_KEY);
}

function markGuestMigrationSyncRecovery(uid: string): void {
    writeBrowserValue(GUEST_MIGRATION_SYNC_RECOVERY_KEY, uid);
}

function clearGuestMigrationSyncRecovery(uid: string): void {
    if (readBrowserValue(GUEST_MIGRATION_SYNC_RECOVERY_KEY) === uid) {
        tryRemoveBrowserValue(GUEST_MIGRATION_SYNC_RECOVERY_KEY);
    }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    // isGuest è gestito con un ref (per uso nei callback) + state (per re-render)
    const isGuestRef = useRef(isStoredGuest());
    const [isGuest, setIsGuest] = useState(isGuestRef.current);
    const [guestMigrationStatus, setGuestMigrationStatus] = useState<'idle' | 'pending' | 'failed'>('idle');

    // Dati da migrare da guest a Google al momento del link
    const migrationDataRef = useRef<UserData | null>(null);
    const authRunRef = useRef(0);
    const authUidRef = useRef(auth.currentUser?.uid ?? null);

    const setUserData = useAppStore(state => state.setUserData);
    const setSyncing = useAppStore(state => state.setSyncing);
    const setSaveError = useAppStore(state => state.setSaveError);

    const loadData = useCallback(async (user: User) => {
        await loadAuthenticatedData({
            user,
            isGuestActive: () => isGuestRef.current || isStoredGuest(),
            setUserData,
            setSyncing,
            setSaveError,
        });
    }, [setSyncing, setUserData, setSaveError]);

    useEffect(() => {
        if (!currentUser || guestMigrationStatus === 'idle') return;

        const appContainer = document.getElementById('app-container');
        const parent = appContainer?.parentElement;
        if (!appContainer || !parent) return;

        const authOverlay = Array.from(parent.children).find(
            element => element instanceof HTMLElement && element.id === 'auth-overlay'
        );
        const background = Array.from(parent.children).filter(
            (element): element is HTMLElement => element instanceof HTMLElement && element !== authOverlay
        );
        const previousInert = background.map(element => element.inert);

        background.forEach(element => { element.inert = true; });

        return () => {
            background.forEach((element, index) => { element.inert = previousInert[index]; });
        };
    }, [currentUser, guestMigrationStatus]);

    useEffect(() => {
        let isMounted = true;
        const handleAuthVisibilityChange = async () => {
            if (document.visibilityState !== 'visible' || readBrowserValue(AWAITING_REDIRECT_KEY) !== 'true') return;
            if (!tryRemoveBrowserValue(AWAITING_REDIRECT_KEY)) {
                setSaveError('Accesso completato, ma non riesco ad aggiornare lo stato locale del dispositivo. Riprova.');
                return;
            }
            try {
                await safeHardReload();
            } catch (error) {
                console.warn('Reload post-auth bloccato dalla barriera di persistenza:', error);
                setSaveError(error instanceof Error ? error.message : 'Ricaricamento non sicuro. Riprova.');
            }
        };
        document.addEventListener('visibilitychange', handleAuthVisibilityChange);

        getRedirectResult(auth).then(() => {
            tryRemoveBrowserValue(AWAITING_REDIRECT_KEY);
        }).catch(err => {
            console.warn("getRedirectResult error (non critico):", err);
        });

        const resumePersistedGuestMigration = async (user: User, isCurrentRun: () => boolean): Promise<boolean> => {
            if (!isCurrentRun()) return true;
            setGuestMigrationStatus('pending');

            let authenticatedEnvelope: Awaited<ReturnType<typeof import('../lib/sync/localRepository')['readLocal']>>;
            try {
                const { readLocal } = await import('../lib/sync/localRepository');
                if (!isCurrentRun()) return true;
                authenticatedEnvelope = await readLocal(user.uid);
            } catch (error) {
                if (!isCurrentRun()) return true;
                console.error('Recovery migrazione account non riuscita durante la lettura locale:', error);
                setGuestMigrationStatus('failed');
                setSaveError('Recovery account non completata. I dati locali sono stati lasciati intatti. Riprova.');
                return true;
            }

            if (!isCurrentRun()) return true;

            const guestStillActive = isGuestRef.current || isStoredGuest();
            if (!authenticatedEnvelope) {
                if (guestStillActive) {
                    clearGuestMigrationSyncRecovery(user.uid);
                    return false;
                }

                setGuestMigrationStatus('failed');
                setSaveError('Recovery account non completata: copia locale autenticata non disponibile. I dati non sono stati dichiarati sincronizzati.');
                return true;
            }

            setUserData(authenticatedEnvelope.data);

            if (guestStillActive) {
                useAppStore.getState().setLocalWorkout(authenticatedEnvelope.data.activeWorkout || null);
                try {
                    if (!isCurrentRun()) return true;
                    removeBrowserValue(GUEST_KEY);
                    tryRemoveBrowserValue(GUEST_MIGRATION_POLICY_KEY);
                    isGuestRef.current = false;
                    setIsGuest(false);
                    migrationDataRef.current = null;
                } catch (error) {
                    if (!isCurrentRun()) return true;
                    console.error('Recovery migrazione account non riuscita durante il cambio owner:', error);
                    setGuestMigrationStatus('failed');
                    setSaveError('Recovery account non completata. La copia locale autenticata è conservata; riprova.');
                    return true;
                }
            }

            if (!isCurrentRun()) return true;
            setSyncing(true);
            try {
                const result = await replicateJournal(userOwner(user.uid));
                if (!isCurrentRun()) return true;

                if (result.status === 'synced' || result.status === 'local-pending') {
                    clearGuestMigrationSyncRecovery(user.uid);
                    setGuestMigrationStatus('idle');
                    if (result.status === 'local-pending') {
                        setSaveError('📶 Offline: i dati sono salvati sul dispositivo e verranno sincronizzati quando torni online.');
                    }
                } else {
                    setGuestMigrationStatus('failed');
                    setSaveError('Sincronizzazione account non completata. I dati locali restano conservati. Riprova.');
                }
            } catch (error) {
                if (!isCurrentRun()) return true;
                console.error('Recovery sincronizzazione account non riuscita:', error);
                setGuestMigrationStatus('failed');
                setSaveError('Sincronizzazione account non completata. I dati locali restano conservati. Riprova.');
            } finally {
                if (isCurrentRun()) setSyncing(false);
            }

            return true;
        };

        const unsubscribe = onAuthStateChanged(auth, async (user: any) => {
            if (!isMounted) return;

            const nextUid = user?.uid ?? null;
            const previousUid = authUidRef.current;
            authUidRef.current = nextUid;
            const authRun = ++authRunRef.current;
            if (previousUid !== nextUid) invalidateSession();
            setSyncing(false);
            const expectedUid = nextUid;
            const isCurrentRun = () => isMounted
                && authRunRef.current === authRun
                && (expectedUid ? auth.currentUser?.uid === expectedUid : auth.currentUser === null);

            if (user) tryRemoveBrowserValue(AWAITING_REDIRECT_KEY);
            setCurrentUser(user);
            setLoading(false);

            if (user) {
                const wasGuest = isGuestRef.current || isStoredGuest();
                const recoveryUid = readGuestMigrationSyncRecovery();

                if (recoveryUid === user.uid) {
                    const handled = await resumePersistedGuestMigration(user, isCurrentRun);
                    if (!isCurrentRun()) return;
                    if (handled) return;
                }

                if (wasGuest) {
                    setGuestMigrationStatus('pending');
                    draftRegistry.flushAll();

                    const guestData = migrationDataRef.current || useAppStore.getState().userData;
                    const policy = readBrowserValue(GUEST_MIGRATION_POLICY_KEY) === 'skip' ? 'skip' : 'merge';

                    try {
                        const migrationResult = await migrateGuestAccount({
                            user,
                            guestData,
                            policy,
                            setUserData,
                            setSyncing,
                            isCurrent: isCurrentRun,
                            onLocalReady: () => {
                                // Persist recovery before changing owner. If any critical
                                // storage transition fails, migration remains recoverable.
                                markGuestMigrationSyncRecovery(user.uid);
                                removeBrowserValue(GUEST_KEY);
                                tryRemoveBrowserValue(GUEST_MIGRATION_POLICY_KEY);
                                isGuestRef.current = false;
                                setIsGuest(false);
                                migrationDataRef.current = null;
                            },
                        });

                        if (!isCurrentRun()) return;

                        if (migrationResult.status === 'rejected' || migrationResult.status === 'failed') {
                            setGuestMigrationStatus('failed');
                            setSaveError('I dati sono salvati su questo dispositivo, ma la sincronizzazione dell’account non è stata completata. Riprova.');
                        } else {
                            clearGuestMigrationSyncRecovery(user.uid);
                            setGuestMigrationStatus('idle');
                            if (migrationResult.status === 'local-pending') {
                                setSaveError('📶 Offline: account preparato sul dispositivo. La sincronizzazione riprenderà quando torni online.');
                            }
                        }
                    } catch (error) {
                        if (!isCurrentRun()) return;
                        console.error('Preparazione account da modalità locale non completata:', error);
                        setGuestMigrationStatus('failed');
                        setSaveError('Preparazione account non completata. I dati locali sono conservati e possono essere recuperati. Riprova.');
                    }
                } else {
                    setGuestMigrationStatus('idle');
                    void loadData(user);
                }
            } else {
                setGuestMigrationStatus('idle');
                const isGuestActive = isGuestRef.current || isStoredGuest();
                if (!isGuestActive) {
                    DB.resetCache();
                    useAppStore.getState().resetStore();
                }
            }
        });

        const safetyTimer = setTimeout(() => {
            if (isMounted) setLoading(false);
        }, 3000);

        let isReloading = false;
        const handleVisibilityChange = async () => {
            if (isGuestRef.current || isStoredGuest()) return;
            if (document.visibilityState === 'visible' && auth.currentUser) {
                if (useAppStore.getState().userData !== null && !useAppStore.getState().syncing && !isReloading) {
                    try {
                        isReloading = true;
                        await Promise.race([
                            waitForPendingWrites(getDb()),
                            new Promise(resolve => setTimeout(resolve, 1500))
                        ]);
                        await loadData(auth.currentUser);
                    } catch (e) {
                        console.warn("Skipping visibility reload due to pending writes / timeout", e);
                    } finally {
                        isReloading = false;
                    }
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            isMounted = false;
            authRunRef.current += 1;
            invalidateSession();
            clearTimeout(safetyTimer);
            unsubscribe();
            document.removeEventListener('visibilitychange', handleAuthVisibilityChange);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [loadData, setSyncing, setUserData, setSaveError]);

    // Login con Google (dalla schermata di login, nessun guest precedente)
    const login = useCallback(async () => {
        setSaveError(null);
        try {
            await signInWithPopup(auth, provider);
        } catch (error: any) {
            if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user' || error.code === 'auth/internal-error' || error.code === 'auth/network-request-failed' || /popup/i.test(error.message)) {
                try {
                    writeBrowserValue(AWAITING_REDIRECT_KEY, 'true');
                    await signInWithRedirect(auth, provider);
                } catch (redirectError) {
                    console.error("Errore login redirect", redirectError);
                    setSaveError("Accesso fallito. Riprova.");
                }
            } else {
                console.error("Errore di login", error);
                setSaveError("Errore di accesso: " + error.message);
            }
        }
    }, [setSaveError]);

    const handleAuthError = useCallback((error: any) => {
        let msg = "Errore di autenticazione.";
        switch (error.code) {
            case 'auth/email-already-in-use': msg = "Questa email è già registrata."; break;
            case 'auth/invalid-email': msg = "Formato email non valido."; break;
            case 'auth/weak-password': msg = "La password è troppo debole (min. 6 caratteri per Firebase)."; break;
            case 'auth/user-not-found':
            case 'auth/wrong-password':
            case 'auth/invalid-credential':
                msg = "Email o password errati."; break;
            case 'auth/too-many-requests': msg = "Troppi tentativi falliti. Riprova più tardi."; break;
            default: msg = error.message;
        }
        setSaveError(msg);
        throw error;
    }, [setSaveError]);

    const loginWithEmail = useCallback(async (email: string, pass: string) => {
        setSaveError(null);
        try {
            await signInWithEmailAndPassword(auth, email, pass);
        } catch (error) {
            handleAuthError(error);
        }
    }, [handleAuthError, setSaveError]);

    const registerWithEmail = useCallback(async (email: string, pass: string) => {
        setSaveError(null);
        migrationDataRef.current = useAppStore.getState().userData;
        try {
            await createUserWithEmailAndPassword(auth, email, pass);
        } catch (error) {
            handleAuthError(error);
        }
    }, [handleAuthError, setSaveError]);

    // Accesso guest: solo localStorage, zero Firebase
    const loginAsGuest = useCallback(async () => {
        try {
            writeBrowserValue(GUEST_KEY, 'true');
        } catch {
            setSaveError('Impossibile avviare la modalità locale: archivio del dispositivo non disponibile.');
            return;
        }
        isGuestRef.current = true;
        setIsGuest(true);
        setGuestMigrationStatus('idle');
        const currentData = useAppStore.getState().userData;
        if (!currentData) {
            const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
            const initialGuestData = getResolvedDefaultUserData(catalog);
            setUserData(UserDataSchema.parse(initialGuestData) as unknown as UserData);
        } else {
            const hasCatalogExercises = Array.isArray(currentData.library) && currentData.library.some(e => e.isDefault === true);
            const hasCatalogFoods = Array.isArray(currentData.customFoods) && currentData.customFoods.some(f => f.isCustom === false);
            if (!hasCatalogExercises || !hasCatalogFoods) {
                const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
                const resolvedLibrary = !hasCatalogExercises
                    ? resolveEffectiveExercises(catalog.exercises, currentData.library || [], currentData.catalogOverrides)
                    : currentData.library;
                const resolvedFoods = !hasCatalogFoods
                    ? resolveEffectiveFoods(catalog.foods, currentData.customFoods || [], currentData.catalogOverrides)
                    : currentData.customFoods;
                setUserData({
                    ...currentData,
                    library: resolvedLibrary,
                    customFoods: resolvedFoods
                });
            }
        }
    }, [setSaveError, setUserData]);

    // Collega account Google: migra i dati locali su Firestore
    const linkGoogleAccount = useCallback(async () => {
        setSaveError(null);
        migrationDataRef.current = useAppStore.getState().userData;
        try {
            await signInWithPopup(auth, provider);
        } catch (error: any) {
            if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user' || error.code === 'auth/internal-error' || error.code === 'auth/network-request-failed' || /popup/i.test(error.message)) {
                try {
                    writeBrowserValue(AWAITING_REDIRECT_KEY, 'true');
                    await signInWithRedirect(auth, provider);
                } catch (redirectError) {
                    console.error("Errore collegamento redirect:", redirectError);
                    setSaveError("Accesso fallito. Riprova.");
                }
                return;
            }
            console.error("Errore collegamento account Google:", error);
            setSaveError("Collegamento fallito. Riprova.");
        }
    }, [setSaveError]);

    const retryGuestMigration = useCallback(async () => {
        setSaveError(null);

        if (isStoredGuest()) {
            try {
                await safeHardReload();
            } catch (error) {
                setSaveError(error instanceof Error ? error.message : 'Ricaricamento non sicuro. Riprova.');
            }
            return;
        }

        const initialUid = auth.currentUser?.uid;
        if (!initialUid) {
            setGuestMigrationStatus('failed');
            setSaveError('Sincronizzazione account non completata. Accedi nuovamente e riprova.');
            return;
        }

        const session = captureSession();
        const expectedOwner = userOwner(initialUid);
        const isCurrentRetry = () => session.owner === expectedOwner
            && isCurrentSession(session)
            && auth.currentUser?.uid === initialUid
            && !isStoredGuest();

        if (!isCurrentRetry()) return;

        setGuestMigrationStatus('pending');
        setSyncing(true);
        try {
            const result = await replicateJournal(expectedOwner);
            if (!isCurrentRetry()) return;

            if (result.status === 'synced' || result.status === 'local-pending') {
                clearGuestMigrationSyncRecovery(initialUid);
                setGuestMigrationStatus('idle');
                if (result.status === 'local-pending') {
                    setSaveError('📶 Offline: i dati sono salvati sul dispositivo e verranno sincronizzati quando torni online.');
                }
            } else {
                setGuestMigrationStatus('failed');
                setSaveError('Sincronizzazione account non completata. I dati locali restano conservati. Riprova.');
            }
        } catch (error) {
            if (!isCurrentRetry()) return;
            console.error('Retry sincronizzazione account non riuscito:', error);
            setGuestMigrationStatus('failed');
            setSaveError('Sincronizzazione account non completata. I dati locali restano conservati. Riprova.');
        } finally {
            if (isCurrentRetry()) setSyncing(false);
        }
    }, [setSaveError, setSyncing]);

    const logoutInFlightRef = useRef(false);
    const LOGOUT_SYNC_CHECK_TIMEOUT_MS = 5000;

    const logout = useCallback(async (options?: { mode?: 'normal' | 'force', skipConfirm?: boolean }) => {
        if (logoutInFlightRef.current) return;
        logoutInFlightRef.current = true;

        try {
            const skipConfirm = options?.skipConfirm;
            const mode = options?.mode || 'normal';
            const initialUid = auth.currentUser?.uid;

            if (isGuestRef.current || isStoredGuest()) {
                if (!skipConfirm) {
                    const confirmed = await useDialogStore.getState().showConfirm(
                        "Sei in modalità locale. Se esci, i tuoi dati su questo dispositivo andranno persi definitivamente e non potranno essere recuperati.\n\nSei sicuro di voler continuare?"
                    );
                    if (!confirmed) return;
                }

                useAppStore.getState().cancelPendingSyncs();
                await DB.purgeAllLocalUserData();

                try {
                    removeBrowserValue(GUEST_KEY);
                } catch {
                    await useDialogStore.getState().showAlert('Dati locali eliminati, ma non riesco ad aggiornare lo stato del dispositivo. Ricarica LogBook e riprova.');
                    return;
                }
                if (initialUid) clearGuestMigrationSyncRecovery(initialUid);
                isGuestRef.current = false;
                setIsGuest(false);
                setGuestMigrationStatus('idle');
                useAppStore.getState().resetStore({ force: true });
                return;
            }

            if (mode === 'normal') {
                setSyncing(true);
                const state = useAppStore.getState();
                let isSafe = state.syncHealth === 'synced' && !state.userData?.pendingConflicts;
                let pendingWriteStatus: 'local-pending' | 'rejected' | 'failed' | null = null;

                if (!isSafe) {
                    try {
                        const { waitForPendingWrites } = await import('firebase/firestore');
                        const { getDb } = await import('../lib/firebase');

                        const timeoutPromise = new Promise((_, reject) => setTimeout(
                            () => reject(new SyncTimeoutError('Controllo sincronizzazione logout scaduto')),
                            LOGOUT_SYNC_CHECK_TIMEOUT_MS
                        ));
                        await Promise.race([waitForPendingWrites(getDb()), timeoutPromise]);
                    } catch (error) {
                        const failure = classifySyncFailure(error);
                        pendingWriteStatus = failure.status;
                        if (failure.status !== 'local-pending') {
                            console.warn('Controllo scritture pendenti durante logout fallito:', error);
                        }
                    }

                    if (auth.currentUser?.uid !== initialUid) {
                        setSyncing(false);
                        return;
                    }

                    const finalState = useAppStore.getState();
                    isSafe = finalState.syncHealth === 'synced' && !finalState.userData?.pendingConflicts && pendingWriteStatus === null;
                }
                setSyncing(false);

                if (!isSafe) {
                    const finalState = useAppStore.getState();
                    let reason: 'conflict' | 'offline' | 'rejected' | 'failed' = 'offline';

                    if (finalState.userData?.pendingConflicts) {
                        reason = 'conflict';
                    } else if (finalState.syncHealth === 'rejected' || pendingWriteStatus === 'rejected') {
                        reason = 'rejected';
                    } else if (finalState.syncHealth === 'failed' || pendingWriteStatus === 'failed') {
                        reason = 'failed';
                    }

                    const action = await useDialogStore.getState().showUnsyncedDataLogout(reason);

                    if (auth.currentUser?.uid !== initialUid) {
                        return;
                    }

                    if (action === 'export') {
                        const { Exporter } = await import('../lib/export');
                        const currentState = useAppStore.getState().userData;
                        if (currentState) {
                            Exporter.exportEmergencyJSON(currentState);
                        }
                        return;
                    }

                    if (action === 'cancel' || action === 'wait') {
                        return;
                    } else if (action === 'safe-exit') {
                        const finalCheck = useAppStore.getState();
                        if (finalCheck.syncHealth !== 'synced' || finalCheck.userData?.pendingConflicts) {
                            return;
                        }
                    }
                }
            }

            setSyncing(true);
            try {
                useAppStore.getState().cancelPendingSyncs();
                await DB.secureLogOut();
                DB.resetCache();
                useAppStore.getState().resetStore({ force: true });
                if (initialUid) clearGuestMigrationSyncRecovery(initialUid);
                setGuestMigrationStatus('idle');
            } catch (error: any) {
                console.error("Errore durante il logout:", error);
                await useDialogStore.getState().showAlert("Errore durante il logout. Controlla la connessione.");
            } finally {
                setSyncing(false);
            }
        } finally {
            logoutInFlightRef.current = false;
        }
    }, [setSyncing]);

    const value = useMemo(() => ({
        currentUser,
        loading,
        isGuest,
        guestMigrationStatus,
        login,
        loginAsGuest,
        linkGoogleAccount,
        retryGuestMigration,
        logout,
        loginWithEmail,
        registerWithEmail
    }), [currentUser, loading, isGuest, guestMigrationStatus, login, loginAsGuest, linkGoogleAccount, retryGuestMigration, logout, loginWithEmail, registerWithEmail]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
