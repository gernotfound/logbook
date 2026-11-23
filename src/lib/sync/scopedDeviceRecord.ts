import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { deviceKey, protectedDeviceKey } from './deviceStorageKeys';
import { assertNoLocalPurge } from './localPurgeFence';
import { LocalCiphertextError, openLocalText, sealLocalText } from './secureArchiveCipher';
import { unlockLocalKeyVault } from './secureArchiveKeys';
import { LocalVaultLockedError, readVaultControl } from './secureArchiveSession';

/** One namespaced device record, accessible only while the verified editor owns its lock. */
export function openScopedDeviceRecord(owner: string, name: string, permitted: () => boolean) {
    const legacyKey = deviceKey(name, owner);
    const sealedKey = protectedDeviceKey(name, owner);
    const locks = navigator.locks;
    return new Promise<{
        read: () => { raw: string | null; plaintext: string | null };
        replace: (expectedRaw: string | null, plaintext: string | null) => string | null;
        close: () => void;
    }>((resolve, reject) => {
        if (!locks?.request || !permitted()) throw new LocalVaultLockedError();
        void locks.request(sealedKey, { mode: 'exclusive', ifAvailable: true }, async lock => {
            if (!lock) throw new Error('La bozza è aperta in un’altra scheda.');
            assertNoLocalPurge(owner);
            const vault = readVaultControl(owner);
            if (!permitted() || !vault || vault.phase !== 'active') throw new LocalVaultLockedError();
            const witness = JSON.stringify(vault);
            // This key never enters the global ordinary archive capability map.
            const key = await unlockLocalKeyVault(vault.wrappedKey, owner);
            let closed = false;
            let release!: () => void;
            const held = new Promise<void>(done => { release = done; });
            const close = () => {
                closed = true;
                key.fill(0);
                release();
            };
            const requireCurrent = () => {
                try {
                    assertNoLocalPurge(owner);
                    if (!closed && permitted() && JSON.stringify(readVaultControl(owner)) === witness) return;
                } catch { /* An unreadable vault or purge marker invalidates this key. */ }
                close();
                throw new LocalVaultLockedError();
            };
            const read = () => {
                requireCurrent();
                if (readBrowserValueStrict(legacyKey) !== null) throw new LocalCiphertextError();
                const raw = readBrowserValueStrict(sealedKey);
                const plaintext = raw === null ? null : openLocalText(key, owner, sealedKey, raw);
                requireCurrent();
                return { raw, plaintext };
            };
            try {
                requireCurrent();
                resolve({
                    read, close,
                    replace: (expectedRaw, plaintext) => {
                        const current = read();
                        if (current.raw !== expectedRaw) throw new Error('Bozza cambiata: copia più recente conservata.');
                        const raw = plaintext === null ? null : sealLocalText(key, owner, sealedKey, plaintext);
                        requireCurrent();
                        if (raw === null) removeBrowserValue(sealedKey);
                        else writeBrowserValue(sealedKey, raw);
                        if (read().raw !== raw) throw new Error('Impossibile confermare il salvataggio della bozza.');
                        return raw;
                    },
                });
                await held;
            } finally {
                close();
            }
        }).catch(reject);
    });
}
