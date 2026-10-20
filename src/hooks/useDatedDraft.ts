import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { captureSessionForOwner, isCurrentSession, type SessionSnapshot } from '../lib/sync/session';
import { deviceKey } from '../lib/sync/deviceStorage';
import {
    DatedDraftConflictError, readFencedDatedDraftImage,
    writeFencedDatedDraft, UnverifiedDatedDraftEpochError,
    type DatedDraftImage,
} from '../lib/sync/datedDraftEpoch';
import { draftRegistry } from '../lib/utils/draftRegistry';
import { requiredUpdateRecoveryRegistry } from '../lib/sync/requiredUpdateRecovery';
import { useAppStore } from '../store/useAppStore';
import { BrowserStorageError } from '../lib/sync/browserStorage';
import { LocalCiphertextError } from '../lib/sync/secureArchiveCipher';
import { LocalPurgePendingError } from '../lib/sync/localPurgeFence';
import { LocalVaultLockedError, readVaultControl } from '../lib/sync/secureArchiveSession';

function readDraft(name: string, owner: string): DatedDraftImage {
    try {
        return readFencedDatedDraftImage(name, owner);
    } catch (error) {
        if (error instanceof UnverifiedDatedDraftEpochError || error instanceof BrowserStorageError || error instanceof LocalVaultLockedError
            || error instanceof LocalPurgePendingError || error instanceof LocalCiphertextError) throw error;
        if (readVaultControl(owner)) throw error;
        console.warn('Bozza non leggibile, originale conservato:', error);
        return { values: null, raw: null };
    }
}

function mergeDraft<T extends Record<string, string>>(source: T, stored: Record<string, string> | null): T | null {
    if (!stored) return null;
    return Object.fromEntries(
        Object.entries(source).map(([field, fallback]) => [
            field,
            Object.hasOwn(stored, field) ? stored[field] : fallback,
        ]),
    ) as T;
}

type CurrentDraft<T extends Record<string, string>> = {
    key: string | null;
    name: string | null;
    values: T;
    dirty: boolean;
    session: SessionSnapshot | null;
    observedRaw: string | null;
};

export function useDatedDraft<T extends Record<string, string>>(kind: string, date: string, source: T) {
    const owner = useAppStore(state => state.dataOwner);
    const session = owner ? captureSessionForOwner(owner) : null;
    const name = 'draft:' + kind + ':' + date;
    const key = owner ? deviceKey(name, owner) : null;
    // The consent generation is part of the read scope: a mounted form must
    // re-check provenance when another tab advances the owner's epoch.
    const readScope = key ? JSON.stringify([key, session?.consentGeneration, session?.consentMarker]) : null;
    const { image, provenanceError } = useMemo(() => {
        try {
            return {
                image: readScope && owner ? readDraft(name, owner) : { values: null, raw: null },
                provenanceError: null as UnverifiedDatedDraftEpochError | null,
            };
        } catch (error) {
            if (!(error instanceof UnverifiedDatedDraftEpochError)) throw error;
            return { image: { values: null, raw: null }, provenanceError: error };
        }
    }, [readScope, name, owner]);
    const blockProvenance = (error: UnverifiedDatedDraftEpochError | DatedDraftConflictError) => {
        useAppStore.setState({
            localPersistenceBlocked: true,
            syncHealth: 'failed',
            syncPresentation: 'normal',
            saveError: error.message,
        });
    };
    useEffect(() => {
        if (provenanceError) blockProvenance(provenanceError);
    }, [provenanceError]);
    const loaded = mergeDraft(source, image.values);
    const [edited, setEdited] = useState<{ key: string; values: T | null } | null>(null);
    const values = key && edited?.key === key ? edited.values ?? source : loaded ?? source;
    const current = useRef<CurrentDraft<T>>({ key, name: key ? name : null, values, dirty: !!loaded, session, observedRaw: image.raw });

    useLayoutEffect(() => {
        // A rerender must not reset the editor's write baseline to its mount image.
        // Navigating to another date creates a separate observed-image scope.
        const observedRaw = current.current.key === key ? current.current.observedRaw : image.raw;
        current.current = {
            key,
            name: key ? name : null,
            values,
            dirty: Boolean(key) && (edited?.key === key ? edited.values !== null : !!loaded),
            session,
            observedRaw,
        };
    });

    const verifyCurrentDraft = () => {
        if (provenanceError) {
            blockProvenance(provenanceError);
            throw provenanceError;
        }
        if (!session || !key || !isCurrentSession(session) || current.current.key !== key) {
            throw new Error('Sessione cambiata prima della verifica della bozza.');
        }
        try {
            const image = readFencedDatedDraftImage(name, session.owner);
            if (image.raw !== current.current.observedRaw) throw new DatedDraftConflictError();
        } catch (error) {
            if (error instanceof UnverifiedDatedDraftEpochError || error instanceof DatedDraftConflictError) {
                blockProvenance(error);
            }
            throw error;
        }
    };

    const persist = (draftName: string, draftOwner: string, value: T, expectedRaw: string | null): string => {
        try {
            return writeFencedDatedDraft(draftName, draftOwner, value, expectedRaw);
        } catch (error) {
            if (error instanceof UnverifiedDatedDraftEpochError || error instanceof DatedDraftConflictError) {
                blockProvenance(error);
            } else {
                useAppStore.getState().setSaveError('Bozza conservata solo in memoria: archivio del dispositivo non disponibile.');
            }
            throw error;
        }
    };

    const setField = <K extends keyof T>(field: K, value: T[K]) => {
        if (!session || !key) return;
        try { verifyCurrentDraft(); } catch { return; }
        const next = { ...current.current.values, [field]: value };
        current.current = { key, name, values: next, dirty: true, session, observedRaw: current.current.observedRaw };
        setEdited({ key, values: next });
        try {
            current.current.observedRaw = persist(name, session.owner, next, current.current.observedRaw);
        } catch { /* Visible error; strict reload flush retries. */ }
    };

    const clear = (expected?: T) => {
        if (!session || !key || !isCurrentSession(session) || current.current.key !== key
            || (expected && JSON.stringify(expected) !== JSON.stringify(current.current.values))) return false;
        verifyCurrentDraft();
        let clearedRaw: string;
        try { clearedRaw = writeFencedDatedDraft(name, session.owner, null, current.current.observedRaw); }
        catch (error) {
            if (error instanceof UnverifiedDatedDraftEpochError || error instanceof DatedDraftConflictError) {
                blockProvenance(error);
            } else {
                useAppStore.getState().setSaveError('Dati salvati; impossibile rimuovere la bozza locale.');
            }
            throw error;
        }
        current.current = { key, name, values: source, dirty: false, session, observedRaw: clearedRaw };
        setEdited({ key, values: null });
        return true;
    };

    useEffect(() => {
        const flush = () => {
            const draft = current.current;
            if (!draft.dirty) return;
            if (!draft.key || !draft.name || !draft.session || !isCurrentSession(draft.session)) {
                throw new Error('Sessione cambiata prima del salvataggio della bozza.');
            }
            draft.observedRaw = persist(draft.name, draft.session.owner, draft.values, draft.observedRaw);
        };
        draftRegistry.register(flush);
        const unregisterRecovery = requiredUpdateRecoveryRegistry.register(flush);
        return () => {
            unregisterRecovery();
            draftRegistry.unregister(flush);
        };
    }, []);

    return { values, setField, clear, verifyCurrentDraft };
}
