import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { draftRegistry } from '../../lib/utils/draftRegistry';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { readDeviceValueStrict, writeDeviceValue } from '../../lib/sync/deviceStorage';
import { BrowserStorageError } from '../../lib/sync/browserStorage';
import { requiredUpdateRecoveryRegistry } from '../../lib/sync/requiredUpdateRecovery';
import { useAppStore } from '../../store/useAppStore';

interface BufferedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
    value: string | number | undefined;
    onChange: (value: string) => void;
}

function recoveryName(kind: 'input' | 'textarea', id: string | undefined) {
    return id ? `draft:buffered:${kind}:${id}` : null;
}

function normalizeInputValue(value: string, type?: string, inputMode?: string) {
    return type === 'number' || inputMode === 'decimal' ? value.replace(',', '.') : value;
}

function readRecoveryStrict(key: string | null, owner: string): string | null {
    if (!key) return null;
    return readDeviceValueStrict(key, owner);
}

function blockBufferedPersistence(error: unknown): void {
    console.error('Persistenza bozza bufferizzata non disponibile:', error);
    useAppStore.setState({
        localPersistenceBlocked: true,
        syncHealth: 'failed',
        syncPresentation: 'normal',
        saveError: 'Una bozza del workout non è accessibile sul dispositivo. Riapri TheLogBook prima di continuare.',
    });
}

type InitialBufferedRecovery = {
    session: ReturnType<typeof captureSession> | null;
    key: string | null;
    recovered: string | null;
    error: unknown | null;
};

function createInitialRecovery(kind: 'input' | 'textarea', id: string | undefined): InitialBufferedRecovery {
    // Preserve the owner captured on mount: a late edit must never rebind
    // another account's draft after the session changes.
    const key = recoveryName(kind, id);
    try {
        const session = captureSession();
        return { session, key, recovered: readRecoveryStrict(key, session.owner), error: null };
    } catch (error) {
        return { session: null, key, recovered: null, error };
    }
}

export const BufferedInput = React.forwardRef<HTMLInputElement, BufferedInputProps>(
    ({ id, value, onChange, onBlur, onFocus, onKeyDown, type, inputMode, ...props }, ref) => {
        const [initialRecovery] = useState(() => createInitialRecovery('input', id));
        const initialValue = initialRecovery.recovered ?? value ?? '';
        const [localValue, setLocalValue] = useState(initialValue);
        const recoveryKey = useRef(initialRecovery.key);
        const isDirty = useRef(initialRecovery.recovered !== null);
        const editSession = useRef(initialRecovery.session);
        const isFocused = useRef(false);
        const latestLocalValue = useRef(initialValue);
        const recoveryValue = useRef<string | null>(initialRecovery.recovered);

        useEffect(() => {
            if (initialRecovery.error) blockBufferedPersistence(initialRecovery.error);
        }, [initialRecovery.error]);

        const onChangeRef = useRef(onChange);
        const typeRef = useRef(type);
        const inputModeRef = useRef(inputMode);

        useLayoutEffect(() => {
            latestLocalValue.current = localValue;
            onChangeRef.current = onChange;
            typeRef.current = type;
            inputModeRef.current = inputMode;
        });

        const persistRecovery = useCallback(() => {
            if (!isDirty.current) return;
            const key = recoveryKey.current;
            const session = editSession.current;
            if (!key) throw new Error('Bozza volatile senza identificativo stabile.');
            if (!session || !isCurrentSession(session)) throw new Error('Sessione cambiata prima del recupero della bozza.');
            const raw = String(latestLocalValue.current);
            writeDeviceValue(key, raw, session.owner);
            recoveryValue.current = raw;
        }, []);

        // Sync from external value if not focused or dirty. A recovered value remains
        // visible until its parent confirms the same value, then its recovery key is cleared.
        useEffect(() => {
            if (recoveryValue.current !== null && !isDirty.current && recoveryKey.current) {
                const recoveredNormalized = normalizeInputValue(
                    recoveryValue.current,
                    typeRef.current,
                    inputModeRef.current,
                );
                if (String(value ?? '') === recoveredNormalized) {
                    try {
                        const session = editSession.current;
                        if (!session) throw new Error('Sessione iniziale della bozza non disponibile.');
                        writeDeviceValue(recoveryKey.current, null, session.owner);
                        recoveryValue.current = null;
                    } catch {
                        useAppStore.getState().setSaveError('Dato salvato; impossibile rimuovere la copia di recupero locale.');
                    }
                }
            }
            if (!isFocused.current && !isDirty.current && recoveryValue.current === null) {
                setLocalValue(value ?? '');
                latestLocalValue.current = value ?? '';
            }
        }, [value]);

        const flush = useCallback(() => {
            if (isDirty.current) {
                const session = editSession.current;
                if (!session) throw new Error('Sessione della bozza non disponibile.');
                if (!isCurrentSession(session)) { isDirty.current = false; return; }
                const finalVal = normalizeInputValue(
                    String(latestLocalValue.current),
                    typeRef.current,
                    inputModeRef.current,
                );
                onChangeRef.current(finalVal);
                isDirty.current = false;
            }
        }, []);

        useEffect(() => {
            draftRegistry.register(flush);
            const unregisterRecovery = requiredUpdateRecoveryRegistry.register(persistRecovery);
            return () => {
                unregisterRecovery();
                draftRegistry.unregister(flush);
                try { flush(); }
                catch { useAppStore.getState().setSaveError('Impossibile salvare una bozza prima di chiudere il campo.'); }
            };
        }, [flush, persistRecovery]);

        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            setLocalValue(e.target.value);
            latestLocalValue.current = e.target.value;
            isDirty.current = true;
            try {
                persistRecovery();
            } catch (error) {
                useAppStore.getState().setSaveError('Bozza non ancora protetta nello storage del dispositivo.');
                if (error instanceof BrowserStorageError) blockBufferedPersistence(error);
            }
        };

        const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
            isFocused.current = true;
            if (onFocus) onFocus(e);
        };

        const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
            isFocused.current = false;
            flush();
            if (onBlur) onBlur(e);
        };

        const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                flush();
                e.currentTarget.blur();
            }
            if (onKeyDown) onKeyDown(e);
        };

        return (
            <input
                ref={ref}
                {...props}
                id={id}
                type={type}
                inputMode={inputMode}
                value={localValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
            />
        );
    }
);

BufferedInput.displayName = 'BufferedInput';

interface BufferedTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
    value: string | number | undefined;
    onChange: (value: string) => void;
}

export const BufferedTextarea = React.forwardRef<HTMLTextAreaElement, BufferedTextareaProps>(
    ({ id, value, onChange, onBlur, onFocus, ...props }, ref) => {
        const [initialRecovery] = useState(() => createInitialRecovery('textarea', id));
        const initialValue = initialRecovery.recovered ?? value ?? '';
        const [localValue, setLocalValue] = useState(initialValue);
        const recoveryKey = useRef(initialRecovery.key);
        const isDirty = useRef(initialRecovery.recovered !== null);
        const editSession = useRef(initialRecovery.session);
        const isFocused = useRef(false);
        const latestLocalValue = useRef(initialValue);
        const recoveryValue = useRef<string | null>(initialRecovery.recovered);

        useEffect(() => {
            if (initialRecovery.error) blockBufferedPersistence(initialRecovery.error);
        }, [initialRecovery.error]);

        const onChangeRef = useRef(onChange);

        useLayoutEffect(() => {
            latestLocalValue.current = localValue;
            onChangeRef.current = onChange;
        });

        const persistRecovery = useCallback(() => {
            if (!isDirty.current) return;
            const key = recoveryKey.current;
            const session = editSession.current;
            if (!key) throw new Error('Bozza volatile senza identificativo stabile.');
            if (!session || !isCurrentSession(session)) throw new Error('Sessione cambiata prima del recupero della bozza.');
            const raw = String(latestLocalValue.current);
            writeDeviceValue(key, raw, session.owner);
            recoveryValue.current = raw;
        }, []);

        useEffect(() => {
            if (recoveryValue.current !== null && !isDirty.current && recoveryKey.current) {
                if (String(value ?? '') === recoveryValue.current) {
                    try {
                        const session = editSession.current;
                        if (!session) throw new Error('Sessione iniziale della bozza non disponibile.');
                        writeDeviceValue(recoveryKey.current, null, session.owner);
                        recoveryValue.current = null;
                    } catch {
                        useAppStore.getState().setSaveError('Dato salvato; impossibile rimuovere la copia di recupero locale.');
                    }
                }
            }
            if (!isFocused.current && !isDirty.current && recoveryValue.current === null) {
                setLocalValue(value ?? '');
                latestLocalValue.current = value ?? '';
            }
        }, [value]);

        const flush = useCallback(() => {
            if (isDirty.current) {
                const session = editSession.current;
                if (!session) throw new Error('Sessione della bozza non disponibile.');
                if (!isCurrentSession(session)) { isDirty.current = false; return; }
                onChangeRef.current(String(latestLocalValue.current));
                isDirty.current = false;
            }
        }, []);

        useEffect(() => {
            draftRegistry.register(flush);
            const unregisterRecovery = requiredUpdateRecoveryRegistry.register(persistRecovery);
            return () => {
                unregisterRecovery();
                draftRegistry.unregister(flush);
                try { flush(); }
                catch { useAppStore.getState().setSaveError('Impossibile salvare una bozza prima di chiudere il campo.'); }
            };
        }, [flush, persistRecovery]);

        const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setLocalValue(e.target.value);
            latestLocalValue.current = e.target.value;
            isDirty.current = true;
            try {
                persistRecovery();
            } catch (error) {
                useAppStore.getState().setSaveError('Bozza non ancora protetta nello storage del dispositivo.');
                if (error instanceof BrowserStorageError) blockBufferedPersistence(error);
            }
        };

        const handleFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
            isFocused.current = true;
            if (onFocus) onFocus(e);
        };

        const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
            isFocused.current = false;
            flush();
            if (onBlur) onBlur(e);
        };

        return (
            <textarea
                ref={ref}
                {...props}
                id={id}
                value={localValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
            />
        );
    }
);

BufferedTextarea.displayName = 'BufferedTextarea';
