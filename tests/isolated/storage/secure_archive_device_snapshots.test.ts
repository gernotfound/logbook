import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, del, get, set } from 'idb-keyval';
vi.mock('../../../src/lib/firebase', () => ({ auth: { currentUser: null }, ensureAppCheck: vi.fn() }));
vi.mock('../../../src/lib/healthConsent', () => ({
    requireHealthConsentWritable: vi.fn(), isHealthConsentWritable: vi.fn(() => true),
    getVerifiedHealthConsentRevision: vi.fn(() => 0),
}));

import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { vaultControlMirrorId } from '../../../src/lib/sync/secureArchiveControlRecovery';
import { deviceVaultKeyId } from '../../../src/lib/sync/secureArchiveKeys';
import { LocalVaultLockedError, lockAllVaults, lockVault, readVaultControl, vaultControlKey } from '../../../src/lib/sync/secureArchiveSession';
import { LocalCiphertextError, SEALED_LOCAL_PREFIX } from '../../../src/lib/sync/secureArchiveCipher';
import { BrowserStorageError } from '../../../src/lib/sync/browserStorage';
import { activateGuestSession, GUEST_SESSION_KEY, GUEST_REVOCATION_KEY } from '../../../src/lib/sync/session';
import { collectBackupSnapshot } from '../../../src/lib/db/backupSnapshot';

import { owner, day, base, resetSecureArchiveMigrationFixture } from './secureArchiveMigrationFixture';

beforeEach(resetSecureArchiveMigrationFixture);

describe('device snapshots, legacy writers and backup', () => {
    it('never reads, creates or deletes device snapshots before the owner vault is active', () => {
        const name = 'draft:measurement:' + day;
        const legacy = deviceKey(name, owner);
        const sealed = protectedDeviceKey(name, owner);
        expect(() => readDeviceValueStrict(name, owner)).toThrow(LocalVaultLockedError);
        expect(() => writeDeviceValue(name, '{"weight":"76"}', owner)).toThrow(LocalVaultLockedError);
        expect(() => writeDeviceValue(name, null, owner)).toThrow(LocalVaultLockedError);
        expect(localStorage.getItem(legacy)).toBeNull();
        expect(localStorage.getItem(sealed)).toBeNull();
        expect(readVaultControl(owner)).toBeNull();
    });

    it('preserves a plaintext device copy but refuses reading, rewriting or deleting it without a vault', () => {
        const name = 'workout';
        const original = '{"id":"prelaunch-unsealed"}';
        const legacy = deviceKey(name, owner);
        localStorage.setItem(legacy, original);
        expect(() => readDeviceValueStrict(name, owner)).toThrow(LocalCiphertextError);
        expect(() => writeDeviceValue(name, '{"id":"new"}', owner)).toThrow(LocalCiphertextError);
        expect(() => writeDeviceValue(name, null, owner)).toThrow(LocalCiphertextError);
        expect(localStorage.getItem(legacy)).toBe(original);
        expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBeNull();
        expect(readVaultControl(owner)).toBeNull();
    });

    it('preserves a sealed device copy with missing vault controls without treating it as empty', async () => {
        const name = 'draft:measurement:' + day;
        await createAndMigrateVault(owner);
        writeDeviceValue(name, '{"weight":"76"}', owner);
        const sealedKey = protectedDeviceKey(name, owner);
        const original = localStorage.getItem(sealedKey);
        await del(vaultControlMirrorId(owner));
        localStorage.removeItem(vaultControlKey(owner));
        lockVault(owner);
        expect(() => readDeviceValueStrict(name, owner)).toThrow(LocalCiphertextError);
        expect(() => writeDeviceValue(name, '{"weight":"78"}', owner)).toThrow(LocalCiphertextError);
        expect(() => writeDeviceValue(name, null, owner)).toThrow(LocalCiphertextError);
        expect(localStorage.getItem(sealedKey)).toBe(original);
        expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    });

    it('refuses device writes for a guest generation before its vault exists', () => {
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-device-epoch');
        localStorage.setItem('logbook_is_guest', 'true');
        activateGuestSession('guest-device-epoch');
        expect(() => readDeviceValueStrict('timer', 'guest')).toThrow(LocalVaultLockedError);
        expect(() => writeDeviceValue('timer', '{"state":"running"}', 'guest')).toThrow(LocalVaultLockedError);
        expect(() => writeDeviceValue('timer', null, 'guest')).toThrow(LocalVaultLockedError);
        expect(localStorage.getItem(deviceKey('timer', 'guest'))).toBeNull();
        expect(localStorage.getItem(protectedDeviceKey('timer', 'guest'))).toBeNull();
    });

    it('rejects old device plaintext before provisioning and preserves every original byte', async () => {
        const legacyKey = deviceKey('draft:measurement:' + day, owner);
        const original = '{"weight":"77"}';
        const originalIdb = await get('logbook:v2:' + owner);
        localStorage.setItem(legacyKey, original);
        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(LocalCiphertextError);
        expect(readVaultControl(owner)).toBeNull();
        expect(await get(vaultControlMirrorId(owner))).toBeUndefined();
        expect(localStorage.getItem(legacyKey)).toBe(original);
        expect(localStorage.getItem(protectedDeviceKey('draft:measurement:' + day, owner))).toBeNull();
        expect(await get('logbook:v2:' + owner)).toEqual(originalIdb);
    });

    it('preserves corrupted encrypted drafts against replacements and deletions', async () => {
        await createAndMigrateVault(owner);
        const name = 'draft:measurement:' + day;
        writeDeviceValue(name, '{"weight":"76"}', owner);
        const sealedKey = protectedDeviceKey(name, owner);
        const original = localStorage.getItem(sealedKey)!;
        const at = SEALED_LOCAL_PREFIX.length;
        const damaged = original.slice(0, at) + (original[at] === 'A' ? 'B' : 'A') + original.slice(at + 1);
        localStorage.setItem(sealedKey, damaged);
        expect(() => readDeviceValueStrict(name, owner)).toThrow(LocalCiphertextError);
        expect(() => writeDeviceValue(name, '{"weight":"77"}', owner)).toThrow(LocalCiphertextError);
        expect(() => writeDeviceValue(name, null, owner)).toThrow(LocalCiphertextError);
        expect(localStorage.getItem(sealedKey)).toBe(damaged);
        expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    });

    it('preserves an unreadable sealed draft instead of treating it as absent', async () => {
        await createAndMigrateVault(owner);
        await initializeLocal(owner, base());
        const name = 'draft:measurement:' + day;
        writeDeviceValue(name, '{"weight":"81"}', owner);
        const protectedKey = protectedDeviceKey(name, owner);
        const ciphertext = localStorage.getItem(protectedKey);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        const getOriginal = localStorage.getItem.bind(localStorage);
        const deniedRead = vi.spyOn(localStorage, 'getItem').mockImplementation(key => {
            if (key === protectedKey) throw new Error('transient storage denied');
            return getOriginal(key);
        });
        expect(() => readDeviceValueStrict(name, owner)).toThrow(BrowserStorageError);
        deniedRead.mockRestore();
        expect(localStorage.getItem(protectedKey)).toBe(ciphertext);
        expect(readDeviceValueStrict(name, owner)).toBe('{"weight":"81"}');
    });

    it('refuses stale legacy-tab writes instead of hiding or deleting conflicting device data', async () => {
        await createAndMigrateVault(owner);
        writeDeviceValue('workout', '{"id":"before"}', owner);
        const sealedBefore = localStorage.getItem(protectedDeviceKey('workout', owner));
        localStorage.setItem(deviceKey('workout', owner), '{"id":"newer-old-tab"}');
        expect(() => readDeviceValueStrict('workout', owner)).toThrow(LocalCiphertextError);
        expect(() => writeDeviceValue('workout', '{"id":"replaced"}', owner)).toThrow(LocalCiphertextError);
        expect(() => writeDeviceValue('workout', null, owner)).toThrow(LocalCiphertextError);
        expect(localStorage.getItem(deviceKey('workout', owner))).toBe('{"id":"newer-old-tab"}');
        expect(localStorage.getItem(protectedDeviceKey('workout', owner))).toBe(sealedBefore);
    });

    it('exports decrypted device snapshots in an explicit guest JSON backup without exposing plaintext in storage', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'secure-backup-fixture');
        localStorage.removeItem(GUEST_REVOCATION_KEY);
        activateGuestSession('secure-backup-fixture');
        const data = base();
        await createAndMigrateVault('guest');
        await initializeLocal('guest', data);
        const notes = '{"notes":"sensitive offline workout"}';
        const draft = '{"weight":"77"}';
        writeDeviceValue('workout', notes, 'guest');
        writeDeviceValue('draft:measurement:' + day, draft, 'guest');
        const snapshot = await collectBackupSnapshot(data, false);
        expect(snapshot.owner).toBe('guest');
        expect(snapshot.recovery.device).toMatchObject({
            workout: notes,
            ['draft:measurement:' + day]: draft,
        });
        expect(localStorage.getItem(protectedDeviceKey('workout', 'guest'))).not.toContain('sensitive offline workout');
        expect(localStorage.getItem(deviceKey('workout', 'guest'))).toBeNull();
    });

    it('never adopts a valid pre-launch plaintext envelope or replaces its original bytes', async () => {
        await createAndMigrateVault(owner);
        await initializeLocal(owner, base());
        const plaintext = structuredClone((await readLocal(owner))!);
        lockAllVaults();
        localStorage.clear();
        await clear();
        await set('logbook:v2:' + owner, plaintext);
        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(readVaultControl(owner)).toBeNull();
        expect(await get(vaultControlMirrorId(owner))).toBeUndefined();
        expect(await get(deviceVaultKeyId(owner))).toBeUndefined();
        expect(await get('logbook:v2:' + owner)).toEqual(plaintext);
    });

    it('rejects plaintext injected after an interrupted vault publication without replacing the key', async () => {
        const originalSet = localStorage.setItem.bind(localStorage);
        const failure = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
            if (key === vaultControlKey(owner)) throw new Error('interrupted first publication');
            originalSet(key, value);
        });
        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(BrowserStorageError);
        failure.mockRestore();

        const mirror = await get<{ phase: string; epoch: string }>(vaultControlMirrorId(owner));
        expect(mirror?.phase).toBe('migrating');
        const plaintext = { incompatible: 'old-unsealed-writer' };
        await set('logbook:v2:' + owner, plaintext);

        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(LocalCiphertextError);
        expect(readVaultControl(owner)?.phase).toBe('migrating');
        expect((await get<{ epoch: string }>(vaultControlMirrorId(owner)))?.epoch).toBe(mirror?.epoch);
        expect(await get(deviceVaultKeyId(owner))).toBeDefined();
        expect(await get('logbook:v2:' + owner)).toEqual(plaintext);
    });

    it('never activates a corrupt legacy archive or silently seeds empty data', async () => {
        await set('logbook:v2:' + owner, { incompatible: 'legacy-bad' });
        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(readVaultControl(owner)).toBeNull();
        expect(await get(vaultControlMirrorId(owner))).toBeUndefined();
        expect(await get(deviceVaultKeyId(owner))).toBeUndefined();
        expect(await get('logbook:v2:' + owner)).toEqual({ incompatible: 'legacy-bad' });
    });
});
