import { requireHealthConsentWritable } from '../healthConsent';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { LocalCiphertextError, openLocalText, sealLocalText } from './secureArchiveCipher';
import { LocalVaultLockedError, readVaultControl, requireUnlockedLocalKey } from './secureArchiveSession';
import { isActiveGuestSession, storageOwner } from './session';
import { assertNoLocalPurge } from './localPurgeFence';
import { deviceKey, protectedDeviceKey } from './deviceStorageKeys';
export { deviceKey, protectedDeviceKey } from './deviceStorageKeys';

export { readDeviceValueStrict } from './deviceStorageRead';

export function writeDeviceValue(name: string, value: string | null, owner?: string): void {
    // Callers decide the UI feedback; failure must not be mistaken for a successful save.
    const resolvedOwner = owner ?? storageOwner();
    assertNoLocalPurge(resolvedOwner);
    if (resolvedOwner === 'guest' && !isActiveGuestSession()) {
        throw new Error('Sessione guest revocata: scrittura locale non consentita.');
    }
    if (value !== null) requireHealthConsentWritable(resolvedOwner);
    const storageKey = deviceKey(name, resolvedOwner);
    const control = readVaultControl(resolvedOwner);
    if (!control) {
        // Strictly inspect both destinations before reporting a missing vault.
        // A failed read or surviving ciphertext/plaintext must never be
        // interpreted as permission to replace or delete the only device copy.
        if (readBrowserValueStrict(storageKey) !== null
            || readBrowserValueStrict(protectedDeviceKey(name, resolvedOwner)) !== null) {
            throw new LocalCiphertextError();
        }
        throw new LocalVaultLockedError();
    }
    if (control.phase !== 'active') throw new LocalVaultLockedError();
    const key = requireUnlockedLocalKey(resolvedOwner);
    // Stale PWA tabs can still create plaintext keys: preserve the conflicting
    // bytes rather than hiding them behind a new encrypted snapshot.
    if (readBrowserValueStrict(storageKey) !== null) throw new LocalCiphertextError();
    const sealedKey = protectedDeviceKey(name, resolvedOwner);
    const previous = readBrowserValueStrict(sealedKey);
    // An unreadable/tampered draft may not be overwritten or deleted.
    if (previous !== null) openLocalText(key, resolvedOwner, sealedKey, previous);
    if (requireUnlockedLocalKey(resolvedOwner) !== key) throw new LocalVaultLockedError();
    if (value === null) removeBrowserValue(sealedKey);
    else writeBrowserValue(sealedKey, sealLocalText(key, resolvedOwner, sealedKey, value));
    if (requireUnlockedLocalKey(resolvedOwner) !== key) throw new LocalVaultLockedError();
}
