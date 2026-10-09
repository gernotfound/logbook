import { readBrowserValue, readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { isActiveGuestSession, storageOwner } from './session';
import { assertHealthConsentWritable } from '../healthConsentRevocation';

export const deviceKey = (name: string, owner = storageOwner()) => `logbook:v2:${owner}:${name}`;
export function readDeviceValue(name: string, owner?: string): string | null {
    try {
        const resolvedOwner = owner ?? storageOwner();
        return readBrowserValue(deviceKey(name, resolvedOwner));
    } catch {
        return null;
    }
}

export function readDeviceValueStrict(name: string, owner?: string): string | null {
    const resolvedOwner = owner ?? storageOwner();
    return readBrowserValueStrict(deviceKey(name, resolvedOwner));
}
export function writeDeviceValue(name: string, value: string | null, owner?: string): void {
    // Callers decide the UI feedback; failure must not be mistaken for a successful save.
    const resolvedOwner = owner ?? storageOwner();
    // Device-critical writes bypass IndexedDB but must obey the same durable
    // guest revocation. This prevents a suspended tab's workout from returning
    // after another tab has purged it.
    if (resolvedOwner === 'guest' && !isActiveGuestSession()) {
        throw new Error('Sessione guest revocata: scrittura locale non consentita.');
    }
    assertHealthConsentWritable(resolvedOwner);
    const key = deviceKey(name, resolvedOwner);
    if (value === null) removeBrowserValue(key);
    else writeBrowserValue(key, value);
}
