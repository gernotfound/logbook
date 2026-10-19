import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { draftRegistry } from '../../lib/utils/draftRegistry';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { assertBufferedDraftUnchanged, readBufferedDraftSnapshot, writeBufferedDraft } from '../../lib/sync/bufferedDraftEpoch';
import { requiredUpdateRecoveryRegistry } from '../../lib/sync/requiredUpdateRecovery';
import { useAppStore } from '../../store/useAppStore';
import { BufferedWorkoutScope } from './bufferedWorkoutScope';
import {
    clearBufferedWriterIntent, createBufferedWriterIntentName,
    readBufferedWriterEvidence, writeBufferedWriterIntent,
} from '../../lib/sync/bufferedDraftWriterIntent';
import type { BufferedWriterEvidence } from '../../lib/sync/bufferedDraftWriterIntent';

 interface BufferedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
    value: string | number | undefined;
    onChange: (value: string) => void;
}

function recoveryName(kind: 'input' | 'textarea', id: string | undefined, workoutId: string | null) {
    if (!id) return null;
    // Unscoped records from previous builds are kept untouched as recovery
    // evidence. They cannot establish which workout produced their content,
    // even when their owner and consent revision are known.
    return workoutId ? `draft:buffered:${kind}:${workoutId}:${id}`
        : `draft:buffered:${kind}:${id}`;
}

function isCurrentWorkoutScope(workoutId: string | null): boolean {
    // A keyed provider remounts on workout changes, but its old child's cleanup
    // must not flush pending text into the next workout's parent callback.
    return !workoutId || String(useAppStore.getState().localWorkout?.id ?? '') === workoutId;
}

function normalizeInputValue(value: string, type?: string, inputMode?: string) {
    return type === 'number' || inputMode === 'decimal' ? value.replace(',', '.') : value;
}

function readRecoveryStrict(key: string | null, owner: string) {
    return key ? readBufferedDraftSnapshot(key, owner) : { value: null, raw: null };
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
    observedRaw: string | null;
    sourceIntent: BufferedWriterEvidence | null;
    error: unknown | null;
};

function createInitialRecovery(
    kind: 'input' | 'textarea', id: string | undefined, workoutId: string | null,
): InitialBufferedRecovery {
    // Preserve the owner captured on mount: a late edit must never rebind
    // another account's draft after the session changes.
    const key = recoveryName(kind, id, workoutId);
    try {
        const session = captureSession();
        const snapshot = readRecoveryStrict(key, session.owner);
        const intents = key ? readBufferedWriterEvidence(session.owner, key) : [];
        if (intents.length > 1 || (intents.length === 1 && intents[0].value !== snapshot.value)) {
            throw new Error('Bozze concorrenti non riconciliabili: originali conservati per esportazione.');
        }
        return {
            session, key, recovered: snapshot.value, observedRaw: snapshot.raw,
            sourceIntent: intents[0] ?? null, error: null,
        };
    } catch (error) {
        return { session: null, key, recovered: null, observedRaw: null, sourceIntent: null, error };
    }
}

export const BufferedInput = React.forwardRef<HTMLInputElement, BufferedInputProps>(
    ({ id, value, onChange, onBlur, onFocus, onKeyDown, type, inputMode, ...props }, ref) => {
        const workoutId = React.useContext(BufferedWorkoutScope);
        const [initialRecovery] = useState(() => createInitialRecovery('input', id, workoutId));
        const initialValue = initialRecovery.recovered ?? value ?? '';
        const [localValue, setLocalValue] = useState(initialValue);
        const recoveryKey = useRef(initialRecovery.key);
        const isDirty = useRef(initialRecovery.recovered !== null);
        const editSession = useRef(initialRecovery.session);
        const isFocused = useRef(false);
        const latestLocalValue = useRef(initialValue);
        const recoveryValue = useRef<string | null>(initialRecovery.recovered);
        const observedRaw = useRef<string | null>(initialRecovery.observedRaw);
        const writerIntentName = useRef<string | null>(null);
        const writerIntentRaw = useRef<string | null>(null);
        const sourceIntent = useRef(initialRecovery.sourceIntent);

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
            if (!isCurrentWorkoutScope(workoutId)) {
                throw new Error('Allenamento cambiato prima di salvare la bozza.');
            }
            const raw = String(latestLocalValue.current);
            if (useAppStore.getState().localPersistenceBlocked) {
                throw new Error('Persistenza delle bozze del workout bloccata.');
            }
            // Every editor has its own device key: preserve input synchronously
            // before the shared canonical key can lose a truly simultaneous race.
            writerIntentName.current ??= createBufferedWriterIntentName();
            writerIntentRaw.current = writeBufferedWriterIntent(
                writerIntentName.current, session.owner, key, raw,
                writerIntentRaw.current, session.consentGeneration,
            );
            observedRaw.current = writeBufferedDraft(
                key, session.owner, raw, session.consentGeneration, observedRaw.current,
            );
            recoveryValue.current = raw;
        }, [workoutId]);

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
                        if (!isCurrentSession(session) || !isCurrentWorkoutScope(workoutId)) {
                            throw new Error('Sessione workout cambiata prima della pulizia della bozza.');
                        }
                        observedRaw.current = writeBufferedDraft(
                            recoveryKey.current, session.owner, null,
                            session.consentGeneration, observedRaw.current,
                        );
                        // Only after the parent confirms this value do we remove
                        // this editor's independent recovery witness. Any
                        // failure preserves the remaining witness for export.
                        if (writerIntentName.current && writerIntentRaw.current) {
                            clearBufferedWriterIntent(
                                writerIntentName.current, session.owner,
                                writerIntentRaw.current, session.consentGeneration,
                            );
                            writerIntentRaw.current = null;
                        }
                        if (sourceIntent.current) {
                            clearBufferedWriterIntent(
                                sourceIntent.current.name, session.owner,
                                sourceIntent.current.raw, session.consentGeneration,
                            );
                            sourceIntent.current = null;
                        }
                        recoveryValue.current = null;
                    } catch (error) {
                        blockBufferedPersistence(error);
                    }
                }
            }
            if (!isFocused.current && !isDirty.current && recoveryValue.current === null) {
                setLocalValue(value ?? '');
                latestLocalValue.current = value ?? '';
            }
        }, [value, workoutId]);

        const flush = useCallback(() => {
            if (isDirty.current) {
                if (!isCurrentWorkoutScope(workoutId)) {
                    // The source copy is already owner+workout scoped and is
                    // preserved for recovery. Never mutate a different workout.
                    isDirty.current = false;
                    return;
                }
                const session = editSession.current;
                if (!session) throw new Error('Sessione della bozza non disponibile.');
                if (!isCurrentSession(session)) {
                    isDirty.current = false;
                    // Switching identities must not update a new owner's UI. A
                    // consent transition for the same owner, however, is a
                    // blocked recovery requiring an explicit warning.
                    const current = captureSession();
                    if (current.owner === session.owner
                        && current.consentGeneration !== session.consentGeneration) {
                        throw new Error('Consenso modificato: bozza workout precedente conservata.');
                    }
                    return;
                }
                if (useAppStore.getState().localPersistenceBlocked) {
                    throw new Error('Persistenza delle bozze del workout bloccata.');
                }
                if (recoveryKey.current) {
                    // Before promoting an in-memory edit, verify the source copy
                    // has not been invalidated or replaced by another tab.
                    assertBufferedDraftUnchanged(
                        recoveryKey.current, session.owner, observedRaw.current,
                    );
                }
                const finalVal = normalizeInputValue(
                    String(latestLocalValue.current),
                    typeRef.current,
                    inputModeRef.current,
                );
                onChangeRef.current(finalVal);
                isDirty.current = false;
            }
        }, [workoutId]);

        useEffect(() => {
            draftRegistry.register(flush);
            const unregisterRecovery = requiredUpdateRecoveryRegistry.register(persistRecovery);
            return () => {
                unregisterRecovery();
                draftRegistry.unregister(flush);
                try { flush(); }
                catch (error) { blockBufferedPersistence(error); }
            };
        }, [flush, persistRecovery]);

        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            setLocalValue(e.target.value);
            latestLocalValue.current = e.target.value;
            isDirty.current = true;
            try {
                persistRecovery();
            } catch (error) {
                if (!recoveryKey.current || !editSession.current || !isCurrentSession(editSession.current)) {
                    // Inputs without a stable key have always flushed to their
                    // parent on blur/unmount, but cannot guarantee PWA reload.
                    // Preserve that UI contract; the required-update capture
                    // still rejects an unsaved device draft with no key.
                    useAppStore.getState().setSaveError('Bozza non ancora protetta nello storage del dispositivo.');
                } else {
                    blockBufferedPersistence(error);
                }
            }
        };

        const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
            isFocused.current = true;
            if (onFocus) onFocus(e);
        };

        const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
            isFocused.current = false;
            try {
                flush();
                if (!editSession.current || !isCurrentSession(editSession.current)
                    || !isCurrentWorkoutScope(workoutId)) return;
                if (onBlur) onBlur(e);
            } catch (error) {
                blockBufferedPersistence(error);
            }
        };

        const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                try {
                    flush();
                    if (!editSession.current || !isCurrentSession(editSession.current)
                    || !isCurrentWorkoutScope(workoutId)) return;
                    e.currentTarget.blur();
                } catch (error) {
                    blockBufferedPersistence(error);
                    return;
                }
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
        const workoutId = React.useContext(BufferedWorkoutScope);
        const [initialRecovery] = useState(() => createInitialRecovery('textarea', id, workoutId));
        const initialValue = initialRecovery.recovered ?? value ?? '';
        const [localValue, setLocalValue] = useState(initialValue);
        const recoveryKey = useRef(initialRecovery.key);
        const isDirty = useRef(initialRecovery.recovered !== null);
        const editSession = useRef(initialRecovery.session);
        const isFocused = useRef(false);
        const latestLocalValue = useRef(initialValue);
        const recoveryValue = useRef<string | null>(initialRecovery.recovered);
        const observedRaw = useRef<string | null>(initialRecovery.observedRaw);
        const writerIntentName = useRef<string | null>(null);
        const writerIntentRaw = useRef<string | null>(null);
        const sourceIntent = useRef(initialRecovery.sourceIntent);

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
            if (!isCurrentWorkoutScope(workoutId)) {
                throw new Error('Allenamento cambiato prima di salvare la bozza.');
            }
            const raw = String(latestLocalValue.current);
            if (useAppStore.getState().localPersistenceBlocked) {
                throw new Error('Persistenza delle bozze del workout bloccata.');
            }
            // Every editor has its own device key: preserve input synchronously
            // before the shared canonical key can lose a truly simultaneous race.
            writerIntentName.current ??= createBufferedWriterIntentName();
            writerIntentRaw.current = writeBufferedWriterIntent(
                writerIntentName.current, session.owner, key, raw,
                writerIntentRaw.current, session.consentGeneration,
            );
            observedRaw.current = writeBufferedDraft(
                key, session.owner, raw, session.consentGeneration, observedRaw.current,
            );
            recoveryValue.current = raw;
        }, [workoutId]);

        useEffect(() => {
            if (recoveryValue.current !== null && !isDirty.current && recoveryKey.current) {
                if (String(value ?? '') === recoveryValue.current) {
                    try {
                        const session = editSession.current;
                        if (!session) throw new Error('Sessione iniziale della bozza non disponibile.');
                        if (!isCurrentSession(session) || !isCurrentWorkoutScope(workoutId)) {
                            throw new Error('Sessione workout cambiata prima della pulizia della bozza.');
                        }
                        observedRaw.current = writeBufferedDraft(
                            recoveryKey.current, session.owner, null,
                            session.consentGeneration, observedRaw.current,
                        );
                        // Only after the parent confirms this value do we remove
                        // this editor's independent recovery witness. Any
                        // failure preserves the remaining witness for export.
                        if (writerIntentName.current && writerIntentRaw.current) {
                            clearBufferedWriterIntent(
                                writerIntentName.current, session.owner,
                                writerIntentRaw.current, session.consentGeneration,
                            );
                            writerIntentRaw.current = null;
                        }
                        if (sourceIntent.current) {
                            clearBufferedWriterIntent(
                                sourceIntent.current.name, session.owner,
                                sourceIntent.current.raw, session.consentGeneration,
                            );
                            sourceIntent.current = null;
                        }
                        recoveryValue.current = null;
                    } catch (error) {
                        blockBufferedPersistence(error);
                    }
                }
            }
            if (!isFocused.current && !isDirty.current && recoveryValue.current === null) {
                setLocalValue(value ?? '');
                latestLocalValue.current = value ?? '';
            }
        }, [value, workoutId]);

        const flush = useCallback(() => {
            if (isDirty.current) {
                if (!isCurrentWorkoutScope(workoutId)) {
                    // The source copy is already owner+workout scoped and is
                    // preserved for recovery. Never mutate a different workout.
                    isDirty.current = false;
                    return;
                }
                const session = editSession.current;
                if (!session) throw new Error('Sessione della bozza non disponibile.');
                if (!isCurrentSession(session)) {
                    isDirty.current = false;
                    // Switching identities must not update a new owner's UI. A
                    // consent transition for the same owner, however, is a
                    // blocked recovery requiring an explicit warning.
                    const current = captureSession();
                    if (current.owner === session.owner
                        && current.consentGeneration !== session.consentGeneration) {
                        throw new Error('Consenso modificato: bozza workout precedente conservata.');
                    }
                    return;
                }
                if (useAppStore.getState().localPersistenceBlocked) {
                    throw new Error('Persistenza delle bozze del workout bloccata.');
                }
                if (recoveryKey.current) {
                    // Before promoting an in-memory edit, verify the source copy
                    // has not been invalidated or replaced by another tab.
                    assertBufferedDraftUnchanged(
                        recoveryKey.current, session.owner, observedRaw.current,
                    );
                }
                onChangeRef.current(String(latestLocalValue.current));
                isDirty.current = false;
            }
        }, [workoutId]);

        useEffect(() => {
            draftRegistry.register(flush);
            const unregisterRecovery = requiredUpdateRecoveryRegistry.register(persistRecovery);
            return () => {
                unregisterRecovery();
                draftRegistry.unregister(flush);
                try { flush(); }
                catch (error) { blockBufferedPersistence(error); }
            };
        }, [flush, persistRecovery]);

        const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setLocalValue(e.target.value);
            latestLocalValue.current = e.target.value;
            isDirty.current = true;
            try {
                persistRecovery();
            } catch (error) {
                if (!recoveryKey.current || !editSession.current || !isCurrentSession(editSession.current)) {
                    // Inputs without a stable key have always flushed to their
                    // parent on blur/unmount, but cannot guarantee PWA reload.
                    // Preserve that UI contract; the required-update capture
                    // still rejects an unsaved device draft with no key.
                    useAppStore.getState().setSaveError('Bozza non ancora protetta nello storage del dispositivo.');
                } else {
                    blockBufferedPersistence(error);
                }
            }
        };

        const handleFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
            isFocused.current = true;
            if (onFocus) onFocus(e);
        };

        const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
            isFocused.current = false;
            try {
                flush();
                if (!editSession.current || !isCurrentSession(editSession.current)
                    || !isCurrentWorkoutScope(workoutId)) return;
                if (onBlur) onBlur(e);
            } catch (error) {
                blockBufferedPersistence(error);
            }
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
