import { readDeviceValueStrict, writeDeviceValue } from './sync/deviceStorage';
import { draftRegistry } from './utils/draftRegistry';

import { type BackupDeviceDraft } from './backupDeviceDraftSelection';
export { selectBackupDeviceDrafts } from './backupDeviceDraftSelection';

const draftKey = (name: string): boolean => {
    if (name === 'draft_exercise' || name === 'draft_routine') return true;
    const match = /^draft:([a-z0-9-]+):([a-zA-Z0-9_.:-]{1,128})$/.exec(name);
    if (!match) return false;
    const [, kind, target] = match;
    if (kind === 'pre-session' || kind === 'post-session') return true;
    if (kind === 'measurement' || kind === 'sleep' || kind === 'activity-steps') return true;
    if (kind.startsWith('activity-cardio-') && kind.length > 'activity-cardio-'.length) return true;
    return kind === 'buffered' && /^(input|textarea):[a-zA-Z0-9_.:-]{1,128}$/.test(target);
};

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
        if (!draftKey(name)) throw new Error('Chiave bozza non autorizzata.');
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
