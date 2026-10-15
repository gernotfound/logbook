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
    it('fails closed on a damaged history entry without publishing an incomplete month, then recovers on retry', async () => {
        const data = draft();
        const documents = cloudDocuments();
        firestore.getDoc.mockImplementation(async (path: string) => {
            if (path.endsWith('/2026-06')) return { exists: () => false };
            return snapshot({
                good: { id: 'good', date: '2026-05-10', exercises: [] },
                damaged: { id: 'another-id', date: '2026-05-11', exercises: [] },
            });
        });

        await expect(loadHistoryMonths(owner, ['2026-06', '2026-05'], data, documents))
            .rejects.toThrow('Shard storico 2026-05 non integro');
        expect(data.history).toEqual([]);
        expect(documents.size).toBe(0);

        firestore.getDoc.mockReset();
        firestore.getDoc.mockResolvedValue(snapshot({ good: { id: 'good', date: '2026-05-10', exercises: [] } }));
        await loadHistoryMonths(owner, ['2026-05'], data, documents);
        expect(data.history).toHaveLength(1);
        expect(documents.get('history_months/2026-05')).toMatchObject({ good: { id: 'good' }, _sync: syncMeta });
    });

    it('fails closed on a damaged nutrition date without publishing partial days, then recovers on retry', async () => {
        const data = draft();
        const documents = cloudDocuments();
        firestore.getDoc.mockResolvedValue(snapshot({
            '2026-05-03': { date: '2026-05-03', weight: 74 },
            '2026-05-04': { date: '2026-05-05', weight: 75 },
        }));

        await expect(loadNutritionMonths(owner, ['2026-05'], data, documents))
            .rejects.toThrow('Shard nutrizione 2026-05 non integro');
        expect(data.nutrition).toEqual({});
        expect(documents.size).toBe(0);

        firestore.getDoc.mockReset();
        firestore.getDoc.mockResolvedValue(snapshot({ '2026-05-03': { date: '2026-05-03', weight: 74 } }));
        await loadNutritionMonths(owner, ['2026-05'], data, documents);
        expect(data.nutrition['2026-05-03']).toMatchObject({ date: '2026-05-03', weight: 74 });
        expect(documents.get('nutrition_months/2026-05')).toHaveProperty('_sync', syncMeta);
    });

    it('blocks a nutrition day with quarantined nested meal identities before any hydration', async () => {
        const data = draft();
        const documents = cloudDocuments();
        firestore.getDoc.mockResolvedValue(snapshot({
            '2026-05-03': {
                date: '2026-05-03',
                meals: [
                    { id: 'valid', name: 'Riso', meal: 'pranzo', quantity: 100, kcal: 100, carbs: 20, pro: 2, fat: 0 },
                    { id: '', name: 'Corrotto', meal: 'pranzo', quantity: 100, kcal: 100, carbs: 20, pro: 2, fat: 0 },
                ],
            },
        }));
        await expect(loadNutritionMonths(owner, ['2026-05'], data, documents))
            .rejects.toThrow('record annidati non validi');
        expect(data.nutrition).toEqual({});
        expect(documents.size).toBe(0);
    });

    it('refuses damaged nested workout sets and segments before treating a shard as complete', async () => {
        const state = draft();
        const docs = cloudDocuments();
        firestore.getDoc.mockResolvedValue(snapshot({
            w: { id: 'w', date: '2026-05-11', exercises: [
                { exId: 'e1', sets: [{ id: 's1', segments: [
                    { id: 'good', kg: '10', reps: '10' },
                    { id: '', kg: '12', reps: '8' },
                ] }] },
            ] },
        }));
        await expect(loadHistoryMonths(owner, ['2026-05'], state, docs))
            .rejects.toThrow('elenco w/sets/segments incompleto');
        expect(state.history).toEqual([]);
        expect(docs.size).toBe(0);
    });

    it('does not publish an earlier valid shard if a later history shard is malformed', async () => {
        const state = draft();
        const docs = cloudDocuments();
        firestore.getDoc.mockImplementation(async (path: string) => path.endsWith('2026-05')
            ? snapshot({ safe: { id: 'safe', date: '2026-05-10', exercises: [] } })
            : snapshot({ corrupt: { id: 'wrong', date: '2026-06-10', exercises: [] } }));
        await expect(loadHistoryMonths(owner, ['2026-05', '2026-06'], state, docs)).rejects.toThrow('Shard storico 2026-06 non integro');
        expect(state.history).toEqual([]);
        expect(docs.size).toBe(0);
    });

    it('does not publish an earlier nutrition month if a later month contains damaged nested data', async () => {
        const state = draft();
        const docs = cloudDocuments();
        firestore.getDoc.mockImplementation(async (path: string) => path.endsWith('2026-05')
            ? snapshot({ '2026-05-01': { date: '2026-05-01', weight: 70 } })
            : snapshot({ '2026-06-01': { date: '2026-06-02', weight: 71 } }));
        await expect(loadNutritionMonths(owner, ['2026-05', '2026-06'], state, docs)).rejects.toThrow('Shard nutrizione 2026-06 non integro');
        expect(state.nutrition).toEqual({});
        expect(docs.size).toBe(0);
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

    it('keeps nutrition state untouched when one monthly fetch fails, then loads on retry', async () => {
        const data = draft();
        const documents = cloudDocuments();
        firestore.getDoc.mockImplementation((path: string) => path.endsWith('/2026-06')
            ? Promise.reject(new Error('Temporary nutrition fetch failure'))
            : Promise.resolve(snapshot({
                '2026-05-03': { date: '2026-05-03', weight: 74 },
            })));

        await expect(loadNutritionMonths(owner, ['2026-05', '2026-06'], data, documents))
            .rejects.toThrow('Temporary nutrition fetch failure');
        expect(data.nutrition).toEqual({});
        expect(documents.size).toBe(0);

        firestore.getDoc.mockReset();
        firestore.getDoc.mockResolvedValue(snapshot({
            '2026-05-03': { date: '2026-05-03', weight: 74 },
        }));
        await loadNutritionMonths(owner, ['2026-05'], data, documents);
        expect(Object.keys(data.nutrition)).toEqual(['2026-05-03']);
        expect(data.nutrition).toMatchObject({ '2026-05-03': { date: '2026-05-03', weight: 74 } });
        expect(data.nutrition['2026-05-03']).toHaveProperty('meals', []);
        expect(documents.get('nutrition_months/2026-05')).toMatchObject({
            '2026-05-03': { date: '2026-05-03' },
            _sync: syncMeta,
        });
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
