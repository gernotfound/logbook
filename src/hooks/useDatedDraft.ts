import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { deviceKey } from '../lib/sync/deviceStorage';
import { draftRegistry } from '../lib/utils/draftRegistry';
import { useAppStore } from '../store/useAppStore';

// Only named string fields enter form state. Unowned legacy drafts remain untouched.
function readDraft<T extends Record<string, string>>(key: string, fields: T): T | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        const entries = Object.entries(fields).map(([field, fallback]) => [field, Object.hasOwn(parsed, field) ? (parsed as Record<string, unknown>)[field] : fallback]);
        if (entries.some(([, value]) => typeof value !== 'string')) return null;
        return Object.fromEntries(entries) as T;
    } catch (error) { console.warn('Bozza non leggibile, originale conservato:', error); return null; }
}

export function useDatedDraft<T extends Record<string, string>>(kind: string, date: string, source: T) {
    const session = captureSession();
    const key = deviceKey(`draft:${kind}:${date}`, session.owner);
    // A key change reads its own draft; no effect ever writes values from the previous day.
    const loaded = useMemo(() => readDraft(key, source), [key]);
    const [edited, setEdited] = useState<{ key: string; values: T | null } | null>(null);
    const values = edited?.key === key ? edited.values ?? source : loaded ?? source;
    const current = useRef({ key, values, dirty: !!loaded, session });
    useLayoutEffect(() => { current.current = { key, values, dirty: edited?.key === key ? edited.values !== null : !!loaded, session }; });
    const persist = (draftKey: string, value: T) => {
        try { localStorage.setItem(draftKey, JSON.stringify(value)); }
        catch (error) {
            useAppStore.getState().setSaveError('Bozza conservata solo in memoria: archivio del dispositivo non disponibile.');
            throw error;
        }
    };
    const setField = <K extends keyof T>(field: K, value: T[K]) => {
        if (!isCurrentSession(session) || current.current.key !== key) return;
        const next = { ...current.current.values, [field]: value };
        current.current = { key, values: next, dirty: true, session };
        setEdited({ key, values: next });
        try { persist(key, next); } catch { /* Visible error, and strict reload flush retries. */ }
    };
    const clear = (expected?: T) => {
        if (!isCurrentSession(session) || current.current.key !== key || (expected && JSON.stringify(expected) !== JSON.stringify(current.current.values))) return false;
        try { localStorage.removeItem(key); }
        catch (error) { useAppStore.getState().setSaveError('Dati salvati; impossibile rimuovere la bozza locale.'); throw error; }
        current.current = { key, values: source, dirty: false, session };
        setEdited({ key, values: null });
        return true;
    };
    useEffect(() => {
        const flush = () => {
            const draft = current.current;
            if (draft.dirty && isCurrentSession(draft.session)) persist(draft.key, draft.values);
        };
        draftRegistry.register(flush);
        return () => draftRegistry.unregister(flush);
    }, []);
    return { values, setField, clear };
}
