import { readBrowserValueStrict } from './browserStorage';
import { LocalCiphertextError, openLocalText } from './secureArchiveCipher';
import { LocalVaultLockedError, readVaultControl, requireUnlockedLocalKey } from './secureArchiveSession';
import { storageOwner } from './session';
import { assertNoLocalPurge } from './localPurgeFence';
import { deviceKey, protectedDeviceKey } from './deviceStorageKeys';

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
