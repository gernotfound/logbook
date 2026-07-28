import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Exporter } from '../lib/export';
import { DB } from '../lib/db';

export function useSettings() {
    const { currentUser, logout } = useAuth();
    const { userData, saveUserData } = useAppStore();
    const { showAlert, showConfirm } = useDialogStore();
    
    // Fallback in case userData isn't loaded yet
    const profile = userData?.profile || { dob: '', height: '', gender: '' };

    const handleLogout = async () => {
        if (await showConfirm("Sei sicuro di voler uscire dal tuo account?")) {
            logout();
        }
    };

    const [dob, setDob] = useState(profile.dob || '');
    const [height, setHeight] = useState(profile.height || '');
    const [gender, setGender] = useState(profile.gender || '');
    const [deletingAccount, setDeletingAccount] = useState(false);

    useEffect(() => {
        if (userData?.profile) {
            if (userData.profile.dob !== undefined) setDob(userData.profile.dob || '');
            if (userData.profile.height !== undefined) setHeight(userData.profile.height || '');
            if (userData.profile.gender !== undefined) setGender(userData.profile.gender || '');
        }
    }, [userData?.profile]);

    const handleSaveProfile = async () => {
        const newProfile = { dob, height, gender };
        saveUserData({ ...userData, profile: newProfile });
        await showAlert("Profilo aggiornato!");
    };

    const handleExport = () => {
        if(userData) {
            Exporter.exportToCSV(userData.history || [], userData.nutrition || {});
        }
    };

    const handleDeleteAccount = async () => {
        if (!(await showConfirm("⚠️ ATTENZIONE: questa operazione è IRREVERSIBILE.\n\nVerranno eliminati TUTTI i tuoi dati (allenamenti, nutrizione, misurazioni).\n\nConfermi di voler eliminare il tuo account?"))) return;
        if (!(await showConfirm("Ultima conferma: eliminare definitivamente il tuo account LogBook?"))) return;
        
        setDeletingAccount(true);
        try {
            await DB.deleteAccount();
            // logout handled by onAuthStateChanged
        } catch (error) {
            setDeletingAccount(false);
            console.error("Errore eliminazione account:", error);
        }
    };

    return {
        currentUser, handleLogout,
        dob, setDob,
        height, setHeight,
        gender, setGender,
        deletingAccount,
        handleSaveProfile, handleExport, handleDeleteAccount
    };
}
