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
});
