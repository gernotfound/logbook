import { useState } from 'react';
import type { UserProfile } from '../../types';
import type { DomainOperationBatch } from '../../lib/sync/domainOperations';

/** A session witness captured for one edit, not a reusable owner credential. */
export type ProfileEditWitness = {
    owner: string;
    isCurrent: () => boolean;
};

export type ProfileEditorSource = {
    owner: string | null;
    profile: UserProfile | undefined;
    capture: () => ProfileEditWitness | null;
    /** Resolves only once the intent is durable or proven to be a no-op. */
    dispatch: (operation: DomainOperationBatch) => Promise<void>;
};

const PROFILE_FIELDS = ['dob', 'height', 'gender'] as const;
type ProfileField = typeof PROFILE_FIELDS[number];
type FieldEdits = Partial<Record<ProfileField, { value: string }>>;

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
        edits: FieldEdits;
    } | null>(null);
    const currentDraft = draft && source.owner === draft.witness.owner && draft.witness.isCurrent() ? draft : null;
    const value = (field: ProfileField) => currentDraft?.edits[field]?.value ?? source.profile?.[field] ?? '';

    const update = (field: ProfileField, value: string) => {
        const witness = source.capture();
        if (!witness || witness.owner !== source.owner || !witness.isCurrent()) return;
        setDraft(previous => ({
            witness,
            edits: {
                ...(previous && previous.witness.owner === witness.owner && previous.witness.isCurrent()
                    ? previous.edits : {}),
                [field]: { value },
            },
        }));
    };

    const handleSaveProfile = async (event?: { preventDefault: () => void }) => {
        event?.preventDefault();
        let witness: ProfileEditWitness | null = null;
        try {
            witness = source.capture();
            if (!witness || witness.owner !== source.owner || !witness.isCurrent()) {
                throw new Error('Profilo non attribuito alla sessione corrente.');
            }
            if (!currentDraft) return;
            if (currentDraft.witness.owner !== witness.owner || !currentDraft.witness.isCurrent()) return;
            const submitted = currentDraft.edits;
            const patch: Partial<UserProfile> = {};
            for (const field of PROFILE_FIELDS) {
                const edit = submitted[field];
                if (edit) patch[field] = edit.value;
            }
            await source.dispatch({ type: 'profile.patch', patch });
            const saved = witness;
            if (!saved.isCurrent()) return;
            // Drop only the exact edits accepted by this save. A newer edit,
            // even one with the same value, belongs to a subsequent intent.
            setDraft(previous => {
                if (!saved.isCurrent() || !previous || previous.witness.owner !== saved.owner
                    || !previous.witness.isCurrent()) return previous;
                const edits = { ...previous.edits };
                for (const field of PROFILE_FIELDS) {
                    if (edits[field] === submitted[field]) delete edits[field];
                }
                return PROFILE_FIELDS.some(field => edits[field]) ? { ...previous, edits } : null;
            });
        } catch {
            if (!witness || witness.isCurrent()) {
                await showAlert('Errore durante il salvataggio del profilo.');
            }
        }
    };

    return {
        dob: value('dob'), height: value('height'), gender: value('gender'),
        setDob: (value: string) => update('dob', value),
        setHeight: (value: string) => update('height', value),
        setGender: (value: string) => update('gender', value),
        handleSaveProfile,
    };
}
