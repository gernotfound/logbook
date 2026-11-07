import { useRef, useState } from 'react';
import { dispatchDurableOperation } from '../lib/sync/dispatchDurableOperation';
import { captureSession, isCurrentSession, type SessionSnapshot } from '../lib/sync/session';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';

export function useSettingsProfile() {
    const storeProfile = useAppStore(state => state.userData?.profile);
    const dataOwner = useAppStore(state => state.dataOwner);
    let visibleOwner: string | null = null;
    try { visibleOwner = captureSession().owner; }
    catch { /* Unreadable ownership must not expose a previous profile. */ }
    const ownedProfile = dataOwner === visibleOwner && visibleOwner !== null ? storeProfile : undefined;
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const [localProfile, setLocalProfile] = useState<{
        session: SessionSnapshot;
        values: { dob?: string; height?: string; gender?: string };
    } | null>(null);
    const draftRevision = useRef(0);
    // A mounted form must not display or submit an old session's uncommitted health data.
    const profile = localProfile && isCurrentSession(localProfile.session) && dataOwner === localProfile.session.owner
        ? localProfile.values : ownedProfile ?? { dob: '', height: '', gender: '' };

    const dob = profile.dob || '';
    const height = profile.height || '';
    const gender = profile.gender || '';

    const updateProfile = (field: 'dob' | 'height' | 'gender', value: string) => {
        const session = captureSession();
        if (dataOwner !== session.owner) return;
        draftRevision.current++;
        setLocalProfile(previous => ({
            session,
            values: {
                ...(previous && isCurrentSession(previous.session) ? previous.values : ownedProfile),
                [field]: value,
            },
        }));
    };
    const setDob = (val: string) => updateProfile('dob', val);
    const setHeight = (val: string) => updateProfile('height', val);
    const setGender = (val: string) => updateProfile('gender', val);
    const handleSaveProfile = async (e?: { preventDefault: () => void }) => {
        if (e) e.preventDefault();
        const newProfile = { dob, height, gender };
        const revisionAtSubmit = draftRevision.current;
        let session: ReturnType<typeof captureSession> | null = null;
        try {
            session = captureSession();
            if (useAppStore.getState().dataOwner !== session.owner) {
                throw new Error('Profilo non attribuito alla sessione corrente.');
            }
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
