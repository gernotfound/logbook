import { useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';
import { User } from 'firebase/auth';
import { auth, getDb, waitForPendingWrites, provider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from '../lib/firebase';
import { DB } from '../lib/db';
import { useAppStore } from '../store/useAppStore';
import { UserData } from '../types';
import { UserDataSchema } from '../lib/schema';
import { mergeUserData, hasUserData } from '../lib/merge';
import { AuthContext } from './AuthContextDef';
import { useDialogStore } from '../store/useDialogStore';
import { getCachedCatalog, getInMemoryCatalog, isCatalogInMemory } from '../lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../lib/catalog/deltaResolver';
import { createDefaultNutritionPlanning } from '../lib/nutritionDefaults';
import { draftRegistry } from '../lib/utils/draftRegistry';
import { replicateJournal } from '../lib/sync/replicateJournal';

// Imports for default data removed

const GUEST_KEY = 'logbook_is_guest';

const defaultUserData: UserData = {
    profile: {},
    library: [],
    routines: [],
    history: [],
    nutrition: {},
    customFoods: [],
    catalogOverrides: {},
    activeWorkout: null,
    trainingCycles: [],
    activeCycleId: null,
    nutritionPlanning: createDefaultNutritionPlanning(),
    nutritionPlanningOrigin: 'generated-default',
    supplements: [],
    activePains: [],
    legalConsent: undefined
};

const getResolvedDefaultUserData = (catalog = getInMemoryCatalog()): UserData => ({
    ...defaultUserData,
    library: resolveEffectiveExercises(catalog.exercises, [], {}),
    customFoods: resolveEffectiveFoods(catalog.foods, [], {}),
    catalogOverrides: {
        exercises: {},
        foods: {},
        hiddenExerciseIds: [],
        hiddenFoodIds: []
    }
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    // isGuest è gestito con un ref (per uso nei callback) + state (per re-render)
    const isGuestRef = useRef(localStorage.getItem(GUEST_KEY) === 'true');
    const [isGuest, setIsGuest] = useState(isGuestRef.current);

    // Dati da migrare da guest a Google al momento del link
    const migrationDataRef = useRef<UserData | null>(null);

    const setUserData = useAppStore(state => state.setUserData);
    const setSyncing = useAppStore(state => state.setSyncing);
    const setSaveError = useAppStore(state => state.setSaveError);

    const loadData = useCallback(async (user: User) => {
        if (!user) return;
        const currentData = useAppStore.getState().userData;
        if (!currentData) {
            setSyncing(true);
        }
        try {
            const payload = await DB.loadCloudPayload();

            // Protezione semantica: scarta l'hydration se nel frattempo l'utente è cambiato
            // o se l'app è passata in modalità Guest (previene race condition tra loadData e loginAsGuest)
            const isNowGuest = isGuestRef.current || localStorage.getItem(GUEST_KEY) === 'true';
            if (auth.currentUser?.uid !== user.uid || isNowGuest) {
                return;
            }

            if (payload) {
                const cloudData = payload.data;
                try {
                    const { hydrateLocal } = await import('../lib/sync/localRepository');
                    const owner = user.uid;
                    const hydratedEnv = await hydrateLocal(owner, cloudData, payload.completeMonths, payload.cloudDocuments);
                    setUserData(hydratedEnv.data); // Aggiorna IndexedDB ma NON innesca DB.saveUserData
                } catch (mergeError) {
                    console.error("Zod parse failed during hydration merge, preserving local valid state:", mergeError);
                    // Fallback Zod: NON chiamiamo setUserData, mantenendo lo stato locale valido
                }
            }
        } catch (error: any) {
            console.warn("Errore caricamento dati in AuthContext (uso dati locali/offline):", error);
            if (error?.code === 'unavailable' || !navigator.onLine) {
                setSaveError("📶 Offline: visualizzando dati locali. I dati verranno sincronizzati al ripristino della connessione.");
            }
            // Prevenzione loop di caricamento: se non c'è alcuno stato locale e il cloud fallisce,
            // carichiamo i dati di default per permettere l'avvio dell'app.
            const latestData = useAppStore.getState().userData;
            if (!latestData) {
                const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
                const fallbackData = getResolvedDefaultUserData(catalog);
                setUserData(UserDataSchema.parse(fallbackData) as unknown as UserData);
            }
        } finally {
            setSyncing(false);
        }
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
                    // Rimuove subito il flag guest
                    localStorage.removeItem(GUEST_KEY);
                    isGuestRef.current = false;
                    setIsGuest(false);

                    draftRegistry.flushAll();

                    const guestData = migrationDataRef.current || useAppStore.getState().userData;
                    migrationDataRef.current = null;

                    const policy = localStorage.getItem('guest_migration_policy') || 'merge';
                    localStorage.removeItem('guest_migration_policy');

                    if (policy === 'skip') {
                        useAppStore.getState().setLocalWorkout(null);
                    }

                    try {
                        setSyncing(true);
                        // Carica i dati esistenti sul cloud (completi di tutto lo storico pluriennale)
                        const cloudPayload = await DB.loadCloudPayload({ allMonths: true });
                        const cloudData = cloudPayload?.data || null;

                        const cloudHasData = hasUserData(cloudData);
                        const guestHasData = hasUserData(guestData);

                        if (policy === 'skip') {
                            if (cloudHasData) {
                                const { hydrateLocal } = await import('../lib/sync/localRepository');
                                const owner = user.uid;
                                const hydratedEnv = await hydrateLocal(owner, cloudData!, cloudPayload!.completeMonths, cloudPayload!.cloudDocuments, 'all');
                                setUserData(hydratedEnv.data);
                                useAppStore.getState().setLocalWorkout(hydratedEnv.data.activeWorkout || null);
                            } else {
                                const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
                                const fallbackData = getResolvedDefaultUserData(catalog);
                                const parsedFallback = UserDataSchema.parse(fallbackData) as unknown as UserData;
                                const { hydrateLocal } = await import('../lib/sync/localRepository');
                                const hydratedEnv = await hydrateLocal(user.uid, cloudData || parsedFallback, cloudPayload?.completeMonths || [], cloudPayload?.cloudDocuments, 'all');
                                setUserData(hydratedEnv.data);
                                useAppStore.getState().setLocalWorkout(null);
                            }
                        } else {
                            if (cloudHasData && !guestHasData) {
                                const { hydrateLocal } = await import('../lib/sync/localRepository');
                                const hydratedEnv = await hydrateLocal(user.uid, cloudData!, cloudPayload!.completeMonths, cloudPayload!.cloudDocuments, 'all');
                                setUserData(hydratedEnv.data);
                                useAppStore.getState().setLocalWorkout(hydratedEnv.data.activeWorkout || null);
                            } else if (guestHasData) {
                                const { hydrateLocal, commitLocal, readLocal } = await import('../lib/sync/localRepository');
                                const hydratedEnv = await hydrateLocal(user.uid, cloudData!, cloudPayload!.completeMonths, cloudPayload!.cloudDocuments, 'all');
                                const mergedData = mergeUserData(hydratedEnv.data, guestData);
                                await commitLocal(user.uid, mergedData, hydratedEnv.data);

                                const syncResult = await replicateJournal();
                                if (syncResult.status === 'rejected' || syncResult.status === 'failed') {
                                    throw syncResult.error instanceof Error
                                        ? syncResult.error
                                        : new Error('Sincronizzazione della migrazione guest non riuscita', { cause: syncResult.error });
                                }

                                if (syncResult.status === 'local-pending') {
                                    const pendingEnv = await readLocal(user.uid);
                                    const pendingData = pendingEnv?.data ?? mergedData;
                                    setUserData(pendingData);
                                    useAppStore.getState().setLocalWorkout(pendingData.activeWorkout || null);
                                } else {
                                    const resolvedPayload = await DB.loadCloudPayload();
                                    const resolvedData = resolvedPayload?.data || mergedData;
                                    const hydratedFinal = await hydrateLocal(user.uid, resolvedData, resolvedPayload?.completeMonths || [], resolvedPayload?.cloudDocuments);
                                    setUserData(hydratedFinal.data);
                                    useAppStore.getState().setLocalWorkout(hydratedFinal.data.activeWorkout || null);
                                }
                            } else {
                                const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
                                const fallbackData = getResolvedDefaultUserData(catalog);
                                const parsedFallback = UserDataSchema.parse(fallbackData) as unknown as UserData;
                                const { hydrateLocal } = await import('../lib/sync/localRepository');
                                const hydratedEnv = await hydrateLocal(user.uid, cloudData || parsedFallback, cloudPayload?.completeMonths || [], cloudPayload?.cloudDocuments, 'all');
                                setUserData(hydratedEnv.data);
                                useAppStore.getState().setLocalWorkout(hydratedEnv.data.activeWorkout || null);
                            }
                        }
                    } catch (e) {
                        console.warn("Errore sincronizzazione iniziale post-link:", e);
                        try {
                            const { readLocal } = await import('../lib/sync/localRepository');
                            const preserved = await readLocal(user.uid);
                            if (preserved) {
                                setUserData(preserved.data);
                                useAppStore.getState().setLocalWorkout(preserved.data.activeWorkout || null);
                            } else if (guestData) {
                                setUserData(guestData);
                                useAppStore.getState().setLocalWorkout(guestData.activeWorkout || null);
                            }
                        } catch {
                            if (guestData) {
                                setUserData(guestData);
                                useAppStore.getState().setLocalWorkout(guestData.activeWorkout || null);
                            }
                        }
                    } finally {
                        setSyncing(false);
                    }
                } else {
                    // Login normale con Google
                    loadData(user);
                }
            } else {
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
    }, [loadData, setSyncing, setUserData]);

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
                useAppStore.getState().resetStore();
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
                useAppStore.getState().resetStore();
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
        login,
        loginAsGuest,
        linkGoogleAccount,
        logout,
        loginWithEmail,
        registerWithEmail
    }), [currentUser, loading, isGuest, login, loginAsGuest, linkGoogleAccount, logout, loginWithEmail, registerWithEmail]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
