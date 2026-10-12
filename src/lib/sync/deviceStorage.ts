import { requireHealthConsentWritable } from '../healthConsent';
import { readBrowserValue, readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { LocalCiphertextError, openLocalText, sealLocalText, SEALED_LOCAL_PREFIX } from './secureArchiveCipher';
import { LocalVaultLockedError, readVaultControl, requireUnlockedLocalKey } from './secureArchiveSession';
import { isActiveGuestSession, storageOwner } from './session';

export const deviceKey = (name: string, owner = storageOwner()) => `logbook:v2:${owner}:${name}`;

export function readDeviceValue(name: string, owner?: string): string | null {
    try {
        return readDeviceValueStrict(name, owner);
    } catch (error) {
        // An unavailable or tampered ENCRYPTED record must not look like an
        // empty draft/workout: that could silently erase the only local copy.
        if (error instanceof LocalVaultLockedError || error instanceof LocalCiphertextError) throw error;
        return null;
    }
}

export function readDeviceValueStrict(name: string, owner?: string): string | null {
    const resolvedOwner = owner ?? storageOwner();
    const storageKey = deviceKey(name, resolvedOwner);
    const control = readVaultControl(resolvedOwner);
    if (!control) {
        const raw = readBrowserValueStrict(storageKey);
        if (raw?.startsWith(SEALED_LOCAL_PREFIX)) throw new LocalCiphertextError();
        return raw;
    }
    if (control.phase !== 'active') throw new LocalVaultLockedError();
    const key = requireUnlockedLocalKey(resolvedOwner);
    const raw = readBrowserValueStrict(storageKey);
    if (requireUnlockedLocalKey(resolvedOwner) !== key) throw new LocalVaultLockedError();
    if (raw === null) return null;
    return openLocalText(key, resolvedOwner, storageKey, raw);
}

export function writeDeviceValue(name: string, value: string | null, owner?: string): void {
    // Callers decide the UI feedback; failure must not be mistaken for a successful save.
    const resolvedOwner = owner ?? storageOwner();
    if (resolvedOwner === 'guest' && !isActiveGuestSession()) {
        throw new Error('Sessione guest revocata: scrittura locale non consentita.');
    }
    if (value !== null) requireHealthConsentWritable(resolvedOwner);
    const storageKey = deviceKey(name, resolvedOwner);
    const control = readVaultControl(resolvedOwner);
    if (control) {
        if (control.phase !== 'active') throw new LocalVaultLockedError();
        const key = requireUnlockedLocalKey(resolvedOwner);
        if (value === null) removeBrowserValue(storageKey);
        else writeBrowserValue(storageKey, sealLocalText(key, resolvedOwner, storageKey, value));
        if (requireUnlockedLocalKey(resolvedOwner) !== key) throw new LocalVaultLockedError();
        return;
    }

    // Pre-provisioning legacy path, to be retired after every device has passed
    // the secure vault setup. A ciphertext without control metadata is invalid.
    if (readBrowserValue(storageKey)?.startsWith(SEALED_LOCAL_PREFIX)) throw new LocalCiphertextError();
    if (value === null) removeBrowserValue(storageKey);
    else writeBrowserValue(storageKey, value);
}
