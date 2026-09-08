import React, { useState, useEffect, useCallback, useRef } from 'react';
import { draftRegistry } from '../../lib/utils/draftRegistry';

interface BufferedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
    value: string | number | undefined;
    onChange: (value: string) => void;
}

export const BufferedInput = React.forwardRef<HTMLInputElement, BufferedInputProps>(
    ({ value, onChange, onBlur, onFocus, onKeyDown, type, inputMode, ...props }, ref) => {
        const [localValue, setLocalValue] = useState(value ?? '');
        const isDirty = useRef(false);
        const isFocused = useRef(false);
        const latestLocalValue = useRef(localValue);
        latestLocalValue.current = localValue;
        
        const onChangeRef = useRef(onChange);
        onChangeRef.current = onChange;
        const typeRef = useRef(type);
        typeRef.current = type;
        const inputModeRef = useRef(inputMode);
        inputModeRef.current = inputMode;

        // Sync from external value if not focused or dirty
        useEffect(() => {
            if (!isFocused.current && !isDirty.current) {
                setLocalValue(value ?? '');
                latestLocalValue.current = value ?? '';
            }
        }, [value]);

        const flush = useCallback(() => {
            if (isDirty.current) {
                let finalVal = String(latestLocalValue.current);
                if (typeRef.current === 'number' || inputModeRef.current === 'decimal') {
                    finalVal = finalVal.replace(',', '.');
                }
                onChangeRef.current(finalVal);
                isDirty.current = false;
            }
        }, []);

        useEffect(() => {
            draftRegistry.register(flush);
            return () => draftRegistry.unregister(flush);
        }, [flush]);

        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            setLocalValue(e.target.value);
            latestLocalValue.current = e.target.value;
            isDirty.current = true;
        };

        const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
            isFocused.current = true;
            if (onFocus) {
                onFocus(e);
            }
        };

        const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
            isFocused.current = false;
            flush();
            if (onBlur) {
                onBlur(e);
            }
        };

        const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                flush();
                e.currentTarget.blur();
            }
            if (onKeyDown) {
                onKeyDown(e);
            }
        };

        return (
            <input
                ref={ref}
                {...props}
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
    ({ value, onChange, onBlur, onFocus, onKeyDown, ...props }, ref) => {
        const [localValue, setLocalValue] = useState(value ?? '');
        const isDirty = useRef(false);
        const isFocused = useRef(false);
        const latestLocalValue = useRef(localValue);
        latestLocalValue.current = localValue;
        
        const onChangeRef = useRef(onChange);
        onChangeRef.current = onChange;

        useEffect(() => {
            if (!isFocused.current && !isDirty.current) {
                setLocalValue(value ?? '');
                latestLocalValue.current = value ?? '';
            }
        }, [value]);

        const flush = useCallback(() => {
            if (isDirty.current) {
                onChangeRef.current(String(latestLocalValue.current));
                isDirty.current = false;
            }
        }, []);

        useEffect(() => {
            draftRegistry.register(flush);
            return () => draftRegistry.unregister(flush);
        }, [flush]);

        const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setLocalValue(e.target.value);
            latestLocalValue.current = e.target.value;
            isDirty.current = true;
        };

        const handleFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
            isFocused.current = true;
            if (onFocus) {
                onFocus(e);
            }
        };

        const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
            isFocused.current = false;
            flush();
            if (onBlur) {
                onBlur(e);
            }
        };

        return (
            <textarea
                ref={ref}
                {...props}
                value={localValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
            />
        );
    }
);

BufferedTextarea.displayName = 'BufferedTextarea';
