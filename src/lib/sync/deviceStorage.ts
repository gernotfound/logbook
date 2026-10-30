import { requireHealthConsentWritable } from '../healthConsent';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { LocalCiphertextError, openLocalText, sealLocalText } from './secureArchiveCipher';
import { LocalVaultLockedError, readVaultControl, requireUnlockedLocalKey } from './secureArchiveSession';
import { isActiveGuestSession, storageOwner } from './session';
import { assertNoLocalPurge } from './localPurgeFence';

export const deviceKey = (name: string, owner = storageOwner()) => `logbook:v2:${owner}:${name}`;

/** Separate authenticated device snapshots from unencrypted owner metadata. */
export const protectedDeviceKey = (name: string, owner = storageOwner()) => {
    if (!name || name.startsWith('sealed:')) throw new Error('Chiave dispositivo protetta non valida.');
    return deviceKey('sealed:' + name, owner);
};

export function readDeviceValueStrict(name: string, owner?: string): string | null {
    const resolvedOwner = owner ?? storageOwner();
    const storageKey = deviceKey(name, resolvedOwner);
    // The device-critical read must be the first strict storage access: an
    // unreadable workout/timer cannot be masked by an earlier metadata probe.
    const unsealed = readBrowserValueStrict(storageKey);
    assertNoLocalPurge(resolvedOwner);
    const control = readVaultControl(resolvedOwner);
    // A missing control is never permission to read device-critical plaintext,
    // even if a pre-launch record is still present.
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
    // Callers decide the UI feedback; failure must not be mistaken for a successful save.
    const resolvedOwner = owner ?? storageOwner();
    assertNoLocalPurge(resolvedOwner);
    if (resolvedOwner === 'guest' && !isActiveGuestSession()) {
        throw new Error('Sessione guest revocata: scrittura locale non consentita.');
    }
    if (value !== null) requireHealthConsentWritable(resolvedOwner);
    const control = readVaultControl(resolvedOwner);
    if (!control || control.phase !== 'active') throw new LocalVaultLockedError();
    const key = requireUnlockedLocalKey(resolvedOwner);
    // An unexpected unsealed record may be a suspended writer's only copy.
    // Preserve it and refuse to modify the authenticated snapshot.
    if (readBrowserValueStrict(deviceKey(name, resolvedOwner)) !== null) throw new LocalCiphertextError();
    const sealedKey = protectedDeviceKey(name, resolvedOwner);
    const previous = readBrowserValueStrict(sealedKey);
    // Authenticate existing bytes before replacing or deleting them.
    if (previous !== null) openLocalText(key, resolvedOwner, sealedKey, previous);
    if (requireUnlockedLocalKey(resolvedOwner) !== key) throw new LocalVaultLockedError();
    if (value === null) removeBrowserValue(sealedKey);
    else writeBrowserValue(sealedKey, sealLocalText(key, resolvedOwner, sealedKey, value));
    if (requireUnlockedLocalKey(resolvedOwner) !== key) throw new LocalVaultLockedError();
}
