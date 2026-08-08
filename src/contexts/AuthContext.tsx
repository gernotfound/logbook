import { useState, useEffect, useCallback, useMemo } from 'react';
import { auth, db, waitForPendingWrites, provider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signInAnonymously, linkWithPopup } from '../lib/firebase';
import { DB } from '../lib/db';
import { useAppStore } from '../store/useAppStore';
import { AuthContext } from './AuthContextDef';
import { useDialogStore } from '../store/useDialogStore';

export const AuthProvider = ({ children }: { children: any }) => {
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    
    const setUserData = useAppStore(state => state.setUserData);
    const setSyncing = useAppStore(state => state.setSyncing);
    const saveError = useAppStore(state => state.saveError);
    const setSaveError = useAppStore(state => state.setSaveError);

    // useCallback: dipendenze stabili (selector Zustand), evita closure stale nel listener visibilitychange
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
            // Se offline o timeout, Firestore serve i dati dalla cache locale — non è un errore critico
            if (error?.code === 'unavailable' || !navigator.onLine) {
                setSaveError("📶 Offline: visualizzando dati locali. I dati verranno sincronizzati al ripristino della connessione.");
            }
        } finally {
            setSyncing(false);
        }
    }, [setSyncing, setUserData, setSaveError]);

    useEffect(() => {
        let isMounted = true;
        
        // 1. NON-BLOCKING: Gestisci il risultato del redirect in background senza bloccare il listener di stato
        getRedirectResult(auth).catch(err => {
            console.warn("getRedirectResult error (non critico):", err);
        });
        
        // 2. IMMEDIATE: Registra il listener auth immediatamente
        const unsubscribe = onAuthStateChanged(auth, (user: any) => {
            if (!isMounted) return;
            setCurrentUser(user);
            
            // Sblocca immediatamente la schermata di login/app senza attendere query di rete
            setLoading(false);

            if (user) {
                // Carica i dati dal cloud in background
                loadData(user);
            } else {
                DB.resetCache();
                useAppStore.getState().resetStore();
            }
        });

        // 3. Fallback di sicurezza: se WebKit su iOS dovesse avere un ritardo di inizializzazione,
        // garantisci che la schermata di caricamento non rimanga bloccata all'infinito.
        const safetyTimer = setTimeout(() => {
            if (isMounted) {
                setLoading(false);
            }
        }, 3000);

        // PWA FIX: Re-sync data when app comes back into focus (e.g. user switches tabs)
        let isReloading = false;
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible' && auth.currentUser) {
                // Only re-sync if we already have data (avoid loading state on first open)
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
    }, [loadData]); // loadData è stabile grazie a useCallback

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

    const loginAnonymously = useCallback(async () => {
        setSaveError(null);
        try {
            await signInAnonymously(auth);
        } catch (error: any) {
            console.error("Errore login anonimo:", error);
            setSaveError("Errore di accesso. Riprova.");
        }
    }, [setSaveError]);

    const linkGoogleAccount = useCallback(async () => {
        setSaveError(null);
        const user = auth.currentUser;
        if (!user) return;
        try {
            await linkWithPopup(user, provider);
        } catch (error: any) {
            if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
                // Ignorato silenziosamente — utente ha chiuso il popup
                return;
            }
            if (error.code === 'auth/credential-already-in-use') {
                setSaveError("Questo account Google è già registrato. Esci e accedi direttamente con Google per recuperare i tuoi dati.");
                return;
            }
            console.error("Errore collegamento account Google:", error);
            setSaveError("Collegamento fallito. Riprova.");
        }
    }, [setSaveError]);

    const logout = useCallback(async () => {
        // Se utente anonimo, avvisare che i dati locali andranno persi
        if (auth.currentUser?.isAnonymous) {
            const confirmed = await useDialogStore.getState().showConfirm(
                "Sei in modalità locale. Se esci, i tuoi dati su questo dispositivo andranno persi definitivamente e non potranno essere recuperati.\n\nSei sicuro di voler continuare?"
            );
            if (!confirmed) return;
        }
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

    // Determina l'icona e il testo del toast in base al tipo di errore
    const getErrorDisplay = (error: string) => {
        if (error.startsWith('📶')) return { icon: '', text: error.replace('📶 ', ''), bg: '#0ea5e9' };
        if (error.includes('quota') || error.includes('resource-exhausted')) return { icon: '⚠️', text: 'Limite Firebase raggiunto. Riprova tra qualche minuto.', bg: '#f97316' };
        if (error.includes('auth') || error.includes('sessione') || error.includes('permission')) return { icon: '🔒', text: 'Sessione scaduta. Rieffettua il login.', bg: '#8b5cf6' };
        return { icon: '⚠️', text: error, bg: '#ef4444' };
    };

    const isAnonymous = currentUser?.isAnonymous === true;

    const value = useMemo(() => ({
        currentUser,
        loading,
        isAnonymous,
        login,
        loginAnonymously,
        linkGoogleAccount,
        logout
    }), [currentUser, loading, isAnonymous, login, loginAnonymously, linkGoogleAccount, logout]);

    return (
        <AuthContext.Provider value={value}>
            {children}
            {/* Non-blocking save error toast con messaggi contestuali */}
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
