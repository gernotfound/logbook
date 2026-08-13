import { useState, useEffect } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? (JSON.parse(item) as T) : initialValue;
        } catch (error) {
            console.error(`Errore di parsing del localStorage key "${key}":`, error);
            // Fallback to string if not JSON
            const item = window.localStorage.getItem(key);
            if (item !== null && typeof initialValue === 'string') {
                return item as unknown as T;
            }
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
