import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, provider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from '../lib/firebase';
import { DB } from '../lib/db';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(null);
    const [userData, setUserData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [saveError, setSaveError] = useState(null);

    const loadData = async (user) => {
        if (!user) return;
        setSyncing(true);
        try {
            const data = await DB.loadUserData();
            setUserData(data);
        } catch (error) {
            console.error("Errore caricamento dati in AuthContext:", error);
        } finally {
            setSyncing(false);
        }
    };

    useEffect(() => {
        // Handle redirect result first (for mobile browsers that used redirect login)
        getRedirectResult(auth).catch(err => {
            console.warn("getRedirectResult error (non critico):", err);
        });

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setCurrentUser(user);
            if (user) {
                await loadData(user);
            } else {
                setUserData(null);
            }
            setLoading(false);
        });

        // PWA FIX: Re-sync data when app comes back into focus (e.g. user switches tabs)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && auth.currentUser) {
                // Only re-sync if we already have data (avoid loading state on first open)
                if (userData !== null) {
                    loadData(auth.currentUser);
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            unsubscribe();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const login = async () => {
        setSaveError(null);
        try {
            // Try popup first; on mobile it often fails → fall back to redirect
            await signInWithPopup(auth, provider);
        } catch (error) {
            if (error.code === 'auth/popup-blocked' || 
                error.code === 'auth/popup-closed-by-user' ||
                error.code === 'auth/cancelled-popup-request') {
                // Mobile / popup blocked → use redirect flow
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
    };

    const logout = async () => {
        setSyncing(true);
        try {
            await DB.secureLogOut();
            setUserData(null);
        } catch (error) {
            console.error("Errore in logout", error);
        } finally {
            setSyncing(false);
        }
    };
    
    const saveUserData = async (newData) => {
        // Optimistic update — set state first for snappy UI
        setUserData(newData);
        setSaveError(null);
        try {
            await DB.saveUserData(newData);
        } catch (error) {
            console.error("Errore durante il salvataggio:", error);
            // On save failure, show a non-blocking error
            setSaveError("Errore sincronizzazione. Verifica la connessione.");
        }
    };

    const value = {
        currentUser,
        userData,
        loading,
        syncing,
        saveError,
        login,
        logout,
        saveUserData,
        setUserData // Expose for edge cases
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
            {/* Non-blocking save error toast */}
            {saveError && (
                <div style={{
                    position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
                    background: '#ef4444', color: '#fff', padding: '10px 20px', borderRadius: '8px',
                    fontSize: '0.85rem', zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                    display: 'flex', alignItems: 'center', gap: '10px'
                }}>
                    ⚠️ {saveError}
                    <button onClick={() => setSaveError(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
                </div>
            )}
        </AuthContext.Provider>
    );
};
