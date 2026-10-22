import { readDeviceValueStrict, writeDeviceValue } from './sync/deviceStorage';
import { draftRegistry } from './utils/draftRegistry';

const MAX_DEVICE_RECOVERY_DRAFTS = 1024;
// The backup also contains raw, owner/epoch-bound recovery witnesses. Those
// remain exportable evidence, not portable drafts: never install them into a
// new device/session merely because their names begin with "draft:".
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
const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

interface BackupDeviceDraft {
    name: string;
    value: string;
}

/**
 * The recovery section is untrusted file content, not a local vault backup.
 * Workouts, timer and the causal envelope cannot be transplanted across
 * storage generations. Only independent drafts are eligible for a guarded
 * no-overwrite restore after the business import. In particular, independent
 * buffered/dated writer intents stay in the raw backup as provenance evidence
 * and are never counted or installed as portable drafts.
 */
export function selectBackupDeviceDrafts(recovery: unknown): BackupDeviceDraft[] {
    if (recovery === null || recovery === undefined) return [];
    if (!isRecord(recovery)) throw new Error('Backup: sezione recupero non valida.');
    if (!Object.hasOwn(recovery, 'device')) return [];
    if (!isRecord(recovery.device)) throw new Error('Backup: sezione bozze di recupero non valida.');
    const entries = Object.entries(recovery.device).filter(([name]) => draftKey(name));
    if (entries.length > MAX_DEVICE_RECOVERY_DRAFTS) throw new Error('Backup: troppe bozze di recupero.');
    let total = 0;
    return entries.map(([name, value]) => {
        if (typeof value !== 'string' || value.length > 100_000) {
            throw new Error('Backup: bozza di recupero non valida.');
        }
        total += value.length;
        if (total > 1_000_000) throw new Error('Backup: bozze di recupero troppo grandi.');
        if (!name.startsWith('draft:buffered:')) {
            let decoded: unknown;
            try { decoded = JSON.parse(value); } catch { throw new Error('Backup: bozza non JSON.'); }
            if (!isRecord(decoded)) throw new Error('Backup: bozza con struttura non valida.');
        }
        return { name, value };
    });
}

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
