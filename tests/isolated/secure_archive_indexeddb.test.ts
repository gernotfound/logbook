import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clear, get, set } from 'idb-keyval';
import { LocalCiphertextError, SEALED_LOCAL_PREFIX } from '../../src/lib/sync/secureArchiveCipher';
import { readSealedArchive, sealedArchiveKey, updateSealedArchive } from '../../src/lib/sync/secureArchiveIndexedDb';

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
