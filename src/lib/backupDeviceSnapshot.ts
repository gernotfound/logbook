import { readDeviceValueStrict } from './sync/deviceStorageRead';
import { stableStorageKeyInventory } from './sync/stableStorageKeyInventory';

const RECOVERY_DEVICE_KEYS = new Set([
    'workout', 'timer', 'draft_exercise', 'draft_routine', 'history-editor-context',
]);
const isRecoveryDeviceKey = (name: string) =>
    RECOVERY_DEVICE_KEYS.has(name) || name.startsWith('draft:')
    || /^workout-intent:[a-f0-9]{32}$/.test(name);

// Private write-ahead witnesses and suspended editor context are included as
// raw recovery evidence only. Import never replays them as a causal journal.
function deviceRecoveryName(key: string | null, owner: string): string | null {
    const prefix = 'logbook:v2:' + owner + ':';
    if (!key?.startsWith(prefix)) return null;
    const raw = key.slice(prefix.length);
    const name = raw.startsWith('sealed:') ? raw.slice('sealed:'.length) : raw;
    return isRecoveryDeviceKey(name) ? name : null;
}

/**
 * The backup is a user-visible claim that every device recovery witness was
 * included. Scanning localStorage by a live numeric index can skip keys when
 * another tab adds/removes one, even though each individual read succeeds.
 *
 * Capture names first; validate exact physical membership and decoded values
 * after the copy. This detects observable races without claiming a
 * transactional snapshot across browser realms.
 */
export function readStableDeviceRecovery(owner: string): Record<string, string> {
    const physicalKeys = (): Set<string> => {
        const inventory = stableStorageKeyInventory('Le copie di recupero sono cambiate durante il backup. Riprova senza chiudere altre schede.');
        return new Set([...inventory].filter(key => deviceRecoveryName(key, owner) !== null));
    };
    const before = physicalKeys();
    const device: Record<string, string> = {};
    for (const physicalKey of before) {
        const name = deviceRecoveryName(physicalKey, owner)!;
        // Strict read validates owner, vault state, ciphertext and purge
        // fences; a vanished key cannot silently become an omitted witness.
        const value = readDeviceValueStrict(name, owner);
        if (value === null || Object.hasOwn(device, name)) {
            throw new Error('Le copie di recupero sono cambiate durante il backup. Riprova senza chiudere altre schede.');
        }
        device[name] = value;
    }
    const after = physicalKeys();
    if (after.size !== before.size || [...before].some(key => !after.has(key))) {
        throw new Error('Le copie di recupero sono cambiate durante il backup. Riprova senza chiudere altre schede.');
    }
    for (const physicalKey of before) {
        const name = deviceRecoveryName(physicalKey, owner)!;
        if (readDeviceValueStrict(name, owner) !== device[name]) {
            throw new Error('I valori di recupero sono cambiati durante il backup. Riprova senza chiudere altre schede.');
        }
    }
    return device;
}

export function hasDeviceRecoveryBackupSource(owner: string): boolean {
    // The existence preflight must be as race-aware as the export itself.
    // A shifting localStorage index must not hide the only recovery witness.
    return Object.keys(readStableDeviceRecovery(owner)).length > 0;
}

