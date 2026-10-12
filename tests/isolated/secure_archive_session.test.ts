import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clear } from 'idb-keyval';
import { createLocalKeyVault } from '../../src/lib/sync/secureArchiveKeys';
import { activateGuestSession, revokeGuestSession, GUEST_SESSION_KEY, GUEST_REVOCATION_KEY } from '../../src/lib/sync/session';
import {
    isVaultUnlocked, LocalVaultLockedError, lockAllVaults, lockVault,
    readVaultControl, requireUnlockedLocalKey, unlockVaultForOwner,
    vaultControlKey, type PersistedVaultControl,
} from '../../src/lib/sync/secureArchiveSession';

const owner = 'user:secure-session';
let metadata: PersistedVaultControl;
let originalKey: Uint8Array;

beforeEach(async () => {
    lockAllVaults();
    localStorage.clear();
    await clear();
    const created = await createLocalKeyVault(owner);
    originalKey = created.dataKey;
    metadata = {
        format: 'thelogbook-local-vault-control',
        version: 2, owner, phase: 'active',
        epoch: 'a'.repeat(32), wrappedKey: created.vault,
    };
    localStorage.setItem(vaultControlKey(owner), JSON.stringify(metadata));
});

describe('automatic owner-fenced vault capability', () => {
    it('requires initialization before access, then restores DEK without any user password or network', async () => {
        expect(isVaultUnlocked(owner)).toBe(false);
        expect(() => requireUnlockedLocalKey(owner)).toThrow(LocalVaultLockedError);
        await unlockVaultForOwner(owner);
        expect(requireUnlockedLocalKey(owner)).toEqual(originalKey);
        lockVault(owner);
        expect(isVaultUnlocked(owner)).toBe(false);
        await unlockVaultForOwner(owner);
        expect(requireUnlockedLocalKey(owner)).toEqual(originalKey);
    });

    it('fences the old tab on owner epoch changes', async () => {
        await unlockVaultForOwner(owner);
        localStorage.setItem(vaultControlKey(owner), JSON.stringify({ ...metadata, epoch: 'b'.repeat(32) }));
        expect(() => requireUnlockedLocalKey(owner)).toThrow(LocalVaultLockedError);
        expect(isVaultUnlocked(owner)).toBe(false);
    });

    it('rejects malformed, future or other-owner metadata', () => {
        localStorage.setItem(vaultControlKey(owner), '{');
        expect(() => readVaultControl(owner)).toThrow(LocalVaultLockedError);
        localStorage.setItem(vaultControlKey(owner), JSON.stringify({ ...metadata, version: 3 }));
        expect(() => readVaultControl(owner)).toThrow(LocalVaultLockedError);
        localStorage.setItem(vaultControlKey(owner), JSON.stringify({ ...metadata, owner: 'user:another' }));
        expect(() => readVaultControl(owner)).toThrow(LocalVaultLockedError);
    });

    it('revokes a resident guest DEK for an expired/replaced guest generation', async () => {
        const guest = await createLocalKeyVault('guest');
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'session-older');
        localStorage.removeItem(GUEST_REVOCATION_KEY);
        activateGuestSession('session-older');
        localStorage.setItem(vaultControlKey('guest'), JSON.stringify({
            format: 'thelogbook-local-vault-control', version: 2, owner: 'guest',
            phase: 'active', epoch: 'c'.repeat(32), wrappedKey: guest.vault,
        }));
        await unlockVaultForOwner('guest');
        expect(requireUnlockedLocalKey('guest')).toEqual(guest.dataKey);
        localStorage.setItem(GUEST_SESSION_KEY, 'session-newer');
        activateGuestSession('session-newer');
        expect(() => requireUnlockedLocalKey('guest')).toThrow(LocalVaultLockedError);
        await unlockVaultForOwner('guest');
        expect(isVaultUnlocked('guest')).toBe(true);
        revokeGuestSession();
        expect(() => requireUnlockedLocalKey('guest')).toThrow(LocalVaultLockedError);
        expect(isVaultUnlocked('guest')).toBe(false);
    });

    it('does not expose ordinary writes during a partial migration', async () => {
        localStorage.setItem(vaultControlKey(owner), JSON.stringify({ ...metadata, phase: 'migrating' }));
        await expect(unlockVaultForOwner(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(() => requireUnlockedLocalKey(owner)).toThrow(LocalVaultLockedError);
    });
});
