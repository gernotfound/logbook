import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { deviceKey, protectedDeviceKey } from './deviceStorageKeys';
import { assertNoLocalPurge } from './localPurgeFence';
import { LocalCiphertextError, openLocalText, sealLocalText } from './secureArchiveCipher';
import { unlockLocalKeyVault } from './secureArchiveKeys';
import { LocalVaultLockedError, readVaultControl } from './secureArchiveSession';

type DeviceRecord = { raw: string | null; plaintext: string | null };

/** A bounded set of owner records available only during one verified editor lease. */
export function openScopedDeviceRecords(
    owner: string, lockName: string, permitsLease: () => boolean, permitsRecord: (name: string) => boolean,
) {
    const lockKey = protectedDeviceKey(lockName, owner);
    const locks = navigator.locks;
    return new Promise<{
        read: (name: string) => DeviceRecord;
        replace: (name: string, expectedRaw: string | null, plaintext: string | null) => string | null;
        requireCurrent: () => void;
        close: () => void;
    }>((resolve, reject) => {
        if (!locks?.request || !permitsLease()) throw new LocalVaultLockedError();
        void locks.request(lockKey, { mode: 'exclusive', ifAvailable: true }, async lock => {
            if (!lock) throw new Error('La bozza è aperta in un’altra scheda.');
            assertNoLocalPurge(owner);
            const vault = readVaultControl(owner);
            if (!permitsLease() || !vault || vault.phase !== 'active') throw new LocalVaultLockedError();
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
                    if (!closed && permitsLease() && JSON.stringify(readVaultControl(owner)) === witness) return;
                } catch { /* An unreadable vault or purge marker invalidates this key. */ }
                close();
                throw new LocalVaultLockedError();
            };
            const read = (name: string) => {
                if (!permitsRecord(name)) throw new LocalVaultLockedError();
                requireCurrent();
                if (readBrowserValueStrict(deviceKey(name, owner)) !== null) throw new LocalCiphertextError();
                const sealedKey = protectedDeviceKey(name, owner);
                const raw = readBrowserValueStrict(sealedKey);
                const plaintext = raw === null ? null : openLocalText(key, owner, sealedKey, raw);
                requireCurrent();
                return { raw, plaintext };
            };
            try {
                requireCurrent();
                resolve({
                    read, close, requireCurrent,
                    replace: (name, expectedRaw, plaintext) => {
                        const current = read(name);
                        if (current.raw !== expectedRaw) throw new Error('Bozza cambiata: copia più recente conservata.');
                        const sealedKey = protectedDeviceKey(name, owner);
                        const raw = plaintext === null ? null : sealLocalText(key, owner, sealedKey, plaintext);
                        requireCurrent();
                        if (raw === null) removeBrowserValue(sealedKey);
                        else writeBrowserValue(sealedKey, raw);
                        if (read(name).raw !== raw) throw new Error('Impossibile confermare il salvataggio della bozza.');
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

/** Keep the ordinary single-record editor capability limited to its own key. */
export async function openScopedDeviceRecord(owner: string, name: string, permitted: () => boolean) {
    const records = await openScopedDeviceRecords(owner, name, permitted, record => record === name);
    return {
        read: () => records.read(name),
        replace: (expectedRaw: string | null, plaintext: string | null) => records.replace(name, expectedRaw, plaintext),
        close: records.close,
    };
}
