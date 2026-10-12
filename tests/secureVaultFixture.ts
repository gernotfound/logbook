import { ensureLocalVaultReady } from '../src/lib/sync/secureArchiveUnlockFlow';
import { isVaultUnlocked, lockAllVaults } from '../src/lib/sync/secureArchiveSession';

/**
 * Auth and feature integration tests use the SAME in-process vault readiness
 * serializer as the production app, with genuine device-backed CryptoKeys.
 * No fake password, bypassed encryption or independent provisioning race.
 */
export async function prepareUnlockedTestArchive(owner = 'user:test-user-id'): Promise<void> {
    lockAllVaults();
    await ensureLocalVaultReady(owner);
    if (!isVaultUnlocked(owner)) throw new Error('Owner vault was not durably unlocked');
}
