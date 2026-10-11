import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncTimeoutError } from '../../src/lib/db/db_core';
import { loadHistoryMonths } from '../../src/lib/db/db_training';
import { loadNutritionMonths } from '../../src/lib/db/db_nutrition';

const firestore = vi.hoisted(() => ({ getDoc: vi.fn() }));

vi.mock('../../src/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
    getDoc: firestore.getDoc,
}));

const syncMeta = {
    protocolVersion: 3,
    clock: {},
    fields: {},
    writer: { slot: 's00', replicaId: 'monthly-read-test', generation: 1, seq: 0 },
};

function snapshot(business: Record<string, unknown>, version = 1) {
    return {
        exists: () => true,
        data: () => ({ ...business, _schemaVersion: version, _sync: syncMeta }),
    };
}

function draft() {
    return {
        history: [] as unknown[],
        nutrition: {} as Record<string, unknown>,
    };
}

const owner = { uid: 'owner-1' };
const cloudDocuments = () => new Map<string, Record<string, unknown>>();

beforeEach(() => {
    firestore.getDoc.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('monthly Firestore read boundaries', () => {
    it('loads only existing history shards, preserves valid records and their causal metadata', async () => {
        const data = draft();
        const documents = cloudDocuments();
        firestore.getDoc.mockImplementation(async (path: string) => {
            if (path.endsWith('/2026-06')) return { exists: () => false };
            return snapshot({
                good: { id: 'good', date: '2026-05-10', exercises: [] },
                damaged: { id: 'another-id', date: '2026-05-11', exercises: [] },
                nullEntry: null,
                wrongMonth: { id: 'wrongMonth', date: '2026-04-10', exercises: [] },
            });
        });

        await loadHistoryMonths(owner, ['2026-06', '2026-05'], data, documents);

        expect(firestore.getDoc).toHaveBeenCalledTimes(2);
        expect(firestore.getDoc.mock.calls.map(([path]) => path)).toEqual([
            'users/owner-1/history_months/2026-06',
            'users/owner-1/history_months/2026-05',
        ]);
        expect(data.history).toHaveLength(1);
        expect(data.history[0]).toMatchObject({ id: 'good', date: '2026-05-10' });
        expect(documents.has('history_months/2026-06')).toBe(false);
        expect(documents.get('history_months/2026-05')).toMatchObject({
            good: { id: 'good' },
            _sync: syncMeta,
        });
        expect(documents.get('history_months/2026-05')).not.toHaveProperty('damaged');
    });

    it('keeps only canonical nutrition dates in their original monthly shard', async () => {
        const data = draft();
        const documents = cloudDocuments();
        firestore.getDoc.mockResolvedValue(snapshot({
            '2026-05-03': { date: '2026-05-03', weight: 74 },
            '2026-05-04': { date: '2026-05-05', weight: 75 },
            '2026-04-30': { date: '2026-04-30', weight: 73 },
            '2026-05-99': { date: '2026-05-99', weight: 75 },
            '2026-05-07': null,
        }));

        await loadNutritionMonths(owner, ['2026-05'], data, documents);

        expect(data.nutrition).toEqual({ '2026-05-03': { date: '2026-05-03', weight: 74 } });
        expect(documents.get('nutrition_months/2026-05')).toEqual({
            '2026-05-03': { date: '2026-05-03', weight: 74 },
            _sync: syncMeta,
        });
    });

    it('fails closed on an unsupported future data schema, then succeeds after correction', async () => {
        const data = draft();
        const documents = cloudDocuments();
        firestore.getDoc.mockResolvedValueOnce(snapshot({
            safe: { id: 'safe', date: '2026-05-11', exercises: [] },
        }, 999));

        await expect(loadHistoryMonths(owner, ['2026-05'], data, documents)).rejects.toThrow();
        expect(data.history).toEqual([]);
        expect(documents.size).toBe(0);

        firestore.getDoc.mockResolvedValueOnce(snapshot({
            safe: { id: 'safe', date: '2026-05-11', exercises: [] },
        }));
        await loadHistoryMonths(owner, ['2026-05'], data, documents);
        expect(data.history).toHaveLength(1);
    });

    it('does not apply partially resolved months when a parallel Firestore read rejects', async () => {
        const data = draft();
        const documents = cloudDocuments();
        firestore.getDoc.mockImplementation((path: string) => path.endsWith('/2026-06')
            ? Promise.reject(new Error('Firestore temporarily unavailable'))
            : Promise.resolve(snapshot({
                safe: { id: 'safe', date: '2026-05-11', exercises: [] },
            })));

        await expect(loadHistoryMonths(owner, ['2026-05', '2026-06'], data, documents))
            .rejects.toThrow('Firestore temporarily unavailable');
        expect(data.history).toEqual([]);
        expect(documents.size).toBe(0);

        firestore.getDoc.mockReset();
        firestore.getDoc.mockResolvedValue(snapshot({
            safe: { id: 'safe', date: '2026-05-11', exercises: [] },
        }));
        await loadHistoryMonths(owner, ['2026-05'], data, documents);
        expect(data.history).toHaveLength(1);
    });

    it('propagates a timeout without publishing incomplete nutrition results', async () => {
        vi.useFakeTimers();
        const data = draft();
        const documents = cloudDocuments();
        firestore.getDoc.mockImplementation(() => new Promise(() => {}));

        const loading = loadNutritionMonths(owner, ['2026-05'], data, documents);
        const assertion = expect(loading).rejects.toBeInstanceOf(SyncTimeoutError);
        await vi.advanceTimersByTimeAsync(6000);
        await assertion;

        expect(data.nutrition).toEqual({});
        expect(documents.size).toBe(0);
    });
});
