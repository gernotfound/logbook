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

const GUEST_KEY = 'logbook_is_guest';
const GUEST_MIGRATION_POLICY_KEY = 'guest_migration_policy';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    // isGuest è gestito con un ref (per uso nei callback) + state (per re-render)
    const isGuestRef = useRef(localStorage.getItem(GUEST_KEY) === 'true');
    const [isGuest, setIsGuest] = useState(isGuestRef.current);
    const [guestMigrationStatus, setGuestMigrationStatus] = useState<'idle' | 'pending' | 'failed'>('idle');

    // Dati da migrare da guest a Google al momento del link
    const migrationDataRef = useRef<UserData | null>(null);

    const setUserData = useAppStore(state => state.setUserData);
    const setSyncing = useAppStore(state => state.setSyncing);
    const setSaveError = useAppStore(state => state.setSaveError);

    const loadData = useCallback(async (user: User) => {
        await loadAuthenticatedData({
            user,
            isGuestActive: () => isGuestRef.current || localStorage.getItem(GUEST_KEY) === 'true',
            setUserData,
            setSyncing,
            setSaveError,
        });
    }, [setSyncing, setUserData, setSaveError]);

    useEffect(() => {
        let isMounted = true;
        const handleAuthVisibilityChange = () => {
            if (document.visibilityState === 'visible' && localStorage.getItem('logbook_awaiting_redirect') === 'true') {
                console.log('Rilevato ritorno da redirect auth, forzo reload per sincronizzare lo stato.');
                localStorage.removeItem('logbook_awaiting_redirect');
                window.location.reload();
            }
        };
        document.addEventListener('visibilitychange', handleAuthVisibilityChange);


        getRedirectResult(auth).then(() => localStorage.removeItem('logbook_awaiting_redirect')).catch(err => {
            console.warn("getRedirectResult error (non critico):", err);
        });

        const unsubscribe = onAuthStateChanged(auth, async (user: any) => {
            if (user) localStorage.removeItem('logbook_awaiting_redirect');
            if (!isMounted) return;
            setCurrentUser(user);
            setLoading(false);

            if (user) {
                const wasGuest = isGuestRef.current || localStorage.getItem(GUEST_KEY) === 'true';
                if (wasGuest) {
                    // Firebase ha autenticato l'utente, ma restiamo semanticamente guest finché
                    // l'envelope autenticato non è stato scritto con successo in IndexedDB.
                    setGuestMigrationStatus('pending');

                    draftRegistry.flushAll();

                    const guestData = migrationDataRef.current || useAppStore.getState().userData;
                    const policy = localStorage.getItem(GUEST_MIGRATION_POLICY_KEY) === 'skip' ? 'skip' : 'merge';

                    try {
                        const migrationResult = await migrateGuestAccount({
                            user,
                            guestData,
                            policy,
                            setUserData,
                            setSyncing,
                            onLocalReady: () => {
                                // Questo callback viene invocato solo dopo una persistenza locale
                                // autenticata riuscita. Da qui un reload può ripartire dall'owner UID.
                                localStorage.removeItem(GUEST_KEY);
                                isGuestRef.current = false;
                                if (isMounted) setIsGuest(false);
                                localStorage.removeItem(GUEST_MIGRATION_POLICY_KEY);
                                migrationDataRef.current = null;
                            },
                        });

                        if (!isMounted) return;

                        if (migrationResult.status === 'rejected' || migrationResult.status === 'failed') {
                            setGuestMigrationStatus('failed');
                            setSaveError('I dati sono salvati su questo dispositivo, ma la sincronizzazione dell’account non è stata completata. Riprova.');
                        } else {
                            setGuestMigrationStatus('idle');
                            if (migrationResult.status === 'local-pending') {
                                setSaveError('📶 Offline: account preparato sul dispositivo. La sincronizzazione riprenderà quando torni online.');
                            }
                        }
                    } catch (error) {
                        console.error('Preparazione account da modalità locale non completata:', error);
                        if (!isMounted) return;
                        setGuestMigrationStatus('failed');
                        setSaveError('Preparazione account non completata. I dati locali sono conservati e possono essere recuperati. Riprova.');
                    }
                } else {
                    // Login normale con Google
                    setGuestMigrationStatus('idle');
                    loadData(user);
                }
            } else {
                setGuestMigrationStatus('idle');
                // Nessun utente Firebase: resetta solo se NON siamo in modalità guest
                const isGuestActive = isGuestRef.current || localStorage.getItem(GUEST_KEY) === 'true';
                if (!isGuestActive) {
                    DB.resetCache();
                    useAppStore.getState().resetStore();
                }
                // Se guest: i dati rimangono nel localStorage/IndexedDB, non tocchiamo nulla
            }
        });

        const safetyTimer = setTimeout(() => {
            if (isMounted) setLoading(false);
        }, 3000);

        let isReloading = false;
        const handleVisibilityChange = async () => {
            // Guest: niente re-sync dal cloud
            if (isGuestRef.current || localStorage.getItem(GUEST_KEY) === 'true') return;
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
                    localStorage.setItem('logbook_awaiting_redirect', 'true');
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
        localStorage.setItem(GUEST_KEY, 'true');
        isGuestRef.current = true;
        setIsGuest(true);
        setGuestMigrationStatus('idle');
        // Se non ci sono dati precedenti in store/cache, inizializza con il catalogo globale risolto
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
    }, [setUserData]);

    // Collega account Google: migra i dati locali su Firestore
    const linkGoogleAccount = useCallback(async () => {
        setSaveError(null);
        // Cattura i dati guest prima del login (il popup/redirect potrebbe ricaricare la pagina)
        migrationDataRef.current = useAppStore.getState().userData;
        try {
            await signInWithPopup(auth, provider);
        } catch (error: any) {
            if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user' || error.code === 'auth/internal-error' || error.code === 'auth/network-request-failed' || /popup/i.test(error.message)) {
                try {
                    localStorage.setItem('logbook_awaiting_redirect', 'true');
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

        // Se il marker guest esiste ancora, il fallimento è avvenuto prima del
        // passaggio durevole di owner. Il reload rientra nel bootstrap guest e
        // ripete l'intera migrazione conservando policy e dati.
        if (localStorage.getItem(GUEST_KEY) === 'true') {
            window.location.reload();
            return;
        }

        setGuestMigrationStatus('pending');
        setSyncing(true);
        try {
            const result = await replicateJournal();
            if (result.status === 'synced' || result.status === 'local-pending') {
                setGuestMigrationStatus('idle');
                if (result.status === 'local-pending') {
                    setSaveError('📶 Offline: i dati sono salvati sul dispositivo e verranno sincronizzati quando torni online.');
                }
            } else {
                setGuestMigrationStatus('failed');
                setSaveError('Sincronizzazione account non completata. I dati locali restano conservati. Riprova.');
            }
        } catch (error) {
            console.error('Retry sincronizzazione account non riuscito:', error);
            setGuestMigrationStatus('failed');
            setSaveError('Sincronizzazione account non completata. I dati locali restano conservati. Riprova.');
        } finally {
            setSyncing(false);
        }
    }, [setSaveError, setSyncing]);

    const logoutInFlightRef = useRef(false);

    // Costante per il timeout
    const LOGOUT_SYNC_CHECK_TIMEOUT_MS = 5000;

    // Logout
    const logout = useCallback(async (options?: { mode?: 'normal' | 'force', skipConfirm?: boolean }) => {
        if (logoutInFlightRef.current) return;
        logoutInFlightRef.current = true;

        try {
            const skipConfirm = options?.skipConfirm;
            const mode = options?.mode || 'normal';
            const initialUid = auth.currentUser?.uid;

            // Logout guest: avvisa e poi pulisce il localStorage
            if (isGuestRef.current || localStorage.getItem(GUEST_KEY) === 'true') {
                if (!skipConfirm) {
                    const confirmed = await useDialogStore.getState().showConfirm(
                        "Sei in modalità locale. Se esci, i tuoi dati su questo dispositivo andranno persi definitivamente e non potranno essere recuperati.\n\nSei sicuro di voler continuare?"
                    );
                    if (!confirmed) return;
                }

                useAppStore.getState().cancelPendingSyncs();
                await DB.purgeAllLocalUserData(); // [SEC-02]

                localStorage.removeItem(GUEST_KEY);
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

                if (!isSafe) {
                    try {
                        const { waitForPendingWrites } = await import('firebase/firestore');
                        const { getDb } = await import('../lib/firebase');

                        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), LOGOUT_SYNC_CHECK_TIMEOUT_MS));
                        await Promise.race([waitForPendingWrites(getDb()), timeoutPromise]);
                    } catch (e) {
                        // Timeout o rete disconnessa
                    }

                    // Verifica se l'utente è cambiato nel frattempo
                    if (auth.currentUser?.uid !== initialUid) {
                        setSyncing(false);
                        return;
                    }

                    const finalState = useAppStore.getState();
                    isSafe = finalState.syncHealth === 'synced' && !finalState.userData?.pendingConflicts;
                }
                setSyncing(false);

                if (!isSafe) {
                    const finalState = useAppStore.getState();
                    let reason: 'conflict' | 'offline' | 'rejected' | 'failed' = 'offline';

                    if (finalState.userData?.pendingConflicts) {
                        reason = 'conflict';
                    } else if (finalState.syncHealth === 'rejected') {
                        reason = 'rejected';
                    } else if (finalState.syncHealth === 'failed') {
                        reason = 'failed';
                    }

                    // Mostra il dialog bloccante (resta aperto finché l'utente non sceglie Cancel o Force-Exit)
                    const action = await useDialogStore.getState().showUnsyncedDataLogout(reason);

                    // Verifica di nuovo utente
                    if (auth.currentUser?.uid !== initialUid) {
                        return;
                    }

                    if (action === 'export') {
                        const { Exporter } = await import('../lib/export');
                        const currentState = useAppStore.getState().userData;
                        if (currentState) {
                            Exporter.exportEmergencyJSON(currentState);
                        }
                        return; // Annulla il logout per permettere all'utente di verificare il file
                    }

                    if (action === 'cancel' || action === 'wait') {
                        return; // Annulla o attende e interrompe il flusso qui (la logica vive in GlobalDialog per 'force-exit')
                    } else if (action === 'safe-exit') {
                        // Ulteriore doppio controllo di sicurezza
                        const finalCheck = useAppStore.getState();
                        if (finalCheck.syncHealth !== 'synced' || finalCheck.userData?.pendingConflicts) {
                            return; // Se in realtà non era sicuro, interrompi
                        }
                    }
                    // Se action === 'force-exit', o superato il safe-exit, prosegui
                }
            }

            // Esecuzione force o normal-safe
            setSyncing(true);
            try {
                useAppStore.getState().cancelPendingSyncs();
                await DB.secureLogOut();
                DB.resetCache();
                useAppStore.getState().resetStore({ force: true });
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
