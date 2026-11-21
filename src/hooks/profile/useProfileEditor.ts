import { useRef, useState } from 'react';
import type { SyncResult, UserProfile } from '../../types';
import type { DomainOperationBatch } from '../../lib/sync/domainOperations';
import { dispatchDurableOperation } from '../../lib/sync/dispatchDurableOperation';

/** A session witness captured for one edit, not a reusable owner credential. */
export type ProfileEditWitness = {
    owner: string;
    isCurrent: () => boolean;
};

export type ProfileEditorSource = {
    owner: string | null;
    profile: UserProfile | undefined;
    capture: () => ProfileEditWitness | null;
    dispatch: (operation: DomainOperationBatch) => Promise<SyncResult>;
};

/**
 * The biometric editor owns only the in-progress form and its revision.
 * Account and guest adapters provide the *one* domain-operation writer for
 * their owner; this module never reads an Auth SDK, Zustand or IndexedDB.
 */
export function useProfileEditor(
    source: ProfileEditorSource,
    showAlert: (message: string) => Promise<unknown>,
) {
    const [draft, setDraft] = useState<{
        witness: ProfileEditWitness;
        values: Pick<UserProfile, 'dob' | 'height' | 'gender'>;
    } | null>(null);
    const draftRevision = useRef(0);
    const validDraft = draft && source.owner === draft.witness.owner && draft.witness.isCurrent();
    const profile = validDraft ? draft.values : source.profile ?? { dob: '', height: '', gender: '' };

    const dob = profile.dob || '';
    const height = profile.height || '';
    const gender = profile.gender || '';

    const update = (field: 'dob' | 'height' | 'gender', value: string) => {
        const witness = source.capture();
        if (!witness || witness.owner !== source.owner || !witness.isCurrent()) return;
        draftRevision.current++;
        setDraft(previous => ({
            witness,
            values: {
                ...(previous && previous.witness.owner === witness.owner && previous.witness.isCurrent()
                    ? previous.values : source.profile),
                [field]: value,
            },
        }));
    };

    const handleSaveProfile = async (event?: { preventDefault: () => void }) => {
        event?.preventDefault();
        const newProfile = { dob, height, gender };
        const revisionAtSubmit = draftRevision.current;
        let witness: ProfileEditWitness | null = null;
        try {
            witness = source.capture();
            if (!witness || witness.owner !== source.owner || !witness.isCurrent()) {
                throw new Error('Profilo non attribuito alla sessione corrente.');
            }
            await dispatchDurableOperation(source.dispatch, { type: 'profile.patch', patch: newProfile });
            if (witness.isCurrent() && draftRevision.current === revisionAtSubmit) setDraft(null);
        } catch {
            if (!witness || witness.isCurrent()) {
                await showAlert('Errore durante il salvataggio del profilo.');
            }
        }
    };

    return {
        dob, height, gender,
        setDob: (value: string) => update('dob', value),
        setHeight: (value: string) => update('height', value),
        setGender: (value: string) => update('gender', value),
        handleSaveProfile,
    };
}
