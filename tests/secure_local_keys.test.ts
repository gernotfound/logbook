// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
    createLocalKeyVault, LocalUnlockError, recoverLocalKeyVault,
    rewrapLocalPassphrase, unlockLocalKeyVault,
} from '../src/lib/sync/secureArchiveKeys';
import { openLocalText, sealLocalText } from '../src/lib/sync/secureArchiveCipher';

const owner = 'user:test-archive-keys';
const passphrase = 'correct horse battery staple 2026';
const another = 'new passphrase with sufficient entropy';

describe('offline archive key lifecycle', () => {
    it('wraps the DEK independently for the passphrase and recovery code', async () => {
        const { vault, dataKey, recoveryCode } = await createLocalKeyVault(owner, passphrase);
        expect(JSON.stringify(vault)).not.toContain(passphrase);
        expect(JSON.stringify(vault)).not.toContain(recoveryCode);
        expect(JSON.stringify(vault)).not.toContain('averageHeartRate');
        expect(dataKey).toHaveLength(32);
        expect(recoveryCode).toMatch(/^[0-9a-f]{64}$/);
        expect(await unlockLocalKeyVault(vault, owner, passphrase)).toEqual(dataKey);
        expect(await recoverLocalKeyVault(vault, owner, recoveryCode)).toEqual(dataKey);
        const ciphertext = sealLocalText(dataKey, owner, 'data', 'averageHeartRate=143');
        expect(openLocalText(await unlockLocalKeyVault(vault, owner, passphrase), owner, 'data', ciphertext))
            .toBe('averageHeartRate=143');
    });

    it('rejects wrong passphrase/recovery code, foreign owners and weaker KDF metadata', async () => {
        const { vault, recoveryCode } = await createLocalKeyVault(owner, passphrase);
        await expect(unlockLocalKeyVault(vault, owner, another)).rejects.toBeInstanceOf(LocalUnlockError);
        await expect(recoverLocalKeyVault(vault, owner, '0'.repeat(64))).rejects.toBeInstanceOf(LocalUnlockError);
        await expect(recoverLocalKeyVault(vault, 'user:other', recoveryCode)).rejects.toBeInstanceOf(LocalUnlockError);
        await expect(unlockLocalKeyVault({ ...vault, kdf: { ...vault.kdf, iterations: 10 } }, owner, passphrase)).rejects.toBeInstanceOf(LocalUnlockError);
        await expect(unlockLocalKeyVault({ ...vault, version: 2 as never }, owner, passphrase)).rejects.toBeInstanceOf(LocalUnlockError);
    });

    it('supports atomic passphrase rewrapping without changing ciphertext or the recovery key', async () => {
        const { vault, dataKey, recoveryCode } = await createLocalKeyVault(owner, passphrase);
        const ciphertext = sealLocalText(dataKey, owner, 'data', 'offline pending journal');
        const changed = await rewrapLocalPassphrase(vault, owner, dataKey, another);
        expect(changed.recovery).toEqual(vault.recovery);
        expect(changed.kdf.salt).not.toBe(vault.kdf.salt);
        await expect(unlockLocalKeyVault(changed, owner, passphrase)).rejects.toBeInstanceOf(LocalUnlockError);
        expect(await unlockLocalKeyVault(changed, owner, another)).toEqual(dataKey);
        const recovered = await recoverLocalKeyVault(changed, owner, recoveryCode);
        expect(openLocalText(recovered, owner, 'data', ciphertext)).toBe('offline pending journal');
    });

    it('never creates a vault from an empty or weak passphrase', async () => {
        await expect(createLocalKeyVault(owner, 'short')).rejects.toThrow('16 caratteri');
        await expect(createLocalKeyVault('', passphrase)).rejects.toThrow();
    });
});
