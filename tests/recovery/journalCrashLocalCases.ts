import { it, expect, vi } from 'vitest';
import { get } from 'idb-keyval';
import type { CrashSuiteContext } from './journalCrashConsistency.test';

export function registerCrashLocalCases(ctx: CrashSuiteContext): void {
    const { owner, data, remote, commitLocal, commitDomainOperations, hydrateLocal, readLocal, installReplaySafeRemote, replicateJournal, currentCloudData, cloudDocumentsWithSync, invalidateSession } = ctx;

    it.each([
        { key: '%70rofile/height', deleteClock: { s01: 2 } },
        { key: 'profile/height', deleteClock: {} },
    ])('preserves pending data on invalid cloud field metadata: %j', async ({ key, deleteClock }) => {
        await commitLocal(owner, data(171), data(170));
        const before = await readLocal(owner);
        expect(before?.pending.length).toBeGreaterThan(0);
        const storedBefore = await get('logbook:v2:' + owner);
        const malformed = cloudDocumentsWithSync();
        malformed.set('', {
            ...(malformed.get('') ?? {}),
            _sync: {
                protocolVersion: 3, clock: { s01: 2 },
                fields: { [key]: {
                    actorId: 's01', seq: 2, clock: { s01: 2 }, deleted: true, deleteClock,
                } },
            },
        });
        await expect(hydrateLocal(owner, data(170), [], malformed)).rejects.toMatchObject({
            code: 'invalid-cloud-sync-metadata', documentPath: '',
        });
        expect(await get('logbook:v2:' + owner)).toEqual(storedBefore);
        expect(await readLocal(owner)).toEqual(before);
        installReplaySafeRemote();
        expect(await replicateJournal()).toMatchObject({ ok: true, status: 'synced' });
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect(currentCloudData().profile?.height).toBe('171');
    });

    it('classifies malformed cloud sync metadata and preserves the durable local envelope', async () => {
        const before = await readLocal(owner);
        const sealedBefore = await get('logbook:v2:' + owner);
        const malformedCloudDocuments = cloudDocumentsWithSync();
        malformedCloudDocuments.set('', {
            ...(malformedCloudDocuments.get('') ?? {}),
            _sync: { protocolVersion: 1, clock: { broken: -1 }, fields: {} },
        });

        await expect(
            hydrateLocal(owner, data(170), [], malformedCloudDocuments),
        ).rejects.toMatchObject({
            code: 'invalid-cloud-sync-metadata',
            documentPath: '',
        });

        const after = await readLocal(owner);
        expect(after?.data).toEqual(before?.data);
        expect(after?.baseline).toEqual(before?.baseline);
        expect(after?.pending).toEqual(before?.pending);
        expect(after?.clock).toEqual(before?.clock);
        expect(await get('logbook:v2:' + owner)).toEqual(sealedBefore);
        expect(remote.apply).not.toHaveBeenCalled();
    });

    it('recovers a durable local commit after a new session epoch before any remote delivery', async () => {
        await commitLocal(owner, data(171), data(170));
        const beforeRestart = await readLocal(owner);
        expect(beforeRestart?.data.profile?.height).toBe('171');
        expect(beforeRestart?.pending.length).toBeGreaterThan(0);

        invalidateSession();
        installReplaySafeRemote();

        const result = await replicateJournal();
        expect(result).toMatchObject({ ok: true, status: 'synced' });
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect((await readLocal(owner))?.data.profile?.height).toBe('171');
        expect(currentCloudData().profile?.height).toBe('171');
    });

    it('keeps the old durable state when the local transaction fails before journaling', async () => {
        const before = await readLocal(owner);
        const sealedBefore = await get('logbook:v2:' + owner);
        const nativePut = IDBObjectStore.prototype.put;
        let injectedOwnerPut = false;
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
            this: IDBObjectStore, value: unknown, key?: IDBValidKey,
        ) {
            if (!injectedOwnerPut && this.name === 'keyval' && key === 'logbook:v2:' + owner
                && this.transaction.mode === 'readwrite') {
                injectedOwnerPut = true;
                throw new DOMException('Injected local commit failure', 'QuotaExceededError');
            }
            return nativePut.call(this, value, key);
        });

        try {
            await expect(commitLocal(owner, data(171), data(170))).rejects.toThrow('Injected local commit failure');
        } finally {
            put.mockRestore();
        }

        expect(injectedOwnerPut).toBe(true);
        expect(await get('logbook:v2:' + owner)).toEqual(sealedBefore);
        expect(await readLocal(owner)).toEqual(before);
        expect(remote.apply).not.toHaveBeenCalled();
    });

    it('keeps the entire M8 envelope unchanged when IndexedDB aborts asynchronously after put is queued', async () => {
        const before = await readLocal(owner);
        const sealedBefore = await get('logbook:v2:' + owner);
        const nativePut = IDBObjectStore.prototype.put;
        let abortedOwnerPut = false;
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
            this: IDBObjectStore, value: unknown, key?: IDBValidKey,
        ) {
            const request = nativePut.call(this, value, key);
            if (!abortedOwnerPut && this.name === 'keyval' && key === 'logbook:v2:' + owner
                && this.transaction.mode === 'readwrite') {
                abortedOwnerPut = true;
                const transaction = this.transaction;
                queueMicrotask(() => {
                    try { transaction.abort(); } catch { /* already completed */ }
                });
            }
            return request;
        });

        try {
            await expect(commitDomainOperations(
                owner,
                { type: 'profile.patch', patch: { height: '171' } },
                data(170),
            )).rejects.toBeDefined();
        } finally {
            put.mockRestore();
        }

        expect(abortedOwnerPut).toBe(true);
        expect(await get('logbook:v2:' + owner)).toEqual(sealedBefore);
        expect(await readLocal(owner)).toEqual(before);
        expect(remote.apply).not.toHaveBeenCalled();
    });
}
