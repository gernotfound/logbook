import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { captureSessionForOwner, isCurrentSession, type SessionSnapshot } from '../lib/sync/session';
import { deviceKey, readDeviceValueStrict, writeDeviceValue } from '../lib/sync/deviceStorage';
import { draftRegistry } from '../lib/utils/draftRegistry';
import { requiredUpdateRecoveryRegistry } from '../lib/sync/requiredUpdateRecovery';
import { useAppStore } from '../store/useAppStore';
import { BrowserStorageError } from '../lib/sync/browserStorage';
import { LocalCiphertextError } from '../lib/sync/secureArchiveCipher';
import { LocalVaultLockedError, readVaultControl } from '../lib/sync/secureArchiveSession';

function readDraft(name: string, owner: string): Record<string, string> | null {
    try {
        const raw = readDeviceValueStrict(name, owner);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            if (readVaultControl(owner)) throw new LocalCiphertextError();
            return null;
        }
        const entries = Object.entries(parsed);
        if (entries.some(([, value]) => typeof value !== 'string')) {
            if (readVaultControl(owner)) throw new LocalCiphertextError();
            return null;
        }
        return Object.fromEntries(entries) as Record<string, string>;
    } catch (error) {
        if (error instanceof BrowserStorageError || error instanceof LocalVaultLockedError
            || error instanceof LocalCiphertextError) throw error;
        if (readVaultControl(owner)) throw error;
        console.warn('Bozza non leggibile, originale conservato:', error);
        return null;
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
};

export function useDatedDraft<T extends Record<string, string>>(kind: string, date: string, source: T) {
    const owner = useAppStore(state => state.dataOwner);
    const session = owner ? captureSessionForOwner(owner) : null;
    const name = 'draft:' + kind + ':' + date;
    const key = owner ? deviceKey(name, owner) : null;
    const stored = useMemo(() => key && owner ? readDraft(name, owner) : null, [key, name, owner]);
    const loaded = mergeDraft(source, stored);
    const [edited, setEdited] = useState<{ key: string; values: T | null } | null>(null);
    const values = key && edited?.key === key ? edited.values ?? source : loaded ?? source;
    const current = useRef<CurrentDraft<T>>({ key, name: key ? name : null, values, dirty: !!loaded, session });

    useLayoutEffect(() => {
        current.current = {
            key,
            name: key ? name : null,
            values,
            dirty: Boolean(key) && (edited?.key === key ? edited.values !== null : !!loaded),
            session,
        };
    });

    const persist = (draftName: string, draftOwner: string, value: T) => {
        try { writeDeviceValue(draftName, JSON.stringify(value), draftOwner); }
        catch (error) {
            useAppStore.getState().setSaveError('Bozza conservata solo in memoria: archivio del dispositivo non disponibile.');
            throw error;
        }
    };

    const setField = <K extends keyof T>(field: K, value: T[K]) => {
        if (!session || !key || !isCurrentSession(session) || current.current.key !== key) return;
        const next = { ...current.current.values, [field]: value };
        current.current = { key, name, values: next, dirty: true, session };
        setEdited({ key, values: next });
        try { persist(name, session.owner, next); } catch { /* Visible error; strict reload flush retries. */ }
    };

    const clear = (expected?: T) => {
        if (!session || !key || !isCurrentSession(session) || current.current.key !== key
            || (expected && JSON.stringify(expected) !== JSON.stringify(current.current.values))) return false;
        try { writeDeviceValue(name, null, session.owner); }
        catch (error) {
            useAppStore.getState().setSaveError('Dati salvati; impossibile rimuovere la bozza locale.');
            throw error;
        }
        current.current = { key, name, values: source, dirty: false, session };
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
            persist(draft.name, draft.session.owner, draft.values);
        };
        draftRegistry.register(flush);
        const unregisterRecovery = requiredUpdateRecoveryRegistry.register(flush);
        return () => {
            unregisterRecovery();
            draftRegistry.unregister(flush);
        };
    }, []);

    return { values, setField, clear };
}
