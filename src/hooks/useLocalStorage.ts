import { useState, useEffect } from 'react';
import type { ZodType } from 'zod';

export function useLocalStorage<T>(
    key: string,
    initialValue: T,
    schema?: ZodType<T, any, any>
): [T, (value: T) => void] {
    const readStoredValue = (): T => {
        try {
            const item = window.localStorage.getItem(key);
            if (item === null) return initialValue;
            const parsed = JSON.parse(item);

            if (schema) {
                const parseResult = schema.safeParse(parsed);
                if (!parseResult.success) {
                    console.warn(`Errore di validazione schema per localStorage key "${key}":`, parseResult.error);
                    return initialValue;
                }
                return parseResult.data;
            }

            return parsed as T;
        } catch (error) {
            console.error(`Errore di parsing del localStorage key "${key}":`, error);
            return initialValue;
        }
    };
    const [stored, setStored] = useState(() => ({ key, value: readStoredValue() }));
    if (stored.key !== key) setStored({ key, value: readStoredValue() });

    useEffect(() => {
        if (stored.key !== key) return;
        try {
            window.localStorage.setItem(key, JSON.stringify(stored.value));
        } catch (error) {
            console.error(`Errore di salvataggio nel localStorage key "${key}":`, error);
        }
    }, [key, stored]);

    return [stored.value, value => setStored({ key, value })];
}
