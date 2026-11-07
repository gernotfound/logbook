import { useRef, useState } from 'react';
import { dispatchDurableOperation } from '../lib/sync/dispatchDurableOperation';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';

export function useSettingsProfile() {
    const storeProfile = useAppStore(state => state.userData?.profile);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const [localProfile, setLocalProfile] = useState<{ dob?: string; height?: string; gender?: string } | null>(null);
    const draftRevision = useRef(0);
    const profile = localProfile ?? storeProfile ?? { dob: '', height: '', gender: '' };

    const dob = profile.dob || '';
    const height = profile.height || '';
    const gender = profile.gender || '';

    const setDob = (val: string) => {
        draftRevision.current++;
        setLocalProfile(previous => ({ ...(previous ?? storeProfile), dob: val }));
    };
    const setHeight = (val: string) => {
        draftRevision.current++;
        setLocalProfile(previous => ({ ...(previous ?? storeProfile), height: val }));
    };
    const setGender = (val: string) => {
        draftRevision.current++;
        setLocalProfile(previous => ({ ...(previous ?? storeProfile), gender: val }));
    };
    const handleSaveProfile = async (e?: { preventDefault: () => void }) => {
        if (e) e.preventDefault();
        const newProfile = { dob, height, gender };
        const revisionAtSubmit = draftRevision.current;
        let session: ReturnType<typeof captureSession> | null = null;
        try {
            session = captureSession();
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'profile.patch', patch: newProfile });
            if (isCurrentSession(session) && draftRevision.current === revisionAtSubmit) {
                setLocalProfile(null);
            }
        } catch {
            if (!session || isCurrentSession(session)) {
                await showAlert("Errore durante il salvataggio del profilo.");
            }
        }
    };

    return { dob, setDob, height, setHeight, gender, setGender, handleSaveProfile };
}
