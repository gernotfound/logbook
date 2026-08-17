import { useState, useEffect } from 'react';
import type { ZodType } from 'zod';

export function useLocalStorage<T>(
    key: string,
    initialValue: T,
    schema?: ZodType<T, any, any>
): [T, (value: T) => void] {
    const [storedValue, setStoredValue] = useState<T>(() => {
        const item = window.localStorage.getItem(key);
        if (item === null) return initialValue;

        try {
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
    });

    useEffect(() => {
        try {
            window.localStorage.setItem(key, JSON.stringify(storedValue));
        } catch (error) {
            console.error(`Errore di salvataggio nel localStorage key "${key}":`, error);
        }
    }, [key, storedValue]);

    return [storedValue, setStoredValue];
}
