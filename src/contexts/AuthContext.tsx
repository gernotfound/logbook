import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { auth, db, waitForPendingWrites, provider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged } from '../lib/firebase';
import { DB } from '../lib/db';
import { useAppStore } from '../store/useAppStore';
import { AuthContext } from './AuthContextDef';
import { useDialogStore } from '../store/useDialogStore';

const GUEST_KEY = 'logbook_is_guest';

const defaultUserData = {
    profile: {},
    library: [],
    routines: [],
    history: [],
    nutrition: {},
    customFoods: [],
    activeWorkout: null,
    trainingCycles: [],
    activeCycleId: null,
    nutritionPlanning: {
        weight: 80, carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0,
        lockedMacro: null, chartPeriod: 7,
        normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
    }
};

export const AuthProvider = ({ children }: { children: any }) => {
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // isGuest è gestito con un ref (per uso nei callback) + state (per re-render)
    const isGuestRef = useRef(localStorage.getItem(GUEST_KEY) === 'true');
    const [isGuest, setIsGuest] = useState(isGuestRef.current);

    // Dati da migrare da guest a Google al momento del link
    const migrationDataRef = useRef<any>(null);

    const setUserData = useAppStore(state => state.setUserData);
    const setSyncing = useAppStore(state => state.setSyncing);
    const saveError = useAppStore(state => state.saveError);
    const setSaveError = useAppStore(state => state.setSaveError);

    const loadData = useCallback(async (user: any) => {
        if (!user) return;
        const currentData = useAppStore.getState().userData;
        if (!currentData) {
            setSyncing(true);
        }
        try {
            const data = await DB.loadUserData();
            if (data && data !== currentData) {
                setUserData(data);
            }
        } catch (error: any) {
            console.warn("Errore caricamento dati in AuthContext (uso dati locali/offline):", error);
            if (error?.code === 'unavailable' || !navigator.onLine) {
                setSaveError("📶 Offline: visualizzando dati locali. I dati verranno sincronizzati al ripristino della connessione.");
            }
        } finally {
            setSyncing(false);
        }
    }, [setSyncing, setUserData, setSaveError]);

    useEffect(() => {
        let isMounted = true;

        getRedirectResult(auth).catch(err => {
            console.warn("getRedirectResult error (non critico):", err);
        });

        const unsubscribe = onAuthStateChanged(auth, async (user: any) => {
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
                        
                        const cloudHasData = cloudData && (
                            (cloudData.history && cloudData.history.length > 0) ||
                            (cloudData.routines && cloudData.routines.length > 0) ||
                            (cloudData.library && cloudData.library.length > 0)
                        );
                        
                        const guestHasData = guestData && (
                            (guestData.history && guestData.history.length > 0) ||
                            (guestData.routines && guestData.routines.length > 0) ||
                            (guestData.library && guestData.library.length > 0)
                        );

                        if (cloudHasData && !guestHasData) {
                            // Se il cloud ha già dati e il guest era vuoto, adotta i dati del cloud
                            setUserData(cloudData);
                        } else if (guestHasData) {
                            // Se il guest ha dati creati, salva sul cloud con eventuale merge
                            let mergedData = guestData;
                            if (cloudHasData && cloudData) {
                                const combinedHistory = [...(guestData.history || []), ...(cloudData.history || [])];
                                const uniqueHistory = Array.from(new Map(combinedHistory.map((h: any) => [h.id, h])).values());
                                mergedData = {
                                    ...cloudData,
                                    ...guestData,
                                    history: uniqueHistory
                                };
                            }
                            await DB.saveUserData(mergedData);
                            setUserData(mergedData);
                        } else {
                            setUserData(cloudData || defaultUserData as any);
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
                if (!isGuestRef.current && localStorage.getItem(GUEST_KEY) !== 'true') {
                    DB.resetCache();
                    useAppStore.getState().resetStore();
                }
                // Se guest: i dati rimangono nel localStorage, non tocchiamo nulla
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
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [loadData, setSyncing, setUserData]);

    // Login con Google (dalla schermata di login, nessun guest precedente)
    const login = useCallback(async () => {
        setSaveError(null);
        try {
            await signInWithPopup(auth, provider);
        } catch (error: any) {
            if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
                try {
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
    const loginAsGuest = useCallback(() => {
        localStorage.setItem(GUEST_KEY, 'true');
        isGuestRef.current = true;
        setIsGuest(true);
        // Se non ci sono dati precedenti in localStorage, inizializza con i default
        if (!useAppStore.getState().userData) {
            setUserData(defaultUserData as any);
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
            if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
                try {
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

    const getErrorDisplay = (error: string) => {
        if (error.startsWith('📶')) return { icon: '', text: error.replace('📶 ', ''), bg: '#0ea5e9' };
        if (error.includes('quota') || error.includes('resource-exhausted')) return { icon: '⚠️', text: 'Limite Firebase raggiunto. Riprova tra qualche minuto.', bg: '#f97316' };
        if (error.includes('auth') || error.includes('sessione') || error.includes('permission')) return { icon: '🔒', text: 'Sessione scaduta. Rieffettua il login.', bg: '#8b5cf6' };
        return { icon: '⚠️', text: error, bg: '#ef4444' };
    };

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
            {saveError && (() => {
                const { icon, text, bg } = getErrorDisplay(saveError);
                return (
                    <div style={{
                        position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
                        background: bg, color: '#fff', padding: '10px 20px', borderRadius: '8px',
                        fontSize: '0.85rem', zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                        display: 'flex', alignItems: 'center', gap: '10px',
                        maxWidth: 'calc(100vw - 40px)', textAlign: 'center'
                    }}>
                        {icon} {text}
                        <button onClick={() => setSaveError(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 'bold', flexShrink: 0 }}>✕</button>
                    </div>
                );
            })()}
        </AuthContext.Provider>
    );
};
