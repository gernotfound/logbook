import { idbStore } from './setup';
import { describe, expect, it } from 'vitest';
import { clear, del, get, set, update } from 'idb-keyval';

describe('shared IndexedDB test adapter follows idb-keyval transaction semantics', () => {
    it('serializes concurrent atomic updates instead of losing the first update', async () => {
        const key = 'mock-atomic-counter';
        await set(key, 0);
        await Promise.all([
            update<number>(key, value => (value ?? 0) + 1),
            update<number>(key, value => (value ?? 0) + 1),
        ]);
        expect(await get<number>(key)).toBe(2);
    });

    it('orders set and delete after a pending update on the same key', async () => {
        const key = 'mock-set-delete-order';
        await set(key, 0);
        await Promise.all([update<number>(key, value => (value ?? 0) + 1), set(key, 9)]);
        expect(await get<number>(key)).toBe(9);
        await Promise.all([update<number>(key, value => (value ?? 0) + 1), del(key)]);
        expect(await get<number>(key)).toBeUndefined();
    });

    it('orders clear after an update transaction for the shared object store', async () => {
        const key = 'mock-clear-order';
        await set(key, 0);
        await Promise.all([update<number>(key, value => (value ?? 0) + 1), clear()]);
        expect(await get<number>(key)).toBeUndefined();
    });

    it('returns a read between ordered transactions before a subsequent write', async () => {
        const key = 'mock-read-after-update';
        await set(key, 0);
        const updatePromise = update<number>(key, value => (value ?? 0) + 1);
        const readPromise = get<number>(key);
        const followupWrite = set(key, 10);
        expect(await readPromise).toBe(1);
        await Promise.all([updatePromise, followupWrite]);
        expect(await get<number>(key)).toBe(10);
    });

    it('rejects an asynchronous transaction updater without changing durable data', async () => {
        const key = 'mock-atomic-async-rejection';
        await set(key, 4);
        await expect(update<number>(key, (() => Promise.resolve(9)) as unknown as
            (value: number | undefined) => number)).rejects.toMatchObject({ name: 'DataCloneError' });
        expect(await get<number>(key)).toBe(4);
        await set(key, 7);
        expect(await get<number>(key)).toBe(7);
    });
    it('stores detached values and returns detached copies on each read', async () => {
        const key = 'mock-structured-clone-isolation';
        const input = { nested: { count: 1 }, items: [1] };
        await set(key, input);
        input.nested.count = 99;
        input.items.push(2);
        const read = await get<typeof input>(key);
        expect(read).toEqual({ nested: { count: 1 }, items: [1] });
        read!.nested.count = 42;
        read!.items.push(3);
        expect(await get(key)).toEqual({ nested: { count: 1 }, items: [1] });
    });

    it('rolls back in-place updater mutations when its transaction rejects', async () => {
        const key = 'mock-update-rollback';
        await set(key, { nested: { count: 1 } });
        await expect(update<{ nested: { count: number } }>(key, current => {
            if (!current) throw new Error('Missing transaction input');
            current.nested.count = 99;
            throw new Error('Interrupted update');
        })).rejects.toThrow('Interrupted update');
        expect(await get(key)).toEqual({ nested: { count: 1 } });
        await update<{ nested: { count: number } }>(key, current => ({
            nested: { count: (current?.nested.count ?? 0) + 1 },
        }));
        expect(await get(key)).toEqual({ nested: { count: 2 } });
    });

    it('rejects uncloneable set and update results without corrupting an existing value', async () => {
        const key = 'mock-uncloneable-write';
        await set(key, { count: 1 });
        await expect(set(key, { callback: () => 1 })).rejects.toMatchObject({ name: 'DataCloneError' });
        expect(await get(key)).toEqual({ count: 1 });
        await expect(update<{ count: number }>(key, current => {
            if (!current) throw new Error('Missing transaction input');
            current.count = 99;
            return { ...current, callback: () => 2 };
        })).rejects.toMatchObject({ name: 'DataCloneError' });
        expect(await get(key)).toEqual({ count: 1 });
        await set(key, { count: 2 });
        expect(await get(key)).toEqual({ count: 2 });
    });

    it('distinguishes a stored null from an absent key', async () => {
        const key = 'explicit-null-regression';
        expect(await get(key)).toBeUndefined();
        await set(key, null);
        expect(Object.prototype.hasOwnProperty.call(idbStore, key)).toBe(true);
        expect(await get(key)).toBeNull();
        await del(key);
        expect(await get(key)).toBeUndefined();
    });

});
