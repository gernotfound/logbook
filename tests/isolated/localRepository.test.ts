import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';
import { hydrateLocal, commitLocal, initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import {
    CURRENT_DATA_SCHEMA,
    CURRENT_LOCAL_ENVELOPE,
    CURRENT_SYNC_PROTOCOL,
    FutureVersionError,
    LegacyVersionError,
} from '../../src/lib/schemaEvolution';

const data = (height: number) => UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;
beforeEach(() => clear());
afterEach(() => vi.restoreAllMocks());

describe('durable owner-scoped journal', () => {
    it('writes independent current envelope/data/sync versions', async () => {
        await initializeLocal('a', data(170));
        expect(await readLocal('a')).toMatchObject({
            version: CURRENT_LOCAL_ENVELOPE,
            dataSchemaVersion: CURRENT_DATA_SCHEMA,
            syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
            owner: 'user:a',
        });
    });

    it('rejects pre-M1 and future local envelopes without rewriting their bytes', async () => {
        const legacy = { owner: 'user:a', version: CURRENT_LOCAL_ENVELOPE - 1 };
        await set('logbook:v2:user:a', legacy);
        await expect(readLocal('a')).rejects.toThrow(LegacyVersionError);
        expect(await get('logbook:v2:user:a')).toEqual(legacy);

        const future = { owner: 'user:a', version: CURRENT_LOCAL_ENVELOPE + 1 };
        await set('logbook:v2:user:a', future);
        await expect(readLocal('a')).rejects.toThrow(FutureVersionError);
        expect(await get('logbook:v2:user:a')).toEqual(future);
    });

    it('does not resurrect a remote deletion in a complete window and preserves unloaded history', async () => {
        const base = UserDataSchema.parse({ nutrition: {
            '2026-09-01': { date: '2026-09-01', weight: 80 },
            '2025-01-01': { date: '2025-01-01', weight: 70 }
        } }) as unknown as UserData;
        await initializeLocal('a', base);

        const cloudWindow = { ...data(170) } as unknown as UserData;
        const hydrated = await hydrateLocal('a', cloudWindow, ['2026-09']);

        expect(hydrated.data.nutrition?.['2026-09-01']).toBeUndefined();
        expect(hydrated.data.nutrition?.['2025-01-01']?.weight).toBe(70);
        expect(hydrated.completeMonths).toEqual(['2026-09']);
    });

    it('treats exhaustive hydration as authoritative for every monthly shard', async () => {
        const base = UserDataSchema.parse({ nutrition: {
            '2025-01-01': { date: '2025-01-01', weight: 70 },
            '2026-09-01': { date: '2026-09-01', weight: 80 }
        } }) as unknown as UserData;
        await initializeLocal('a', base, ['2025-01', '2026-09']);

        const cloud = UserDataSchema.parse({ nutrition: {
            '2026-09-01': { date: '2026-09-01', weight: 81 }
        } }) as unknown as UserData;
        const hydrated = await hydrateLocal('a', cloud, ['2026-09'], undefined, 'all');

        expect(hydrated.data.nutrition?.['2025-01-01']).toBeUndefined();
        expect(hydrated.data.nutrition?.['2026-09-01']?.weight).toBe(81);
        expect(hydrated.completeMonths).toEqual(['2026-09']);
    });

    it('emits parent tombstones when a workout or nutrition day is deleted', async () => {
        const base = UserDataSchema.parse({
            history: [{ id: 'w1', date: '2026-09-10', routineName: 'A', duration: '20m', exercises: [] }],
            nutrition: { '2026-09-10': { date: '2026-09-10', weight: 80 } }
        }) as unknown as UserData;
        const desired = UserDataSchema.parse({ history: [], nutrition: {} }) as unknown as UserData;

        await initializeLocal('a', base);
        const operations = await commitLocal('a', desired, base);

        const workoutDeletes = operations.filter(op => op.docPath === 'history_months/2026-09');
        const nutritionDeletes = operations.filter(op => op.docPath === 'nutrition_months/2026-09');
        expect(workoutDeletes).toEqual([expect.objectContaining({ path: ['w1'], isDelete: true })]);
        expect(nutritionDeletes).toEqual([expect.objectContaining({ path: ['2026-09-10'], isDelete: true })]);
    });

    it('does not advance actorSeq for a semantic no-op', async () => {
        const initial = data(170);
        await initializeLocal('a', initial);
        const before = await readLocal('a');

        const operations = await commitLocal('a', initial, initial);
        const after = await readLocal('a');

        expect(operations).toEqual([]);
        expect(after?.actorSeq).toBe(before?.actorSeq);
        expect(after?.clock).toEqual(before?.clock);
        expect(after?.pending).toEqual(before?.pending);
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

    it('rejects corrupt envelope ownership and preserves the original bytes', async () => {
        const corrupt = { owner: 'user:b', version: 3, revision: 1, data: 'corrupt' };
        await set('logbook:v2:user:a', corrupt);
        await expect(commitLocal('a', data(171), data(170))).rejects.toThrow('recupero');
        expect(await get('logbook:v2:user:a')).toEqual(corrupt);
    });
});
