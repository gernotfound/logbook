import { useState, useEffect, useCallback, useMemo } from 'react';
import { auth, db, waitForPendingWrites, provider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged } from '../lib/firebase';
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
        setSyncing(true);
        try {
            const data = await DB.loadUserData();
            setUserData(data);
        } catch (error: any) {
            console.error("Errore caricamento dati in AuthContext:", error);
            // Se offline, Firestore serve i dati dalla cache locale — non è un errore critico
            if (error?.code === 'unavailable' || !navigator.onLine) {
                setSaveError("📶 Offline: visualizzando dati locali. I dati verranno sincronizzati al ripristino della connessione.");
            }
        } finally {
            setSyncing(false);
        }
    }, [setSyncing, setUserData, setSaveError]);

    useEffect(() => {
        let isMounted = true;
        
        const initAuth = async () => {
            try {
                await getRedirectResult(auth);
            } catch (err) {
                console.warn("getRedirectResult error (non critico):", err);
            }
            
            const unsubscribe = onAuthStateChanged(auth, async (user: any) => {
                if (!isMounted) return;
                setCurrentUser(user);
                if (user) {
                    await loadData(user);
                } else {
                    DB.resetCache();
                    useAppStore.getState().resetStore();
                }
                setLoading(false);
            });
            
            return unsubscribe;
        };

        const authUnsubPromise = initAuth();

        // PWA FIX: Re-sync data when app comes back into focus (e.g. user switches tabs)
        let isReloading = false;
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible' && auth.currentUser) {
                // Only re-sync if we already have data (avoid loading state on first open)
                if (useAppStore.getState().userData !== null && !useAppStore.getState().syncing && !isReloading) {
                    try {
                        isReloading = true;
                        await waitForPendingWrites(db);
                        await loadData(auth.currentUser);
                    } catch (e) {
                        console.warn("Skipping visibility reload due to pending writes", e);
                    } finally {
                        isReloading = false;
                    }
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            isMounted = false;
            authUnsubPromise.then(unsub => unsub && unsub()).catch(e => console.warn(e));
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

    const logout = useCallback(async () => {
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

    const value = useMemo(() => ({
        currentUser,
        loading,
        login,
        logout
    }), [currentUser, loading, login, logout]);

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
