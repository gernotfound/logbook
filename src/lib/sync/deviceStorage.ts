import { requireHealthConsentWritable } from '../healthConsent';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { LocalCiphertextError, openLocalText, sealLocalText } from './secureArchiveCipher';
import { LocalVaultLockedError, readVaultControl, requireUnlockedLocalKey } from './secureArchiveSession';
import { isActiveGuestSession, storageOwner } from './session';
import { assertNoLocalPurge } from './localPurgeFence';

export const deviceKey = (name: string, owner = storageOwner()) => `logbook:v2:${owner}:${name}`;

/** Protected keys never alias the legacy plaintext namespace of suspended PWA tabs. */
export const protectedDeviceKey = (name: string, owner = storageOwner()) => {
    if (!name || name.startsWith('sealed:')) throw new Error('Chiave dispositivo protetta non valida.');
    return deviceKey('sealed:' + name, owner);
};

export function readDeviceValueStrict(name: string, owner?: string): string | null {
    const resolvedOwner = owner ?? storageOwner();
    const storageKey = deviceKey(name, resolvedOwner);
    // The device-critical read must be the first strict storage access: an
    // unreadable workout/timer cannot be masked by an earlier metadata probe.
    const legacy = readBrowserValueStrict(storageKey);
    assertNoLocalPurge(resolvedOwner);
    const control = readVaultControl(resolvedOwner);
    if (!control) {
        // Missing vault metadata cannot authorize a plaintext read, even when
        // no device snapshot currently exists. Preserve any orphaned bytes.
        if (legacy !== null || readBrowserValueStrict(protectedDeviceKey(name, resolvedOwner)) !== null) {
            throw new LocalCiphertextError();
        }
        throw new LocalVaultLockedError();
    }
    if (control.phase !== 'active') throw new LocalVaultLockedError();
    const key = requireUnlockedLocalKey(resolvedOwner);
    // A stale old PWA tab may recreate an old plaintext key. Never silently
    // discard such data or mistake it for a legitimate empty encrypted draft.
    if (legacy !== null) throw new LocalCiphertextError();
    const sealedKey = protectedDeviceKey(name, resolvedOwner);
    const raw = readBrowserValueStrict(sealedKey);
    if (requireUnlockedLocalKey(resolvedOwner) !== key) throw new LocalVaultLockedError();
    if (raw === null) return null;
    return openLocalText(key, resolvedOwner, sealedKey, raw);
}

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
