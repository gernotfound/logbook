import { requireHealthConsentWritable } from '../healthConsent';
import { readBrowserValue, readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { LocalCiphertextError, openLocalText, sealLocalText, SEALED_LOCAL_PREFIX } from './secureArchiveCipher';
import { LocalVaultLockedError, readVaultControl, requireUnlockedLocalKey } from './secureArchiveSession';
import { isActiveGuestSession, storageOwner } from './session';
import { assertNoLocalPurge, LocalPurgePendingError } from './localPurgeFence';

export const deviceKey = (name: string, owner = storageOwner()) => `logbook:v2:${owner}:${name}`;

/** Protected keys never alias the legacy plaintext namespace of suspended PWA tabs. */
export const protectedDeviceKey = (name: string, owner = storageOwner()) => {
    if (!name || name.startsWith('sealed:')) throw new Error('Chiave dispositivo protetta non valida.');
    return deviceKey('sealed:' + name, owner);
};

export function readDeviceValue(name: string, owner?: string): string | null {
    try {
        return readDeviceValueStrict(name, owner);
    } catch (error) {
        // An unavailable or tampered ENCRYPTED record must not look like an
        // empty draft/workout: that could silently erase the only local copy.
        if (error instanceof LocalVaultLockedError || error instanceof LocalCiphertextError
            || error instanceof LocalPurgePendingError) throw error;
        // Legacy best-effort draft reads may still treat transient storage
        // failures as absent, but a provisioned sealed vault must NEVER do so:
        // a follow-up write could overwrite a newer encrypted draft.
        if (readVaultControl(owner ?? storageOwner()) !== null) throw error;
        return null;
    }
}

export function readDeviceValueStrict(name: string, owner?: string): string | null {
    const resolvedOwner = owner ?? storageOwner();
    const storageKey = deviceKey(name, resolvedOwner);
    // The device-critical read must be the first strict storage access: an
    // unreadable workout/timer cannot be masked by an earlier metadata probe.
    const legacy = readBrowserValueStrict(storageKey);
    assertNoLocalPurge(resolvedOwner);
    const control = readVaultControl(resolvedOwner);
    if (!control) {
        if (legacy?.startsWith(SEALED_LOCAL_PREFIX)) throw new LocalCiphertextError();
        return legacy;
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
    if (control) {
        if (control.phase !== 'active') throw new LocalVaultLockedError();
        const key = requireUnlockedLocalKey(resolvedOwner);
        // Legacy keys can reappear from pre-migration tabs. Block rather than
        // overwrite a newer draft or lose unacknowledged legacy edits.
        if (readBrowserValueStrict(storageKey) !== null) throw new LocalCiphertextError();
        const sealedKey = protectedDeviceKey(name, resolvedOwner);
        const previous = readBrowserValueStrict(sealedKey);
        // A failed draft read must not make an unreadable ciphertext overwriteable.
        // Authenticate the existing bytes before *either* replacement or deletion.
        if (previous !== null) openLocalText(key, resolvedOwner, sealedKey, previous);
        if (requireUnlockedLocalKey(resolvedOwner) !== key) throw new LocalVaultLockedError();
        if (value === null) removeBrowserValue(sealedKey);
        else writeBrowserValue(sealedKey, sealLocalText(key, resolvedOwner, sealedKey, value));
        if (requireUnlockedLocalKey(resolvedOwner) !== key) throw new LocalVaultLockedError();
        return;
    }

    // Pre-provisioning legacy path, to be retired after every device has passed
    // the secure vault setup. A ciphertext without control metadata is invalid.
    if (readBrowserValue(storageKey)?.startsWith(SEALED_LOCAL_PREFIX)) throw new LocalCiphertextError();
    if (value === null) removeBrowserValue(storageKey);
    else writeBrowserValue(storageKey, value);
}
