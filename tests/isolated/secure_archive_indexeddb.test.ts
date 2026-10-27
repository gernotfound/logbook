import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get, set } from 'idb-keyval';
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';
import { commitLocal, initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { deviceVaultKeyId } from '../../src/lib/sync/secureArchiveKeys';
import { lockAllVaults, lockVault, unlockVaultForOwner, vaultControlKey, LocalVaultLockedError } from '../../src/lib/sync/secureArchiveSession';
import { LocalCiphertextError, SEALED_LOCAL_PREFIX } from '../../src/lib/sync/secureArchiveCipher';
import { readSealedArchive, sealedArchiveKey, updateSealedArchive } from '../../src/lib/sync/secureArchiveIndexedDb';
import { getArchiveRecord, updateArchiveRecord } from '../../src/lib/sync/secureArchiveRepository';

const owner = 'user:secure-idb';
const key = () => crypto.getRandomValues(new Uint8Array(32));
type LocalState = { calories: number; weight: number; pending: number[]; version: 5 };

describe('atomic encrypted IndexedDB primitive', () => {
    beforeEach(async () => { await clear(); });

    it('persists only ciphertext, verifies the full object and round-trips without plaintext', async () => {
        const dek = key();
        const value: LocalState = { calories: 1234, weight: 75, pending: [1, 2], version: 5 };
        await updateSealedArchive<LocalState>(owner, dek, () => value);
        const raw = await get(sealedArchiveKey(owner));
        expect(typeof raw).toBe('string');
        expect(raw).toMatch(/^tlb-sealed:v1:/);
        expect(raw).not.toContain('calories');
        expect(raw).not.toContain('1234');
        expect(raw).not.toContain('"pending"');
        expect(await readSealedArchive<LocalState>(owner, dek)).toEqual(value);
    });

    it('serializes two concurrent updates inside the same IDB transaction boundary', async () => {
        const dek = key();
        const base: LocalState = { calories: 0, weight: 0, pending: [], version: 5 };
        await updateSealedArchive<LocalState>(owner, dek, () => base);
        await Promise.all([
            updateSealedArchive<LocalState>(owner, dek, current => ({
                ...current!, weight: 75, pending: [...current!.pending, 1],
            })),
            updateSealedArchive<LocalState>(owner, dek, current => ({
                ...current!, calories: 1800, pending: [...current!.pending, 2],
            })),
        ]);
        const committed = await readSealedArchive<LocalState>(owner, dek);
        expect(committed).toEqual({ calories: 1800, weight: 75, pending: [1, 2], version: 5 });
    });

    it('never erases persisted ciphertext after a rejected update', async () => {
        const dek = key();
        const initial: LocalState = { calories: 1400, weight: 75, pending: [1], version: 5 };
        await updateSealedArchive<LocalState>(owner, dek, () => initial);
        const previous = await get(sealedArchiveKey(owner));
        await expect(updateSealedArchive<LocalState>(owner, dek, () => { throw new Error('journal conflict'); })).rejects.toThrow('journal conflict');
        expect(await get(sealedArchiveKey(owner))).toEqual(previous);
    });

    it('fails closed for legacy unsealed records, wrong owner, tampered data and wrong key', async () => {
        const dek = key();
        await set(sealedArchiveKey(owner), { data: { weight: 75 } });
        await expect(readSealedArchive(owner, dek)).rejects.toBeInstanceOf(LocalCiphertextError);
        await expect(updateSealedArchive(owner, dek, () => ({ version: 5 }))).rejects.toBeInstanceOf(LocalCiphertextError);
        expect(await get(sealedArchiveKey(owner))).toEqual({ data: { weight: 75 } });

        await clear();
        await updateSealedArchive(owner, dek, () => ({ secret: 'health' }));
        const ciphertext = await get<string>(sealedArchiveKey(owner));
        expect(ciphertext).toContain(SEALED_LOCAL_PREFIX);
        await expect(readSealedArchive(owner, key())).rejects.toBeInstanceOf(LocalCiphertextError);
        await set(sealedArchiveKey('user:other-idb'), ciphertext);
        await expect(readSealedArchive('user:other-idb', dek)).rejects.toBeInstanceOf(LocalCiphertextError);
        await set(sealedArchiveKey(owner), ciphertext!.replace(/.$/, c => c === 'A' ? 'B' : 'A'));
        await expect(readSealedArchive(owner, dek)).rejects.toBeInstanceOf(LocalCiphertextError);
    });
});

describe('pre-vault archive gateway', () => {
    const archive = sealedArchiveKey(owner);

    beforeEach(async () => {
        await clear();
        lockAllVaults();
        localStorage.clear();
    });
    afterEach(() => lockAllVaults());

    it('rejects an undefined transformation without losing an existing plaintext archive', async () => {
        const original = { marker: 'durable-local-data' };
        await set(archive, original);

        await expect(updateArchiveRecord<typeof original>(owner, () => undefined))
            .rejects.toThrow('non può eliminare tacitamente');
        expect(await get(archive)).toEqual(original);
        expect(await getArchiveRecord(owner)).toEqual(original);
    });

    it('rejects asynchronous transformations before writing the plaintext archive', async () => {
        const original = { marker: 'durable-local-data' };
        await set(archive, original);

        await expect(updateArchiveRecord<typeof original>(
            owner, () => Promise.resolve({ marker: 'not-committed' }) as unknown as typeof original,
        )).rejects.toThrow('asincrona vietata');
        expect(await get(archive)).toEqual(original);
    });

    it('still accepts a missing-archive no-op', async () => {
        expect(await get(archive)).toBeUndefined();
        await updateArchiveRecord(owner, () => undefined);
        expect(await getArchiveRecord(owner)).toBeUndefined();
    });
});

// Unlike the low-level primitive above, localRepository uses secureArchiveRepository.
// These regressions exercise the production owner/epoch gate and the actual journal.
describe('production encrypted localRepository gateway', () => {
    const archive = sealedArchiveKey(owner);
    const profile = (height: string, gender?: string) => UserDataSchema.parse({
        profile: { height, ...(gender ? { gender } : {}) },
    }) as unknown as UserData;

    beforeEach(async () => {
        await clear();
        lockAllVaults();
        localStorage.clear();
        vi.stubGlobal('navigator', { locks: {
            request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
        } });
    });
    afterEach(() => {
        lockAllVaults();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('commits business state and pending journal in one authenticated ciphertext across lock/unlock', async () => {
        await createAndMigrateVault(owner);
        const deviceKey = await get<CryptoKey>(deviceVaultKeyId(owner));
        expect(deviceKey?.extractable).toBe(false);
        const originalControl = localStorage.getItem(vaultControlKey(owner));
        const initial = profile('170');
        await initializeLocal(owner, initial);
        const initialCiphertext = await get<string>(archive);
        expect(initialCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(initialCiphertext).not.toContain('"height":"170"');

        await commitLocal(owner, profile('171'), initial);
        const ciphertext = await get<string>(archive);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        expect(ciphertext).not.toBe(initialCiphertext);
        expect(ciphertext).not.toContain('"height":"171"');
        const committed = await readLocal(owner);
        expect(committed?.data.profile?.height).toBe('171');
        expect(committed?.pending.length).toBeGreaterThan(0);
        lockVault(owner);
        await expect(readLocal(owner)).rejects.toBeInstanceOf(LocalVaultLockedError);
        await unlockVaultForOwner(owner);
        expect(await readLocal(owner)).toEqual(committed);
        expect(await get(archive)).toBe(ciphertext);
        expect(localStorage.getItem(vaultControlKey(owner))).toBe(originalControl);
        expect(await get(deviceVaultKeyId(owner))).toEqual(deviceKey);
    });

    it('serializes concurrent production commits without dropping independent fields or pending operations', async () => {
        await createAndMigrateVault(owner);
        const initial = profile('170');
        await initializeLocal(owner, initial);
        await Promise.all([
            commitLocal(owner, profile('171'), initial),
            commitLocal(owner, profile('170', 'M'), initial),
        ]);
        const state = await readLocal(owner);
        expect(state?.data.profile).toMatchObject({ height: '171', gender: 'M' });
        expect(state?.pending.length).toBeGreaterThanOrEqual(2);
        expect(await get<string>(archive)).toMatch(/^tlb-sealed:v1:/);
    });

    it('refuses to erase an existing ciphertext through an undefined transformation', async () => {
        await createAndMigrateVault(owner);
        await initializeLocal(owner, profile('170'));
        const original = await get(archive);

        await expect(updateArchiveRecord(owner, () => undefined))
            .rejects.toThrow('non può eliminare tacitamente');
        expect(await get(archive)).toBe(original);
        expect((await readLocal(owner))?.data.profile?.height).toBe('170');
    });

    it('retains the exact encrypted business/journal bytes when an IDB write fails', async () => {
        await createAndMigrateVault(owner);
        const initial = profile('170');
        await initializeLocal(owner, initial);
        await commitLocal(owner, profile('171'), initial);
        const originalBytes = await get(archive);
        const originalState = await readLocal(owner);
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
            throw new DOMException('injected IDB quota', 'QuotaExceededError');
        });
        await expect(commitLocal(owner, profile('172'), profile('171'))).rejects.toThrow('injected IDB quota');
        expect(await get(archive)).toBe(originalBytes);
        expect(await readLocal(owner)).toEqual(originalState);
    });

    it('rejects tampered ciphertext without overwriting it or replacing the device key', async () => {
        await createAndMigrateVault(owner);
        await initializeLocal(owner, profile('170'));
        const control = localStorage.getItem(vaultControlKey(owner));
        const deviceKey = await get(deviceVaultKeyId(owner));
        const ciphertext = await get<string>(archive);
        const tampered = ciphertext!.slice(0, -1) + (ciphertext!.endsWith('A') ? 'B' : 'A');
        await set(archive, tampered);
        await expect(commitLocal(owner, profile('171'), profile('170'))).rejects.toBeInstanceOf(LocalCiphertextError);
        expect(await get(archive)).toBe(tampered);
        expect(await get(deviceVaultKeyId(owner))).toEqual(deviceKey);
        expect(localStorage.getItem(vaultControlKey(owner))).toBe(control);
    });
});
