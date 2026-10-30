import { requireHealthConsentWritable } from '../healthConsent';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { LocalCiphertextError, openLocalText, sealLocalText } from './secureArchiveCipher';
import { LocalVaultLockedError, readVaultControl, requireUnlockedLocalKey } from './secureArchiveSession';
import { isActiveGuestSession, storageOwner } from './session';
import { assertNoLocalPurge } from './localPurgeFence';

export const deviceKey = (name: string, owner = storageOwner()) => `logbook:v2:${owner}:${name}`;

/** Owner-scoped ciphertext lives apart from retired unsealed keys. */
export const protectedDeviceKey = (name: string, owner = storageOwner()) => {
    if (!name || name.startsWith('sealed:')) throw new Error('Chiave dispositivo protetta non valida.');
    return deviceKey('sealed:' + name, owner);
};

export function readDeviceValueStrict(name: string, owner?: string): string | null {
    const resolvedOwner = owner ?? storageOwner();
    const storageKey = deviceKey(name, resolvedOwner);
    // Inspect the unsealed key first: an unavailable workout/timer read must
    // not be mistaken for absence, even if vault metadata also disappeared.
    const unsealed = readBrowserValueStrict(storageKey);
    assertNoLocalPurge(resolvedOwner);
    const control = readVaultControl(resolvedOwner);
    // An absent or half-provisioned vault never authorizes reading pre-launch
    // plaintext or returning null (which callers could treat as safe to write).
    if (!control || control.phase !== 'active') throw new LocalVaultLockedError();
    const key = requireUnlockedLocalKey(resolvedOwner);
    if (unsealed !== null) throw new LocalCiphertextError();
    const sealedKey = protectedDeviceKey(name, resolvedOwner);
    const raw = readBrowserValueStrict(sealedKey);
    if (requireUnlockedLocalKey(resolvedOwner) !== key) throw new LocalVaultLockedError();
    if (raw === null) return null;
    return openLocalText(key, resolvedOwner, sealedKey, raw);
}

export function writeDeviceValue(name: string, value: string | null, owner?: string): void {
    const resolvedOwner = owner ?? storageOwner();
    assertNoLocalPurge(resolvedOwner);
    if (resolvedOwner === 'guest' && !isActiveGuestSession()) {
        throw new Error('Sessione guest revocata: scrittura locale non consentita.');
    }
    if (value !== null) requireHealthConsentWritable(resolvedOwner);
    const control = readVaultControl(resolvedOwner);
    if (!control || control.phase !== 'active') throw new LocalVaultLockedError();
    const key = requireUnlockedLocalKey(resolvedOwner);
    // Preserve unexpected unsealed data rather than overwriting its ciphertext.
    if (readBrowserValueStrict(deviceKey(name, resolvedOwner)) !== null) throw new LocalCiphertextError();
    const sealedKey = protectedDeviceKey(name, resolvedOwner);
    const previous = readBrowserValueStrict(sealedKey);
    // Authenticate before either replacement or deletion. Storage failures
    // remain exceptions, not evidence that the stored value is absent.
    if (previous !== null) openLocalText(key, resolvedOwner, sealedKey, previous);
    if (requireUnlockedLocalKey(resolvedOwner) !== key) throw new LocalVaultLockedError();
    if (value === null) removeBrowserValue(sealedKey);
    else writeBrowserValue(sealedKey, sealLocalText(key, resolvedOwner, sealedKey, value));
    if (requireUnlockedLocalKey(resolvedOwner) !== key) throw new LocalVaultLockedError();
}
