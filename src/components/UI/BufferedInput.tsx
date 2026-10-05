import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { draftRegistry } from '../../lib/utils/draftRegistry';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { readDeviceValueStrict, writeDeviceValue } from '../../lib/sync/deviceStorage';
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
    try {
        return readDeviceValueStrict(key, owner);
    } catch (error) {
        console.error('Bozza bufferizzata non leggibile:', error);
        useAppStore.setState({
            localPersistenceBlocked: true,
            syncHealth: 'failed',
            syncPresentation: 'normal',
            saveError: 'Una bozza del workout non è leggibile sul dispositivo. Riapri TheLogBook prima di continuare.',
        });
        return null;
    }
}

export const BufferedInput = React.forwardRef<HTMLInputElement, BufferedInputProps>(
    ({ id, value, onChange, onBlur, onFocus, onKeyDown, type, inputMode, ...props }, ref) => {
        const initialSession = useRef(captureSession());
        const recoveryKey = useRef(recoveryName('input', id));
        const recovered = useRef(
            readRecoveryStrict(recoveryKey.current, initialSession.current.owner),
        );
        const initialValue = recovered.current ?? value ?? '';
        const [localValue, setLocalValue] = useState(initialValue);
        const isDirty = useRef(recovered.current !== null);
        const editSession = useRef(initialSession.current);
        const isFocused = useRef(false);
        const latestLocalValue = useRef(initialValue);
        const recoveryValue = useRef<string | null>(recovered.current);

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
            if (!key) throw new Error('Bozza volatile senza identificativo stabile.');
            if (!isCurrentSession(editSession.current)) throw new Error('Sessione cambiata prima del recupero della bozza.');
            const raw = String(latestLocalValue.current);
            writeDeviceValue(key, raw, editSession.current.owner);
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
                        writeDeviceValue(recoveryKey.current, null, editSession.current.owner);
                        recoveryValue.current = null;
                    } catch (error) {
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
                if (!isCurrentSession(editSession.current)) { isDirty.current = false; return; }
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
            editSession.current = captureSession();
            setLocalValue(e.target.value);
            latestLocalValue.current = e.target.value;
            isDirty.current = true;
            try { persistRecovery(); }
            catch { useAppStore.getState().setSaveError('Bozza non ancora protetta nello storage del dispositivo.'); }
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
        const initialSession = useRef(captureSession());
        const recoveryKey = useRef(recoveryName('textarea', id));
        const recovered = useRef(
            readRecoveryStrict(recoveryKey.current, initialSession.current.owner),
        );
        const initialValue = recovered.current ?? value ?? '';
        const [localValue, setLocalValue] = useState(initialValue);
        const isDirty = useRef(recovered.current !== null);
        const editSession = useRef(initialSession.current);
        const isFocused = useRef(false);
        const latestLocalValue = useRef(initialValue);
        const recoveryValue = useRef<string | null>(recovered.current);

        const onChangeRef = useRef(onChange);

        useLayoutEffect(() => {
            latestLocalValue.current = localValue;
            onChangeRef.current = onChange;
        });

        const persistRecovery = useCallback(() => {
            if (!isDirty.current) return;
            const key = recoveryKey.current;
            if (!key) throw new Error('Bozza volatile senza identificativo stabile.');
            if (!isCurrentSession(editSession.current)) throw new Error('Sessione cambiata prima del recupero della bozza.');
            const raw = String(latestLocalValue.current);
            writeDeviceValue(key, raw, editSession.current.owner);
            recoveryValue.current = raw;
        }, []);

        useEffect(() => {
            if (recoveryValue.current !== null && !isDirty.current && recoveryKey.current) {
                if (String(value ?? '') === recoveryValue.current) {
                    try {
                        writeDeviceValue(recoveryKey.current, null, editSession.current.owner);
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
                if (!isCurrentSession(editSession.current)) { isDirty.current = false; return; }
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
            editSession.current = captureSession();
            setLocalValue(e.target.value);
            latestLocalValue.current = e.target.value;
            isDirty.current = true;
            try { persistRecovery(); }
            catch { useAppStore.getState().setSaveError('Bozza non ancora protetta nello storage del dispositivo.'); }
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
