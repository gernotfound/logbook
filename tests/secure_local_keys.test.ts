// @vitest-environment node
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { clear, del, get } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalKeyVault, deviceVaultKeyId, LocalUnlockError, unlockLocalKeyVault } from '../src/lib/sync/secureArchiveKeys';
import { openLocalText, sealLocalText } from '../src/lib/sync/secureArchiveCipher';

const owner = 'user:test-archive-keys';

beforeEach(async () => {
    vi.stubGlobal('crypto', webcrypto);
    await clear();
});

describe('automatic account-bound device encryption key', () => {
    it('creates a non-extractable AES-256 device key and resumes decryption offline', async () => {
        const { vault, dataKey } = await createLocalKeyVault(owner);
        const deviceKey = await get<CryptoKey>(deviceVaultKeyId(owner));
        expect(deviceKey?.type).toBe('secret');
        expect(deviceKey?.extractable).toBe(false);
        expect(deviceKey?.usages).toContain('decrypt');
        await expect(crypto.subtle.exportKey('raw', deviceKey!)).rejects.toThrow();
        expect(JSON.stringify(vault)).not.toContain('fitness');
        expect(vault.owner).toBe(owner);
        expect(await unlockLocalKeyVault(vault, owner)).toEqual(dataKey);
        const ciphertext = sealLocalText(dataKey, owner, 'journal', 'heartRate=147');
        expect(openLocalText(await unlockLocalKeyVault(vault, owner), owner, 'journal', ciphertext)).toBe('heartRate=147');
    });

    it('does not derive a key from a UID, Firebase token, API key or additional password', async () => {
        const first = await createLocalKeyVault(owner);
        const second = await createLocalKeyVault('user:another-account');
        expect(first.vault.wrappedDek).not.toBe(second.vault.wrappedDek);
        await expect(unlockLocalKeyVault(first.vault, 'user:another-account')).rejects.toBeInstanceOf(LocalUnlockError);
        expect(JSON.stringify(first.vault)).not.toContain('password');
    });

    it('fails closed if the device key is lost, or the wrapped DEK is tampered with', async () => {
        const { vault } = await createLocalKeyVault(owner);
        await expect(unlockLocalKeyVault({ ...vault, wrappedDek: 'ff'.repeat(48) }, owner)).rejects.toBeInstanceOf(LocalUnlockError);
        await del(deviceVaultKeyId(owner));
        await expect(unlockLocalKeyVault(vault, owner)).rejects.toBeInstanceOf(LocalUnlockError);
        expect(vault.wrappedDek).toMatch(/^[0-9a-f]+$/);
    });

    it('rejects unknown versions or foreign owner metadata rather than silently reprovisioning', async () => {
        const { vault } = await createLocalKeyVault(owner);
        await expect(unlockLocalKeyVault({ ...vault, version: 3 as never }, owner)).rejects.toBeInstanceOf(LocalUnlockError);
        await expect(unlockLocalKeyVault({ ...vault, owner: 'user:foreign' }, owner)).rejects.toBeInstanceOf(LocalUnlockError);
    });
});
