import { useState } from 'react';
import { useAuth } from './useAuth';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Exporter } from '../lib/export';
import { DB } from '../lib/db';

export function useSettings() {
    const { currentUser, logout } = useAuth();
    const userData = useAppStore(state => state.userData);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    
    const storeProfile = userData?.profile;
    const [localProfile, setLocalProfile] = useState<any>(null);
    const profile = localProfile ?? storeProfile ?? { dob: '', height: '', gender: '' };

    const handleLogout = async () => {
        if (await showConfirm("Sei sicuro di voler uscire dal tuo account?")) {
            logout();
        }
    };

    const dob = profile.dob || '';
    const height = profile.height || '';
    const gender = profile.gender || '';
    
    const setDob = (val: string) => setLocalProfile({ ...profile, dob: val });
    const setHeight = (val: string) => setLocalProfile({ ...profile, height: val });
    const setGender = (val: string) => setLocalProfile({ ...profile, gender: val });
    const [deletingAccount, setDeletingAccount] = useState(false);

    const handleSaveProfile = async () => {
        const newProfile = { dob, height, gender };
        try {
            await saveUserData({ ...userData, profile: newProfile });
            setLocalProfile(null);
            await showAlert("Profilo aggiornato!");
        } catch (error) {
            await showAlert("Errore durante il salvataggio del profilo.");
        }
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
