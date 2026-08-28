import { useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';
import { User } from 'firebase/auth';
import { auth, db, waitForPendingWrites, provider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged } from '../lib/firebase';
import { DB } from '../lib/db';
import { useAppStore } from '../store/useAppStore';
import { UserData } from '../types';
import { UserDataSchema } from '../lib/schema';
import { mergeUserData, hasUserData } from '../lib/merge';
import { AuthContext } from './AuthContextDef';
import { useDialogStore } from '../store/useDialogStore';
import { getCachedCatalog, getInMemoryCatalog, isCatalogInMemory } from '../lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../lib/catalog/deltaResolver';

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
    nutritionPlanning: {
        weight: 80, carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0,
        lockedMacro: null, chartPeriod: 7,
        normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
    },
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
        const isSyncing = useAppStore.getState().syncing;
        if (!currentData) {
            setSyncing(true);
        }
        try {
            const cloudData = await DB.loadUserData();
            if (cloudData && cloudData !== currentData) {
                const latestData = useAppStore.getState().userData;
                const isCurrentlySyncing = isSyncing || useAppStore.getState().syncing;
                if (isCurrentlySyncing && latestData) {
                    console.log("Riconciliazione: fusione modifiche locali pendenti con dati cloud.");
                    const merged = mergeUserData(cloudData, latestData);
                    setUserData(merged);
                } else {
                    setUserData(cloudData);
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

                    const guestData = migrationDataRef.current || useAppStore.getState().userData;
                    migrationDataRef.current = null;

                    try {
                        setSyncing(true);
                        // Carica i dati esistenti sul cloud (se presenti)
                        const cloudData = await DB.loadUserData();
                        
                        const cloudHasData = hasUserData(cloudData);
                        const guestHasData = hasUserData(guestData);

                        if (cloudHasData && !guestHasData) {
                            // Se il cloud ha già dati e il guest era vuoto, adotta i dati del cloud
                            setUserData(cloudData!);
                        } else if (guestHasData) {
                            // Se il guest ha dati creati, unisce in modo deterministico con il cloud (se presente)
                            const mergedData = mergeUserData(cloudData, guestData);
                            
                            await DB.saveUserData(mergedData);
                            // Ricarica per avere la risoluzione completa del catalogo globale per le viste
                            const resolvedData = await DB.loadUserData();
                            setUserData(resolvedData || mergedData);
                        } else {
                            const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
                            const fallbackData = getResolvedDefaultUserData(catalog);
                            setUserData(cloudData || (UserDataSchema.parse(fallbackData) as unknown as UserData));
                        }
                    } catch (e) {
                        console.warn("Errore sincronizzazione iniziale post-link:", e);
                        if (guestData) setUserData(guestData);
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
                            waitForPendingWrites(db),
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

    // Logout
    const logout = useCallback(async (skipConfirm?: boolean) => {
        // Logout guest: avvisa e poi pulisce il localStorage
        if (isGuestRef.current || localStorage.getItem(GUEST_KEY) === 'true') {
            if (!skipConfirm) {
                const confirmed = await useDialogStore.getState().showConfirm(
                    "Sei in modalità locale. Se esci, i tuoi dati su questo dispositivo andranno persi definitivamente e non potranno essere recuperati.\n\nSei sicuro di voler continuare?"
                );
                if (!confirmed) return;
            }
            localStorage.removeItem(GUEST_KEY);
            isGuestRef.current = false;
            setIsGuest(false);
            useAppStore.getState().resetStore();
            return;
        }
        // Logout Google normale
        setSyncing(true);
        try {
            await DB.secureLogOut();
            DB.resetCache();
            useAppStore.getState().resetStore();
        } catch (error: any) {
            console.error("Errore durante il logout:", error);
            await useDialogStore.getState().showAlert("Errore durante il logout. Controlla la connessione.");
        } finally {
            setSyncing(false);
        }
    }, [setSyncing]);

    const value = useMemo(() => ({
        currentUser,
        loading,
        isGuest,
        login,
        loginAsGuest,
        linkGoogleAccount,
        logout
    }), [currentUser, loading, isGuest, login, loginAsGuest, linkGoogleAccount, logout]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
