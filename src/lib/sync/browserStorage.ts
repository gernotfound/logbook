export class BrowserStorageError extends Error {
    readonly operation: 'read' | 'write' | 'remove';
    readonly key: string;
    readonly cause: unknown;

    constructor(operation: 'read' | 'write' | 'remove', key: string, cause: unknown) {
        super(`Browser storage ${operation} failed for "${key}".`);
        this.name = 'BrowserStorageError';
        this.operation = operation;
        this.key = key;
        this.cause = cause;
    }
}

function storage(): Storage {
    if (typeof localStorage === 'undefined') {
        throw new BrowserStorageError('read', '<storage>', new Error('localStorage unavailable'));
    }
    return localStorage;
}

export function readBrowserValueStrict(key: string): string | null {
    try {
        return storage().getItem(key);
    } catch (error) {
        if (error instanceof BrowserStorageError) throw error;
        throw new BrowserStorageError('read', key, error);
    }
}

/**
 * Best-effort reads are for hints/preferences only. Security/lifecycle gates that
 * must distinguish "missing" from "unreadable" use readBrowserValueStrict().
 */
export function readBrowserValue(key: string): string | null {
    try {
        return readBrowserValueStrict(key);
    } catch {
        return null;
    }
}

export function writeBrowserValue(key: string, value: string): void {
    try {
        storage().setItem(key, value);
    } catch (error) {
        if (error instanceof BrowserStorageError) throw error;
        throw new BrowserStorageError('write', key, error);
    }
}

export function writeBrowserJson(key: string, value: unknown): void {
    let serialized: string;
    try {
        serialized = JSON.stringify(value);
    } catch (error) {
        throw new BrowserStorageError('write', key, error);
    }
    writeBrowserValue(key, serialized);
}

export function removeBrowserValue(key: string): void {
    try {
        storage().removeItem(key);
    } catch (error) {
        if (error instanceof BrowserStorageError) throw error;
        throw new BrowserStorageError('remove', key, error);
    }
}

export function tryWriteBrowserValue(key: string, value: string): boolean {
    try {
        writeBrowserValue(key, value);
        return true;
    } catch {
        return false;
    }
}

export function tryRemoveBrowserValue(key: string): boolean {
    try {
        removeBrowserValue(key);
        return true;
    } catch {
        return false;
    }
}
