import { readDeviceValueStrict, writeDeviceValue } from './sync/deviceStorage';
import { draftRegistry } from './utils/draftRegistry';

import { type BackupDeviceDraft, isPortableDeviceDraftKey } from './backupDeviceDraftSelection';
export { selectBackupDeviceDrafts } from './backupDeviceDraftSelection';

export function restoreMissingBackupDeviceDrafts(
    drafts: readonly BackupDeviceDraft[], owner: string, assertCurrent: () => void,
): { restored: number; preserved: number } {
    // The current screen may hold newer keystrokes not yet in device storage.
    assertCurrent();
    draftRegistry.flushAll({ strict: true });
    let restored = 0;
    let preserved = 0;
    for (const { name, value } of drafts) {
        assertCurrent();
        if (!isPortableDeviceDraftKey(name)) throw new Error('Chiave bozza non autorizzata.');
        if (readDeviceValueStrict(name, owner) !== null) {
            preserved += 1;
            continue;
        }
        // Synchronous owner-scoped AEAD write; do not overwrite existing
        // ciphertext or silently continue after storage/quota errors.
        writeDeviceValue(name, value, owner);
        restored += 1;
    }
    return { restored, preserved };
}
