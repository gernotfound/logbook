import { useState, useEffect } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
    const [storedValue, setStoredValue] = useState<T>(() => {
        const item = window.localStorage.getItem(key);
        if (item === null) return initialValue;

        try {
            return JSON.parse(item) as T;
        } catch (error) {
            // Se fallisce il parsing JSON e il valore iniziale era una stringa,
            // probabilmente è stato salvato come plain text intenzionalmente.
            if (typeof initialValue === 'string') {
                return item as unknown as T;
            }
            console.error(`Errore di parsing del localStorage key "${key}":`, error);
            return initialValue;
        }
    });

    useEffect(() => {
        try {
            if (typeof storedValue === 'string') {
                window.localStorage.setItem(key, storedValue);
            } else {
                window.localStorage.setItem(key, JSON.stringify(storedValue));
            }
        } catch (error) {
            console.error(`Errore di salvataggio nel localStorage key "${key}":`, error);
        }
    }, [key, storedValue]);

    return [storedValue, setStoredValue];
}
