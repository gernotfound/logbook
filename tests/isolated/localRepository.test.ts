import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get, set } from 'idb-keyval';
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';
import { acknowledgeLocal, hydrateLocal, commitLocal, initializeLocal, preserveLegacyCache, readLocal } from '../../src/lib/sync/localRepository';

const data = (height: number) => UserDataSchema.parse({ profile: { height } }) as unknown as UserData;
beforeEach(() => clear());
afterEach(() => vi.restoreAllMocks());

describe('durable owner-scoped journal', () => {
    it('does not resurrect a remote deletion in a complete month and preserves unloaded history', async () => {
        const base = UserDataSchema.parse({ nutrition: { '2026-09-01': { date: '2026-09-01', weight: 80 }, '2025-01-01': { date: '2025-01-01', weight: 70 } } }) as unknown as UserData;
        await initializeLocal('a', base);
        const hydrated = await hydrateLocal('a', data(170), ['2026-09']);
        expect(hydrated.data.nutrition?.['2026-09-01']).toBeUndefined();
        expect(hydrated.data.nutrition?.['2025-01-01']?.weight).toBe(70);
        expect(hydrated.completeMonths).toEqual(['2026-09']);
    });
    it('reapplies independent pending changes during hydration and preserves a real collision', async () => {
        const base = data(170);
        await initializeLocal('a', base);
        await commitLocal('a', data(171), base);
        const remote = UserDataSchema.parse({ profile: { height: 170, gender: 'F' } }) as unknown as UserData;
        const merged = await hydrateLocal('a', remote, ['2026-09']);
        expect(merged.data.profile).toMatchObject({ height: '171', gender: 'F' });
        expect(merged.pending).toHaveLength(1);
        expect(merged.conflicts).toEqual([]);
        const collided = await hydrateLocal('a', data(172), ['2026-09']);
        expect(collided.conflicts).toContainEqual({ path: ['profile', 'height'], base: '170', local: '171', remote: '172' });
        expect(collided.pending).toHaveLength(1);
    });
    it('rejects a quota failure without changing the previous data or journal', async () => {
        await initializeLocal('a', data(170));
        const before = await readLocal('a');
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
        await expect(commitLocal('a', data(171), data(170))).rejects.toThrow('Quota exceeded');
        expect(await readLocal('a')).toEqual(before);
    });
    it('atomically retains data and ordered operations across readers', async () => {
        await initializeLocal('a', data(170));
        const [one, two] = await Promise.all([commitLocal('a', data(171), data(170)), commitLocal('a', data(172), data(171))]);
        const saved = await readLocal('a');
        expect(saved?.pending.map(op => op.id)).toEqual([one.id, two.id]);
        expect(saved?.data.profile.height).toBe('172');
        expect(saved?.pending[1].base.profile.height).toBe('171');
        await acknowledgeLocal('a', one.id, data(171));
        expect((await readLocal('a'))?.data.profile.height).toBe('172');
        await acknowledgeLocal('a', two.id, data(172));
        expect((await readLocal('a'))?.pending).toEqual([]);
    });
    it('merges independent changes from stale tabs without erasing the first tab edit', async () => {
        const base = data(170);
        await initializeLocal('a', base);
        await Promise.all([
            commitLocal('a', { ...base, profile: { ...base.profile, height: '171' } }, base),
            commitLocal('a', { ...base, profile: { ...base.profile, gender: 'M' } }, base),
        ]);
        expect((await readLocal('a'))?.data.profile).toMatchObject({ height: '171', gender: 'M' });
        expect((await readLocal('a'))?.conflicts).toEqual([]);
    });
    it('preserves both alternatives when two stale tabs change the same field', async () => {
        await initializeLocal('a', data(170));
        await commitLocal('a', data(171), data(170));
        await commitLocal('a', data(172), data(170));
        expect((await readLocal('a'))?.conflicts).toEqual([{ path: ['profile', 'height'], base: '170', local: '172', remote: '171' }]);
        expect((await readLocal('a'))?.pending).toHaveLength(2);
    });
    it('rejects out-of-order acknowledgements without dropping either edit', async () => {
        await commitLocal('a', data(171), data(170));
        const second = await commitLocal('a', data(172), data(170));
        await expect(acknowledgeLocal('a', second.id, data(172))).rejects.toThrow('fuori ordine');
        expect((await readLocal('a'))?.pending).toHaveLength(2);
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
        const corrupt = { owner: 'b', version: 2, revision: 1, data: 'corrupt' };
        await set('logbook:v2:a', corrupt);
        await expect(commitLocal('a', data(171), data(170))).rejects.toThrow('recupero');
        expect(await get('logbook:v2:a')).toEqual(corrupt);
    });
});
