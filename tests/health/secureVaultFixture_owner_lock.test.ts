import { describe, expect, it } from 'vitest';
import { get } from 'idb-keyval';
import { idbStore } from '../setup';
import { prepareUnlockedTestArchive } from '../secureVaultFixture';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { vaultControlMirrorId } from '../../src/lib/sync/secureArchiveControlRecovery';
import { deviceVaultKeyId } from '../../src/lib/sync/secureArchiveKeys';
import { readVaultControl, vaultControlKey } from '../../src/lib/sync/secureArchiveSession';

describe('shared encrypted-vault test fixture', () => {
    it('does not remove an orphan control while production owns the provisioning lock', async () => {
        const owner = 'user:fixture-owner-lock';
        await createAndMigrateVault(owner);
        const originalControl = localStorage.getItem(vaultControlKey(owner));
        const originalMirror = await get(vaultControlMirrorId(owner));
        const originalEpoch = readVaultControl(owner)?.epoch;
        expect(originalControl).toBeTruthy();
        expect(originalMirror).toBeDefined();
        expect(originalEpoch).toBeTruthy();

        // Model the previous test clearing only its IndexedDB key, while an
        // asynchronous AuthProvider still holds the owner provisioning lock.
        delete idbStore[deviceVaultKeyId(owner)];
        let releaseHolder!: () => void;
        let signalAcquired!: () => void;
        const acquired = new Promise<void>(resolve => { signalAcquired = resolve; });
        const held = new Promise<void>(resolve => { releaseHolder = resolve; });
        const holder = navigator.locks.request(
            'thelogbook:secure-archive:' + owner,
            { mode: 'exclusive' },
            async () => {
                signalAcquired();
                await held;
            },
        );
        await acquired;

        const provisioning = prepareUnlockedTestArchive(owner);
        try {
            // IDB operations advance the mocked transaction queue. The prior
            // unlocked fixture would erase the mirror despite the held lock.
            for (let i = 0; i < 8; i++) await get(vaultControlMirrorId(owner));
            expect(localStorage.getItem(vaultControlKey(owner))).toBe(originalControl);
            expect(await get(vaultControlMirrorId(owner))).toEqual(originalMirror);
        } finally {
            releaseHolder();
            await holder;
        }

        await provisioning;
        expect(readVaultControl(owner)?.epoch).not.toBe(originalEpoch);
        expect(await get(deviceVaultKeyId(owner))).toBeDefined();
    });
});
