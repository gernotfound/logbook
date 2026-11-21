import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { del, get } from 'idb-keyval';
vi.mock('../../../src/lib/firebase', () => ({ auth: { currentUser: null }, ensureAppCheck: vi.fn() }));
vi.mock('../../../src/lib/healthConsent', () => ({
    requireHealthConsentWritable: vi.fn(), isHealthConsentWritable: vi.fn(() => true),
    getVerifiedHealthConsentRevision: vi.fn(() => 0),
}));

import { commitDomainOperations, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { purgeCompletedAccountLocalData } from '../../../src/lib/db/db_account';
import { isLocalPurgePending } from '../../../src/lib/sync/localPurgeFence';
import { vaultControlMirrorId } from '../../../src/lib/sync/secureArchiveControlRecovery';
import { LocalVaultLockedError, lockVault, readVaultControl, unlockVaultForOwner, vaultControlKey } from '../../../src/lib/sync/secureArchiveSession';
import { SEALED_LOCAL_PREFIX, openLocalText } from '../../../src/lib/sync/secureArchiveCipher';
import { unlockLocalKeyVault } from '../../../src/lib/sync/secureArchiveKeys';
import { BrowserStorageError } from '../../../src/lib/sync/browserStorage';

import { owner, day, base, resetSecureArchiveMigrationFixture } from './secureArchiveMigrationFixture';

beforeEach(resetSecureArchiveMigrationFixture);

describe('durable vault bootstrap and fail-closed controls', () => {
    it('creates the current owner journal and device snapshots only inside the active vault', async () => {
        const initial = base();
        await createAndMigrateVault(owner);
        await initializeLocal(owner, initial);
        const workout = JSON.stringify({ id: 'workout-test', notes: 'private health note' });
        writeDeviceValue('workout', workout, owner);
        writeDeviceValue('draft:measurement:' + day, JSON.stringify({ weight: '76' }), owner);
        expect(readVaultControl(owner)?.phase).toBe('active');
        const raw = await get('logbook:v2:' + owner);
        expect(typeof raw).toBe('string');
        expect(raw).toContain(SEALED_LOCAL_PREFIX);
        expect(raw).not.toContain('"weight"');
        expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
        expect(localStorage.getItem(deviceKey('draft:measurement:' + day, owner))).toBeNull();
        expect(localStorage.getItem(protectedDeviceKey('workout', owner))).not.toContain('private health note');
        expect(readDeviceValueStrict('workout', owner)).toBe(workout);
        expect(readDeviceValueStrict('draft:measurement:' + day, owner)).toContain('76');
        expect((await readLocal(owner))?.data.nutrition?.[day]?.weight).toBe(75);

        const next = await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '171' } }, initial);
        expect(next.operations).toHaveLength(1);
        expect((await readLocal(owner))?.data.profile?.height).toBe('171');
        expect((await readLocal(owner))?.pending).toEqual(next.operations);
        expect((await get<string>('logbook:v2:' + owner))?.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);

        lockVault(owner);
        await expect(readLocal(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(() => readDeviceValueStrict('workout', owner)).toThrow(LocalVaultLockedError);
        await unlockVaultForOwner(owner);
        expect(readDeviceValueStrict('workout', owner)).toBe(workout);
    });

    it('seals immutable workout-intent copies with owner-bound authenticated ciphertext', async () => {
        await createAndMigrateVault(owner);
        await initializeLocal(owner, base());
        const oldName = 'workout-intent:' + 'a'.repeat(32);
        const oldValue = '{"notes":"private recovery record"}';
        writeDeviceValue(oldName, oldValue, owner);
        expect(localStorage.getItem(deviceKey(oldName, owner))).toBeNull();
        expect(localStorage.getItem(protectedDeviceKey(oldName, owner))).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(protectedDeviceKey(oldName, owner))).not.toContain('private recovery record');
        expect(readDeviceValueStrict(oldName, owner)).toBe(oldValue);

        const name = 'workout-intent:' + 'b'.repeat(32);
        const payload = '{"notes":"confidential exercise session"}';
        writeDeviceValue(name, payload, owner);
        expect(localStorage.getItem(protectedDeviceKey(name, owner))).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(protectedDeviceKey(name, owner))).not.toContain('confidential exercise session');
        expect(readDeviceValueStrict(name, owner)).toBe(payload);
    });

    it('fences stale encrypted and legacy writers and provisions a new vault only after purge', async () => {
        await createAndMigrateVault(owner);
        await initializeLocal(owner, base());
        writeDeviceValue('draft_exercise', '{"name":"private"}', owner);
        await purgeCompletedAccountLocalData(owner);
        expect(isLocalPurgePending(owner)).toBe(true);
        expect(await get(vaultControlMirrorId(owner))).toBeUndefined();
        await expect(readLocal(owner)).rejects.toThrow('Pulizia archivio locale');
        expect(() => writeDeviceValue('draft_exercise', '{"name":"stale"}', owner)).toThrow('Pulizia archivio locale');
        await createAndMigrateVault(owner);
        expect(isLocalPurgePending(owner)).toBe(false);
        expect((await readLocal(owner))).toBeUndefined();
        expect(readDeviceValueStrict('draft_exercise', owner)).toBeNull();
    });

    it('does not provision a competing key after control metadata disappears', async () => {
        await createAndMigrateVault(owner);
        await initializeLocal(owner, base());
        writeDeviceValue('draft_exercise', '{"name":"recoverable"}', owner);
        const pendingResult = await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '173' } }, base());
        expect(pendingResult.operations).toHaveLength(1);
        const ciphertext = await get<string>('logbook:v2:' + owner);
        const sealedDevice = localStorage.getItem(protectedDeviceKey('draft_exercise', owner));
        localStorage.removeItem(vaultControlKey(owner));
        lockVault(owner);

        // The authenticated mirror reconstructs the missing synchronous
        // control without minting a different DEK or touching any ciphertext.
        await createAndMigrateVault(owner);
        expect(readVaultControl(owner)?.phase).toBe('active');
        const recovered = await readLocal(owner);
        expect(recovered?.data.nutrition?.[day]?.weight).toBe(75);
        expect(recovered?.data.profile?.height).toBe('173');
        expect(recovered?.pending).toEqual(pendingResult.operations);
        expect(readDeviceValueStrict('draft_exercise', owner)).toBe('{"name":"recoverable"}');
        expect(await get('logbook:v2:' + owner)).toEqual(ciphertext);
        expect(localStorage.getItem(protectedDeviceKey('draft_exercise', owner))).toBe(sealedDevice);
    });

    it('recovers an interruption after writing the first-ever mirror but before localStorage control', async () => {
        const originalEnvelope = await get('logbook:v2:' + owner);
        const originalSet = localStorage.setItem.bind(localStorage);
        const failure = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
            if (key === vaultControlKey(owner)) throw new Error('crash at control publication');
            originalSet(key, value);
        });
        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(BrowserStorageError);
        expect(readVaultControl(owner)).toBeNull();
        expect((await get<{ phase: string }>(vaultControlMirrorId(owner)))?.phase).toBe('migrating');
        expect(await get('logbook:v2:' + owner)).toEqual(originalEnvelope);
        failure.mockRestore();
        await createAndMigrateVault(owner);
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect(await readLocal(owner)).toBeUndefined();
        await initializeLocal(owner, base());
        expect((await readLocal(owner))?.data.nutrition?.[day]?.weight).toBe(75);
    });

    it('rebuilds an absent mirror only after authenticating the primary control', async () => {
        await createAndMigrateVault(owner);
        await initializeLocal(owner, base());
        const original = readVaultControl(owner);
        await del(vaultControlMirrorId(owner));
        lockVault(owner);
        await createAndMigrateVault(owner);
        expect(await get(vaultControlMirrorId(owner))).toEqual(original);
        expect((await readLocal(owner))?.data.profile?.height).toBe('170');
    });

    it('preserves ciphertext and fails closed when BOTH controls disappear', async () => {
        await createAndMigrateVault(owner);
        await initializeLocal(owner, base());
        const ciphertext = await get('logbook:v2:' + owner);
        await del(vaultControlMirrorId(owner));
        localStorage.removeItem(vaultControlKey(owner));
        lockVault(owner);
        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(await get('logbook:v2:' + owner)).toEqual(ciphertext);
        expect(localStorage.getItem(vaultControlKey(owner))).toBeNull();
    });

    it('never replaces the KEK when concurrent key compaction hides an orphaned ciphertext', async () => {
        await createAndMigrateVault(owner);
        const priorControl = readVaultControl(owner)!;
        const ciphertextKey = protectedDeviceKey('draft_exercise', owner);
        const originalDraft = '{"name":"recoverable"}';
        writeDeviceValue('draft_exercise', originalDraft, owner);
        const ciphertext = localStorage.getItem(ciphertextKey)!;
        expect(await get('logbook:v2:' + owner)).toBeUndefined();

        await del(vaultControlMirrorId(owner));
        localStorage.removeItem(vaultControlKey(owner));
        lockVault(owner);

        // A different tab removes the first key while numeric enumeration
        // is running. The old one-pass scan could miss the ciphertext and
        // mint a replacement KEK, destroying the only way to decrypt it.
        localStorage.removeItem(ciphertextKey);
        const decoy = 'logbook:other-tab-index';
        localStorage.setItem(decoy, 'other-tab');
        localStorage.setItem(ciphertextKey, ciphertext);
        expect(localStorage.key(0)).toBe(decoy);
        const nativeKey = localStorage.key.bind(localStorage);
        let shifted = false;
        const spy = vi.spyOn(localStorage, 'key').mockImplementation(index => {
            const seen = nativeKey(index);
            if (index === 0 && !shifted) {
                shifted = true;
                localStorage.removeItem(decoy);
            }
            return seen;
        });

        await expect(createAndMigrateVault(owner)).rejects.toThrow('Inventario localStorage modificato');
        spy.mockRestore();
        expect(shifted).toBe(true);
        expect(readVaultControl(owner)).toBeNull();
        expect(await get(vaultControlMirrorId(owner))).toBeUndefined();
        expect(localStorage.getItem(ciphertextKey)).toBe(ciphertext);

        // Verify the persisted original KEK can still authenticate and
        // decrypt the witness; equality of CryptoKey objects is not enough.
        const dataKey = await unlockLocalKeyVault(priorControl.wrappedKey, owner);
        try {
            expect(openLocalText(dataKey, owner, ciphertextKey, ciphertext)).toBe(originalDraft);
        } finally { dataKey.fill(0); }

        // Stable inventory cannot invent missing controls or discard orphaned bytes.
        await expect(createAndMigrateVault(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(localStorage.getItem(ciphertextKey)).toBe(ciphertext);
    });
});
