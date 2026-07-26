import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Exporter } from '../lib/export';
import { DB } from '../lib/db';

export function useSettings() {
    const { userData, saveUserData, currentUser, logout } = useAuth();
    
    // Fallback in case userData isn't loaded yet
    const profile = userData?.profile || { dob: '', height: '', gender: '' };

    const [dob, setDob] = useState(profile.dob || '');
    const [height, setHeight] = useState(profile.height || '');
    const [gender, setGender] = useState(profile.gender || '');
    const [deletingAccount, setDeletingAccount] = useState(false);

    const handleSaveProfile = () => {
        const newProfile = { dob, height, gender };
        saveUserData({ ...userData, profile: newProfile });
        alert("Profilo aggiornato!");
    };

    const handleExport = () => {
        if(userData) {
            Exporter.exportToCSV(userData.history || [], userData.nutrition || {});
        }
    };

    const handleDeleteAccount = async () => {
        if (!confirm("⚠️ ATTENZIONE: questa operazione è IRREVERSIBILE.\n\nVerranno eliminati TUTTI i tuoi dati (allenamenti, nutrizione, misurazioni).\n\nConfermi di voler eliminare il tuo account?")) return;
        if (!confirm("Ultima conferma: eliminare definitivamente il tuo account LogBook?")) return;
        
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
        currentUser, logout,
        dob, setDob,
        height, setHeight,
        gender, setGender,
        deletingAccount,
        handleSaveProfile, handleExport, handleDeleteAccount
    };
}
