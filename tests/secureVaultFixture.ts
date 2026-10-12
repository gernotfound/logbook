import { createAndMigrateVault, resumeVaultMigration } from '../src/lib/sync/secureArchiveMigration';
import { isVaultUnlocked, lockAllVaults, readVaultControl, unlockVaultForOwner } from '../src/lib/sync/secureArchiveSession';

/**
 * Provision a genuine encrypted owner archive for an isolated integration test.
 * Unlike the interactive application gate, a failing fixture must reject:
 * waiting for an on-screen Recovery/Retry prompt would hang the test and hide
 * the actual migration or key error behind a timeout.
 */
export async function prepareUnlockedTestArchive(owner = 'user:test-user-id'): Promise<void> {
    lockAllVaults();
    const control = readVaultControl(owner);
    if (!control) await createAndMigrateVault(owner);
    else if (control.phase === 'migrating') await resumeVaultMigration(owner);
    else await unlockVaultForOwner(owner);
    if (!isVaultUnlocked(owner)) throw new Error('Owner vault was not durably unlocked');
}
