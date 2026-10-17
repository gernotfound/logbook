import { useState } from 'react';
import { dispatchDurableOperation } from '../lib/sync/dispatchDurableOperation';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';

export function useSettingsProfile() {
    const storeProfile = useAppStore(state => state.userData?.profile);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const [localProfile, setLocalProfile] = useState<{ dob?: string; height?: string; gender?: string } | null>(null);
    const profile = localProfile ?? storeProfile ?? { dob: '', height: '', gender: '' };

    const dob = profile.dob || '';
    const height = profile.height || '';
    const gender = profile.gender || '';

    const setDob = (val: string) => setLocalProfile({ ...profile, dob: val });
    const setHeight = (val: string) => setLocalProfile({ ...profile, height: val });
    const setGender = (val: string) => setLocalProfile({ ...profile, gender: val });
    const handleSaveProfile = async (e?: { preventDefault: () => void }) => {
        if (e) e.preventDefault();
        const newProfile = { dob, height, gender };
        try {
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'profile.patch', patch: newProfile });
            setLocalProfile(null);
        } catch {
            await showAlert("Errore durante il salvataggio del profilo.");
        }
    };

    return { dob, setDob, height, setHeight, gender, setGender, handleSaveProfile };
}
