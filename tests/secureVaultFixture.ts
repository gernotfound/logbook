import { createAndMigrateVault } from '../src/lib/sync/secureArchiveMigration';
import { lockAllVaults, readVaultControl, unlockVaultWithPassphrase } from '../src/lib/sync/secureArchiveSession';

/**
 * Actual encrypted owner fixture for UI tests unrelated to the vault UX.
 * Never mocks, bypasses or overrides the production unlock gate.
 * Dedicated cryptography/migration/lock suites exercise negative paths.
 */
export async function prepareUnlockedTestArchive(owner = 'user:test-user-id'): Promise<void> {
    lockAllVaults();
    const passphrase = 'real integration vault test passphrase 2026';
    const control = readVaultControl(owner);
    if (control === null) {
        await createAndMigrateVault(owner, passphrase);
    } else if (control.phase === 'active') {
        await unlockVaultWithPassphrase(owner, passphrase);
    } else {
        throw new Error('Unexpected interrupted fixture migration: test cannot continue without recovery');
    }
}
