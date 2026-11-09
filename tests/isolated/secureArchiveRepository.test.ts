import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, del, get, set } from 'idb-keyval';
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';
import { initializeLocal, readLocal, type LocalEnvelope } from '../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import {
    LocalVaultLockedError, lockAllVaults, lockVault, unlockVaultForOwner, vaultControlKey,
} from '../../src/lib/sync/secureArchiveSession';
import {
    beginLocalPurge, cancelUnstartedLocalPurge, LocalPurgePendingError,
} from '../../src/lib/sync/localPurgeFence';
import { LocalCiphertextError } from '../../src/lib/sync/secureArchiveCipher';
import { getArchiveRecord, updateArchiveRecord } from '../../src/lib/sync/secureArchiveRepository';

const owner = 'user:archive-repository';
const archive = 'logbook:v2:' + owner;
const controlKey = vaultControlKey(owner);
const initialData = () => UserDataSchema.parse({
    profile: { height: '170' }, nutritionPlanning: {},
}) as unknown as UserData;
const changeHeight = (current: LocalEnvelope | undefined): LocalEnvelope => {
    if (!current) throw new Error('Expected the initialized archive');
    return { ...current, data: { ...current.data, profile: { ...current.data.profile, height: '171' } } };
};

describe('secure archive repository capability and transaction boundaries', () => {
    let control: string;

    beforeEach(async () => {
        lockAllVaults();
        await clear();
        localStorage.clear();
        vi.stubGlobal('navigator', { locks: {
            request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
        } });
        await createAndMigrateVault(owner);
        await initializeLocal(owner, initialData());
        control = localStorage.getItem(controlKey)!;
    });
    afterEach(() => {
        vi.restoreAllMocks();
        lockAllVaults();
        vi.unstubAllGlobals();
    });

    const invalidate = (reason: 'epoch' | 'lock' | 'purge') => {
        if (reason === 'lock') lockVault(owner);
        else if (reason === 'purge') beginLocalPurge(owner);
        else {
            const current = JSON.parse(localStorage.getItem(controlKey)!);
            current.epoch = current.epoch === '0'.repeat(32) ? '1'.repeat(32) : '0'.repeat(32);
            localStorage.setItem(controlKey, JSON.stringify(current));
        }
    };
    const recover = async (reason: 'epoch' | 'lock' | 'purge') => {
        if (reason === 'purge') cancelUnstartedLocalPurge(owner);
        localStorage.setItem(controlKey, control);
        await unlockVaultForOwner(owner);
    };

    it.each(['read', 'write'] as const)('rejects a %s begun without vault control even if another tab restores it', async mode => {
        const ciphertext = await get(archive);
        localStorage.removeItem(controlKey);
        const originalGet = localStorage.getItem.bind(localStorage);
        let restored = false;
        vi.spyOn(localStorage, 'getItem').mockImplementation(key => {
            const observed = originalGet(key);
            if (key === controlKey && !restored) {
                restored = true;
                localStorage.setItem(controlKey, control);
            }
            return observed;
        });
        const transform = vi.fn(changeHeight);
        await expect(mode === 'read' ? getArchiveRecord(owner) : updateArchiveRecord(owner, transform))
            .rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(transform).not.toHaveBeenCalled();
        vi.restoreAllMocks();
        expect(await get(archive)).toBe(ciphertext);
        expect((await readLocal(owner))?.data.profile?.height).toBe('170');
    });

    it.each(['read', 'write'] as const)('rejects a %s begun during migration even if another tab activates the vault', async mode => {
        const ciphertext = await get(archive);
        localStorage.setItem(controlKey, JSON.stringify({ ...JSON.parse(control), phase: 'migrating' }));
        const originalGet = localStorage.getItem.bind(localStorage);
        let restored = false;
        vi.spyOn(localStorage, 'getItem').mockImplementation(key => {
            const observed = originalGet(key);
            if (key === controlKey && !restored) {
                restored = true;
                localStorage.setItem(controlKey, control);
            }
            return observed;
        });
        const transform = vi.fn(changeHeight);
        await expect(mode === 'read' ? getArchiveRecord(owner) : updateArchiveRecord(owner, transform))
            .rejects.toBeInstanceOf(LocalVaultLockedError);
        expect(transform).not.toHaveBeenCalled();
        vi.restoreAllMocks();
        expect(await get(archive)).toBe(ciphertext);
        expect((await readLocal(owner))?.data.profile?.height).toBe('170');
    });

    it.each([
        ['epoch', true], ['lock', true], ['purge', true],
        ['epoch', false], ['lock', false], ['purge', false],
    ] as const)('rechecks %s after an IndexedDB read (archive exists: %s)', async (reason, exists) => {
        if (!exists) await del(archive);
        const ciphertext = await get(archive);
        const originalGet = IDBObjectStore.prototype.get;
        // The request remains real; the owner fence changes before its success event.
        vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(function (this: IDBObjectStore, query) {
            const request = originalGet.call(this, query);
            invalidate(reason);
            return request;
        });
        await expect(getArchiveRecord(owner)).rejects.toBeInstanceOf(
            reason === 'purge' ? LocalPurgePendingError : LocalVaultLockedError,
        );
        vi.restoreAllMocks();
        expect(await get(archive)).toBe(ciphertext);
        await recover(reason);
        if (exists) expect((await readLocal(owner))?.data.profile?.height).toBe('170');
        else expect(await getArchiveRecord(owner)).toBeUndefined();
    });

    it.each(['epoch', 'lock', 'purge'] as const)('rechecks %s before invoking the atomic transformation', async reason => {
        const ciphertext = await get(archive);
        const transform = vi.fn(changeHeight);
        const originalGet = IDBObjectStore.prototype.get;
        vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(function (this: IDBObjectStore, query) {
            const request = originalGet.call(this, query);
            invalidate(reason);
            return request;
        });
        await expect(updateArchiveRecord(owner, transform)).rejects.toBeInstanceOf(
            reason === 'purge' ? LocalPurgePendingError : LocalVaultLockedError,
        );
        expect(transform).not.toHaveBeenCalled();
        vi.restoreAllMocks();
        expect(await get(archive)).toBe(ciphertext);
        await recover(reason);
        expect((await readLocal(owner))?.data.profile?.height).toBe('170');
    });

    it.each(['epoch', 'lock', 'purge'] as const)('rechecks %s after transformation before sealing', async reason => {
        const ciphertext = await get(archive);
        await expect(updateArchiveRecord<LocalEnvelope>(owner, current => {
            const next = changeHeight(current);
            invalidate(reason);
            return next;
        })).rejects.toBeInstanceOf(reason === 'purge' ? LocalPurgePendingError : LocalVaultLockedError);
        expect(await get(archive)).toBe(ciphertext);
        await recover(reason);
        expect((await readLocal(owner))?.data.profile?.height).toBe('170');
        await updateArchiveRecord(owner, changeHeight);
        expect((await readLocal(owner))?.data.profile?.height).toBe('171');
    });

    it.each(['read', 'write'] as const)('rejects invalid persisted records during %s with an active vault', async mode => {
        const envelope = await readLocal(owner);
        for (const raw of [envelope, null, 42, 'plaintext-local-data']) {
            await set(archive, raw);
            const transform = vi.fn(changeHeight);
            await expect(mode === 'read' ? getArchiveRecord(owner) : updateArchiveRecord(owner, transform))
                .rejects.toBeInstanceOf(LocalCiphertextError);
            expect(transform).not.toHaveBeenCalled();
            expect(await get(archive)).toEqual(raw);
        }
    });

    it('rejects function thenables without sealing or executing their continuation', async () => {
        const ciphertext = await get(archive);
        const then = vi.fn();
        const callback = Object.assign(() => undefined, { then });
        await expect(updateArchiveRecord<LocalEnvelope>(owner, () => callback as unknown as LocalEnvelope))
            .rejects.toThrow('asincrona vietata');
        expect(then).not.toHaveBeenCalled();
        expect(await get(archive)).toBe(ciphertext);
        expect((await readLocal(owner))?.data.profile?.height).toBe('170');
    });

    it('rolls back a throwing transformation and permits a subsequent valid transaction', async () => {
        const ciphertext = await get(archive);
        const failure = new Error('Interrupted business calculation');
        await expect(updateArchiveRecord<LocalEnvelope>(owner, current => {
            if (!current?.data.profile) throw new Error('Missing fixture profile');
            current.data.profile.height = '199';
            throw failure;
        })).rejects.toBe(failure);
        expect(await get(archive)).toBe(ciphertext);
        expect((await readLocal(owner))?.data.profile?.height).toBe('170');
        await updateArchiveRecord(owner, changeHeight);
        expect((await readLocal(owner))?.data.profile?.height).toBe('171');
        expect(await get(archive)).not.toBe(ciphertext);
    });
});
