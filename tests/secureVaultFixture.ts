import { get } from 'idb-keyval';
import { createAndMigrateVault, resumeVaultMigration } from '../src/lib/sync/secureArchiveMigration';
import { deviceVaultKeyId } from '../src/lib/sync/secureArchiveKeys';
import { isVaultUnlocked, lockAllVaults, readVaultControl, unlockVaultForOwner, vaultControlKey } from '../src/lib/sync/secureArchiveSession';
import { removeBrowserValue } from '../src/lib/sync/browserStorage';

/**
 * Provision a genuine encrypted owner archive for UI tests.
 * The common Vitest setup clears mocked IndexedDB at each test boundary.
 * A late async callback from a previous mounted AuthProvider may subsequently
 * publish a valid-looking vault control to shared localStorage, WITHOUT its
 * wrapping key (because the idb-keyval mock was cleared).
 *
 * Repair ONLY this empty test-fixture orphan. The production code deliberately
 * fails closed if a device key is missing and never recreates it. If ANY owner
 * archive or sealed device snapshot exists, retain both and surface the error.
 */
async function clearEmptyOrphanedTestControl(owner: string): Promise<void> {
    if (!readVaultControl(owner)) return;
    if (await get<unknown>(deviceVaultKeyId(owner)) !== undefined) return;
    if (await get<unknown>('logbook:v2:' + owner) !== undefined) return;

    const prefix = 'logbook:v2:' + owner + ':sealed:';
    for (let i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i)?.startsWith(prefix)) return;
    }
    removeBrowserValue(vaultControlKey(owner));
}

export async function prepareUnlockedTestArchive(owner = 'user:test-user-id'): Promise<void> {
    lockAllVaults();
    await clearEmptyOrphanedTestControl(owner);
    // A callback that was already waiting for the Web Lock can race our first
    // fixture attempt. Retry only after the same zero-ciphertext safety check.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const control = readVaultControl(owner);
            if (!control) await createAndMigrateVault(owner);
            else if (control.phase === 'migrating') await resumeVaultMigration(owner);
            else await unlockVaultForOwner(owner);
            if (!isVaultUnlocked(owner)) throw new Error('Owner vault was not durably unlocked');
            return;
        } catch (error) {
            if (attempt !== 0) throw error;
            const before = readVaultControl(owner);
            await clearEmptyOrphanedTestControl(owner);
            // A missing key with ciphertext or a non-orphan error still fails.
            if (!before || readVaultControl(owner) !== null) throw error;
        }
    }
}
