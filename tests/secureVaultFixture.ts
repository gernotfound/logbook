import { del, get } from 'idb-keyval';
import { createAndMigrateVault } from '../src/lib/sync/secureArchiveMigration';
import { deviceVaultKeyId } from '../src/lib/sync/secureArchiveKeys';
import { vaultControlMirrorId } from '../src/lib/sync/secureArchiveControlRecovery';
import { isVaultUnlocked, lockAllVaults, readVaultControl, vaultControlKey } from '../src/lib/sync/secureArchiveSession';
import { removeBrowserValue } from '../src/lib/sync/browserStorage';
import { withGuestLifecycleLock } from '../src/lib/sync/guestLifecycleLock';
import { normalizeStorageOwner } from '../src/lib/sync/owner';

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
    if (typeof navigator === 'undefined' || !navigator.locks?.request) {
        throw new Error('Test vault cleanup requires owner-scoped Web Locks');
    }

    // Serialize the orphan check and deletion with production provisioning.
    // Without this lock, a late AuthProvider can publish a new control/key
    // after the empty-store check but before the fixture removes its mirror.
    const cleanup = () => navigator.locks.request(
        'thelogbook:secure-archive:' + owner, { mode: 'exclusive' }, async () => {
            if (!readVaultControl(owner)) return;
            if (await get<unknown>(deviceVaultKeyId(owner)) !== undefined) return;
            if (await get<unknown>('logbook:v2:' + owner) !== undefined) return;

            const prefix = 'logbook:v2:' + owner + ':sealed:';
            for (let i = 0; i < localStorage.length; i++) {
                if (localStorage.key(i)?.startsWith(prefix)) return;
            }
            // Test-only orphan cleanup. Production preserves controls on key loss.
            const mirrorId = vaultControlMirrorId(owner);
            await del(mirrorId);
            if (await get<unknown>(mirrorId) !== undefined) {
                throw new Error('Mock vault mirror cleanup failed');
            }
            removeBrowserValue(vaultControlKey(owner));
        },
    );
    if (owner === 'guest') await withGuestLifecycleLock(cleanup);
    else await cleanup();
}

export async function prepareUnlockedTestArchive(owner = 'user:test-user-id'): Promise<void> {
    owner = normalizeStorageOwner(owner);
    lockAllVaults();
    await clearEmptyOrphanedTestControl(owner);
    // A callback that was already waiting for the Web Lock can race our first
    // fixture attempt. Retry only after the same zero-ciphertext safety check.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            // The production entrypoint handles absent, migrating and active controls.
            await createAndMigrateVault(owner);
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
