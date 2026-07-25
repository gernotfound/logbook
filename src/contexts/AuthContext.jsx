import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, provider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged } from '../lib/firebase';
import { DB } from '../lib/db';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(null);
    const [userData, setUserData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setCurrentUser(user);
            if (user) {
                setSyncing(true);
                try {
                    const data = await DB.loadUserData();
                    setUserData(data);
                } catch (error) {
                    console.error("Errore caricamento dati in AuthContext:", error);
                }
                setSyncing(false);
            } else {
                setUserData(null);
            }
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    const login = async () => {
        try {
            // Using popup for web, could fallback to redirect on mobile if needed.
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Errore di login", error);
        }
    };

    const logout = async () => {
        setSyncing(true);
        try {
            await DB.secureLogOut();
        } catch (error) {
            console.error("Errore in logout", error);
        }
        setSyncing(false);
    };
    
    const saveUserData = async (newData) => {
        setUserData(newData);
        await DB.saveUserData(newData);
    };

    const value = {
        currentUser,
        userData,
        loading,
        syncing,
        login,
        logout,
        saveUserData
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
