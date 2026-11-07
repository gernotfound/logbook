import { describe, expect, it } from 'vitest';
import { get, set, update } from 'idb-keyval';

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

    it('rejects an asynchronous transaction updater without changing durable data', async () => {
        const key = 'mock-atomic-async-rejection';
        await set(key, 4);
        await expect(update<number>(key, (() => Promise.resolve(9)) as unknown as
            (value: number | undefined) => number)).rejects.toMatchObject({ name: 'DataCloneError' });
        expect(await get<number>(key)).toBe(4);
    });
});
