import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalKeyVault } from '../../src/lib/sync/secureArchiveKeys';
import {
    isVaultUnlocked, LocalVaultLockedError, lockAllVaults, lockVault,
    readVaultControl, requireUnlockedLocalKey, unlockVaultWithPassphrase,
    unlockVaultWithRecoveryCode, vaultControlKey, type PersistedVaultControl,
} from '../../src/lib/sync/secureArchiveSession';

const owner = 'user:secure-session';
const passphrase = 'a long and unique offline passphrase';
let metadata: PersistedVaultControl;
let recovery: string;
let originalKey: Uint8Array;

beforeEach(async () => {
    lockAllVaults();
    localStorage.clear();
    const created = await createLocalKeyVault(owner, passphrase);
    recovery = created.recoveryCode;
    originalKey = created.dataKey;
    metadata = {
        format: 'thelogbook-local-vault-control',
        version: 1, owner, phase: 'active',
        epoch: 'a'.repeat(32), wrappedKey: created.vault,
    };
    localStorage.setItem(vaultControlKey(owner), JSON.stringify(metadata));
});

describe('owner-fenced vault capability', () => {
    it('requires a real successful offline unlock before giving out the DEK', async () => {
        expect(isVaultUnlocked(owner)).toBe(false);
        expect(() => requireUnlockedLocalKey(owner)).toThrow(LocalVaultLockedError);
        await expect(unlockVaultWithPassphrase(owner, 'incorrect passphrase')).rejects.toThrow();
        expect(isVaultUnlocked(owner)).toBe(false);
        await unlockVaultWithPassphrase(owner, passphrase);
        expect(requireUnlockedLocalKey(owner)).toEqual(originalKey);
        lockVault(owner);
        expect(isVaultUnlocked(owner)).toBe(false);
    });

    it('allows independent recovery-code unlock without any network', async () => {
        await unlockVaultWithRecoveryCode(owner, recovery);
        expect(requireUnlockedLocalKey(owner)).toEqual(originalKey);
    });

    it('fences stale tabs immediately on external epoch change', async () => {
        await unlockVaultWithPassphrase(owner, passphrase);
        localStorage.setItem(vaultControlKey(owner), JSON.stringify({ ...metadata, epoch: 'b'.repeat(32) }));
        expect(() => requireUnlockedLocalKey(owner)).toThrow(LocalVaultLockedError);
        expect(isVaultUnlocked(owner)).toBe(false);
    });

    it('rejects corrupt or future vault metadata rather than treating it as a new account', async () => {
        localStorage.setItem(vaultControlKey(owner), '{');
        expect(() => readVaultControl(owner)).toThrow(LocalVaultLockedError);
        localStorage.setItem(vaultControlKey(owner), JSON.stringify({ ...metadata, version: 2 }));
        expect(() => readVaultControl(owner)).toThrow(LocalVaultLockedError);
        localStorage.setItem(vaultControlKey(owner), JSON.stringify({ ...metadata, owner: 'user:another' }));
        expect(() => readVaultControl(owner)).toThrow(LocalVaultLockedError);
    });

    it('does not expose a normal write capability during migration', async () => {
        localStorage.setItem(vaultControlKey(owner), JSON.stringify({ ...metadata, phase: 'migrating' }));
        await expect(unlockVaultWithPassphrase(owner, passphrase)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(() => requireUnlockedLocalKey(owner)).toThrow(LocalVaultLockedError);
    });
});
