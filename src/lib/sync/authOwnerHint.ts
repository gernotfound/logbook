import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { userOwner } from './owner';

const AUTH_OWNER_HINT_KEY = 'logbook_authenticated_owner';

export function readAuthenticatedOwnerHint(): string | null {
    const value = readBrowserValueStrict(AUTH_OWNER_HINT_KEY);
    if (!value) return null;
    if (!value.startsWith('user:') || value.length <= 5 || value.includes('/')) {
        throw new Error('Owner autenticato locale non valido');
    }
    return value;
}

export function rememberAuthenticatedOwner(uid: string): string {
    const owner = userOwner(uid);
    writeBrowserValue(AUTH_OWNER_HINT_KEY, owner);
    return owner;
}

export function clearAuthenticatedOwnerHint(expectedOwner?: string): void {
    const current = readBrowserValueStrict(AUTH_OWNER_HINT_KEY);
    if (expectedOwner && current && current !== expectedOwner) return;
    removeBrowserValue(AUTH_OWNER_HINT_KEY);
}
