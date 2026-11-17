import { beforeEach } from 'vitest';

// Isolated Node suites exercise IndexedDB without jsdom. The consent/ownership
// lifecycle now also uses synchronous browser storage: provide that one browser
// primitive, not the full UI setup or an application authorization bypass.
// Individual tests can still replace/stub localStorage to verify failure paths.
beforeEach(() => {
    if (typeof localStorage !== 'undefined') return;
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() { return values.size; },
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, String(value)); },
        removeItem: (key: string) => { values.delete(key); },
        clear: () => { values.clear(); },
    };
    Object.defineProperty(globalThis, 'localStorage', {
        value: storage, configurable: true, writable: true,
    });
});
