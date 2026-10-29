import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { userOwner } from './owner';

const AUTH_OWNER_HINT_KEY = 'logbook_authenticated_owner';

function assertAuthenticatedOwner(owner: string): void {
    if (!owner.startsWith('user:') || owner.length <= 5 || owner.includes('/')) {
        throw new Error('Owner autenticato locale non valido');
    }
}

export function readAuthenticatedOwnerHint(): string | null {
    const value = readBrowserValueStrict(AUTH_OWNER_HINT_KEY);
    // Only an absent key authorizes the guest fallback during unresolved Auth.
    if (value === null) return null;
    assertAuthenticatedOwner(value);
    return value;
}

export function rememberAuthenticatedOwner(uid: string): string {
    const owner = userOwner(uid);
    // Never persist an owner that the next cold boot would reject.
    assertAuthenticatedOwner(owner);
    writeBrowserValue(AUTH_OWNER_HINT_KEY, owner);
    return owner;
}

export function clearAuthenticatedOwnerHint(expectedOwner?: string): void {
    if (expectedOwner !== undefined) assertAuthenticatedOwner(expectedOwner);
    const current = readBrowserValueStrict(AUTH_OWNER_HINT_KEY);
    if (expectedOwner !== undefined && current !== expectedOwner) return;
    removeBrowserValue(AUTH_OWNER_HINT_KEY);
}
