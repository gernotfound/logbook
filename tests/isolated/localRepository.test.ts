import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get, set } from 'idb-keyval';
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';
import { hydrateLocal, commitLocal, initializeLocal, preserveLegacyCache, readLocal } from '../../src/lib/sync/localRepository';

const data = (height: number) => UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;
beforeEach(() => clear());
afterEach(() => vi.restoreAllMocks());

describe('durable owner-scoped journal', () => {
    it('does not resurrect a remote deletion in a complete month and preserves unloaded history', async () => {
        const base = UserDataSchema.parse({ nutrition: { '2026-09-01': { date: '2026-09-01', weight: 80 }, '2025-01-01': { date: '2025-01-01', weight: 70 } } }) as unknown as UserData;
        await initializeLocal('a', base);
        // In V3, cloudData already contains the merged unloaded history from the local cache.
        const cloudWithUnloaded = { ...data(170), nutrition: { '2025-01-01': { date: '2025-01-01', weight: 70 } } } as unknown as UserData;
        const hydrated = await hydrateLocal('a', cloudWithUnloaded, ['2026-09']);
        expect(hydrated.data.nutrition?.['2026-09-01']).toBeUndefined();
        expect(hydrated.data.nutrition?.['2025-01-01']?.weight).toBe(70);
        expect(hydrated.completeMonths).toEqual(['2026-09']);
    });

    it('rejects a quota failure without changing the previous data or journal', async () => {
        await initializeLocal('a', data(170));
        const before = await readLocal('a');
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
        await expect(commitLocal('a', data(171), data(170))).rejects.toThrow('Quota exceeded');
        expect(await readLocal('a')).toEqual(before);
    });

    it('isolates accounts and guest, and protects pending changes from hydration', async () => {
        await commitLocal('a', data(171), data(170));
        await commitLocal('b', data(180), data(179));
        await commitLocal('guest', data(160), data(159));
        await initializeLocal('a', data(120));
        expect((await readLocal('a'))?.data.profile.height).toBe('171');
        expect((await readLocal('b'))?.data.profile.height).toBe('180');
        expect((await readLocal('guest'))?.pending).toEqual([]);
    });

    it('preserves an unowned legacy cache without silently assigning it', async () => {
        await set('logbook_cached_user_data', data(175));
        expect(await preserveLegacyCache()).toBe(true);
        expect(await get('logbook:recovery:legacy')).toEqual(data(175));
        expect(await readLocal('a')).toBeUndefined();
    });

    it('rejects corrupt envelope ownership and preserves the original bytes', async () => {
        const corrupt = { owner: 'user:b', version: 3, revision: 1, data: 'corrupt' };
        await set('logbook:v2:user:a', corrupt);
        await expect(commitLocal('a', data(171), data(170))).rejects.toThrow('recupero');
        expect(await get('logbook:v2:user:a')).toEqual(corrupt);
    });
});
