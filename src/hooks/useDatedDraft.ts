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
import { requireHealthConsentWritable } from '../lib/healthConsent';
import {
    DatedWriterConsumedError, clearDatedWriterIntent, createDatedWriterIntentName,
    readDatedWriterEvidence, writeDatedWriterIntent, type DatedWriterEvidence,
} from '../lib/sync/datedDraftWriterIntent';
import { traceWriterLineage, writerParentReference } from '../lib/sync/writerLineage';

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
    scope: string | null;
    writerName: string | null;
    writerRaw: string | null;
    sourceIntent: DatedWriterEvidence | null;
    sourceLineage: DatedWriterEvidence[];
};

export function useDatedDraft<T extends Record<string, string>>(kind: string, date: string, source: T) {
    const owner = useAppStore(state => state.dataOwner);
    const session = owner ? captureSessionForOwner(owner) : null;
    const name = 'draft:' + kind + ':' + date;
    const key = owner ? deviceKey(name, owner) : null;
    // The consent generation is part of the read scope: a mounted form must
    // re-check provenance when another tab advances the owner's epoch.
    const readScope = key ? JSON.stringify([key, session?.consentGeneration, session?.consentMarker]) : null;
    const { image, sourceIntent, sourceLineage, provenanceError } = useMemo(() => {
        try {
            const image = readScope && owner ? readDraft(name, owner) : { values: null, raw: null };
            const evidence = readScope && owner ? readDatedWriterEvidence(owner, name) : [];
            // Multiple independent witnesses are safe only when every link
            // authenticates a single unbranched predecessor→successor history.
            const lineage = traceWriterLineage(evidence);
            const latest = lineage.at(-1);
            if (latest && JSON.stringify(latest.values) !== JSON.stringify(image.values)) {
                throw new DatedDraftConflictError();
            }
            return { image, sourceIntent: latest ?? null, sourceLineage: lineage,
                provenanceError: null as Error | null };
        } catch (error) {
            // Corruption and unavailable storage are also blocking errors:
            // never interpret unreadable witness evidence as an empty draft.
            return { image: { values: null, raw: null }, sourceIntent: null, sourceLineage: [],
                provenanceError: error instanceof Error ? error : new Error('Copie datate non verificabili.') };
        }
    }, [readScope, name, owner]);
    const blockProvenance = (error: Error) => {
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
    const [edited, setEdited] = useState<{ scope: string; values: T | null } | null>(null);
    const values = readScope && edited?.scope === readScope ? edited.values ?? source : loaded ?? source;
    const current = useRef<CurrentDraft<T>>({
        key, name: key ? name : null, scope: readScope, values, dirty: false, session,
        observedRaw: image.raw, writerName: null, writerRaw: null, sourceIntent, sourceLineage,
    });
    // The reload registry callback is intentionally registered once. Keep
    // provenance current across consent-generation changes without capturing
    // the first render's stale error value.
    const currentProvenanceError = useRef<Error | null>(provenanceError);

    useLayoutEffect(() => {
        currentProvenanceError.current = provenanceError;
        // A rerender must not reset the editor's write baseline to its mount image.
        // Navigating to another date creates a separate observed-image scope.
        const sameScope = current.current.scope === readScope;
        current.current = {
            key, name: key ? name : null, scope: readScope, values,
            // A recovered snapshot is already durable; only new edits need a flush.
            dirty: Boolean(key) && edited?.scope === readScope && edited.values !== null,
            session,
            observedRaw: sameScope ? current.current.observedRaw : image.raw,
            writerName: sameScope ? current.current.writerName : null,
            writerRaw: sameScope ? current.current.writerRaw : null,
            sourceIntent: sameScope ? current.current.sourceIntent : sourceIntent,
            sourceLineage: sameScope ? current.current.sourceLineage : sourceLineage,
        };
    });

    const assertIndependentEvidence = (draft: CurrentDraft<T>) => {
        if (!draft.name || !draft.session) throw new Error('Sessione bozza datata non verificata.');
        if (draft.writerName !== null && draft.writerRaw === null) {
            throw new DatedDraftConflictError();
        }
        const evidence = traceWriterLineage(readDatedWriterEvidence(draft.session.owner, draft.name));
        const expected = [...draft.sourceLineage,
            ...(draft.writerName && draft.writerRaw
                ? [{ name: draft.writerName, raw: draft.writerRaw }] : [])];
        if (evidence.length !== expected.length
            || evidence.some(entry => !expected.some(item =>
                entry.name === item.name && entry.raw === item.raw))) {
            throw new DatedDraftConflictError();
        }
        if (draft.writerRaw && !evidence.some(e => e.name === draft.writerName
            && e.raw === draft.writerRaw
            && JSON.stringify(e.values) === JSON.stringify(draft.values))) {
            // A failed writer update must never cause a previous independent
            // witness to be treated as proof of newer keystrokes in RAM.
            throw new DatedDraftConflictError();
        }
    };

    const verifyCurrentDraft = () => {
        if (provenanceError) {
            blockProvenance(provenanceError);
            throw provenanceError;
        }
        const draft = current.current;
        if (!session || !key || !isCurrentSession(session) || draft.key !== key
            || draft.scope !== readScope) {
            throw new Error('Sessione cambiata prima della verifica della bozza.');
        }
        try {
            const currentImage = readFencedDatedDraftImage(name, session.owner);
            if (currentImage.raw !== draft.observedRaw) throw new DatedDraftConflictError();
            assertIndependentEvidence(draft);
        } catch (error) {
            if (error instanceof UnverifiedDatedDraftEpochError || error instanceof DatedDraftConflictError) {
                blockProvenance(error);
            }
            throw error;
        }
    };

    const persist = (draft: CurrentDraft<T>): void => {
        try {
            if (!draft.key || !draft.name || !draft.session || !isCurrentSession(draft.session)) {
                throw new Error('Sessione cambiata prima del salvataggio della bozza.');
            }
            if (currentProvenanceError.current) throw currentProvenanceError.current;
            // Persist this editor's latest full input BEFORE touching the
            // shared key. Even a lost canonical race keeps a distinct witness.
            draft.writerName ??= createDatedWriterIntentName();
            try {
                draft.writerRaw = writeDatedWriterIntent(
                    draft.writerName, draft.session.owner, draft.name, draft.values,
                    draft.writerRaw, draft.session.consentGeneration,
                    draft.writerRaw === null ? writerParentReference(draft.sourceIntent) : undefined,
                );
            } catch (error) {
                // A different editor can confirm the value we loaded and
                // consume its witness while our form remains mounted. A new
                // user edit must have its own fresh copy, never reuse the
                // missing key or bypass the canonical conflict fence.
                if (!(error instanceof DatedWriterConsumedError)) throw error;
                const fresh = createDatedWriterIntentName();
                const written = writeDatedWriterIntent(
                    fresh, draft.session.owner, draft.name, draft.values,
                    null, draft.session.consentGeneration,
                );
                draft.writerName = fresh;
                draft.writerRaw = written;
            }
            if (useAppStore.getState().localPersistenceBlocked) throw new DatedDraftConflictError();
            const before = readFencedDatedDraftImage(draft.name, draft.session.owner);
            if (before.raw !== draft.observedRaw) throw new DatedDraftConflictError();
            assertIndependentEvidence(draft);
            draft.observedRaw = writeFencedDatedDraft(
                draft.name, draft.session.owner, draft.values, draft.observedRaw,
            );
        } catch (error) {
            if (error instanceof UnverifiedDatedDraftEpochError || error instanceof DatedDraftConflictError) {
                blockProvenance(error);
            } else {
                useAppStore.getState().setSaveError('Bozza conservata solo in memoria o nella copia di recupero: archivio del dispositivo non disponibile.');
            }
            throw error;
        }
    };

    const setField = <K extends keyof T>(field: K, value: T[K]) => {
        if (!session || !key || !readScope || !isCurrentSession(session)
            || current.current.scope !== readScope || currentProvenanceError.current) return;
        const next = { ...current.current.values, [field]: value };
        current.current = { ...current.current, values: next, dirty: true };
        setEdited({ scope: readScope, values: next });
        try { persist(current.current); }
        catch { /* The independent witness or visible blocking error preserves recovery. */ }
    };

    const clear = (expected?: T) => {
        const draft = current.current;
        if (!session || !key || !isCurrentSession(session) || draft.key !== key
            || draft.scope !== readScope
            || (expected && JSON.stringify(expected) !== JSON.stringify(draft.values))) return false;
        verifyCurrentDraft();
        try {
            requireHealthConsentWritable(session.owner);
            const clearedRaw = writeFencedDatedDraft(name, session.owner, null, draft.observedRaw);
            // Business commit was already durably confirmed. Remove only the
            // exact witness belonging to this editor and the witness loaded at
            // mount. Unrelated contenders must remain untouched.
            draft.observedRaw = clearedRaw;
            if (draft.writerName && draft.writerRaw) {
                clearDatedWriterIntent(draft.writerName, session.owner,
                    draft.writerRaw, session.consentGeneration);
                draft.writerName = null;
                draft.writerRaw = null;
            }
            // The business commit has been confirmed; clear only the exact
            // authenticated chain loaded by this editor, newest first.
            for (const ancestor of [...draft.sourceLineage].reverse()) {
                clearDatedWriterIntent(ancestor.name, session.owner,
                    ancestor.raw, session.consentGeneration);
            }
            draft.sourceLineage = [];
            draft.sourceIntent = null;
        } catch (error) {
            if (error instanceof UnverifiedDatedDraftEpochError || error instanceof DatedDraftConflictError) {
                blockProvenance(error);
            } else {
                useAppStore.getState().setSaveError('Dati salvati; impossibile pulire la copia locale di recupero.');
            }
            throw error;
        }
        current.current = { ...draft, values: source, dirty: false };
        setEdited({ scope: readScope!, values: null });
        return true;
    };

    const persistRef = useRef(persist);
    useLayoutEffect(() => {
        persistRef.current = persist;
    });

    useEffect(() => {
        const flush = () => {
            const draft = current.current;
            if (!draft.dirty) return;
            if (!draft.key || !draft.name || !draft.session || !isCurrentSession(draft.session)) {
                throw new Error('Sessione cambiata prima del salvataggio della bozza.');
            }
            persistRef.current(draft);
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
