import { describe, expect, it } from 'vitest';
import { UserDataSchema } from '../../src/lib/schema';
import { applyRemoteDocuments, type DocumentData } from '../../src/lib/sync/documentProjection';
import type { CachedGlobalCatalog, UserData, WorkoutSession } from '../../src/types';

const catalog: CachedGlobalCatalog = {
    manifest: {
        version: 'monthly-batch-fixture', updatedAt: '2026-11-09T00:00:00Z', schemaVersion: 1,
        docRefs: { exercises: 'catalog/exercises', foods: 'catalog/foods' },
        itemCounts: { exercises: 0, foods: 0 },
    },
    exercises: [], foods: [], cachedAt: 0,
};
const workout = (id: string, date: string): WorkoutSession => ({
    id, date, routineName: id, exercises: [],
});
const day = (date: string, weight: number) => ({
    date, weight, kcal: 2000, carbs: 200, pro: 150, fat: 65,
});
const state = (history: WorkoutSession[] = [], nutrition: Record<string, ReturnType<typeof day>> = {}): UserData =>
    UserDataSchema.parse({ history, nutrition }) as unknown as UserData;

describe('batch monthly cloud projection', () => {
    it('replaces many interleaved months once without changing untouched data or shard traversal order', () => {
        const months = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`);
        const localHistory = [
            workout('future-untouched', '2027-01-02'),
            ...months.map((month, index) => workout(`local-${index}`, `${month}-15`)),
            workout('past-untouched', '2025-12-31'),
        ];
        const localNutrition = Object.fromEntries([
            ['2027-01-02', day('2027-01-02', 87)],
            ...months.map((month, index) => [`${month}-15`, day(`${month}-15`, 80 + index)] as const),
            ['2025-12-31', day('2025-12-31', 75)],
        ]);
        const original = state(localHistory, localNutrition);
        const snapshot = structuredClone(original);
        const docs = new Map<string, DocumentData>();
        const reversed = [...months].reverse();
        for (const month of reversed) {
            const newWorkout = workout(`cloud-${month}`, `${month}-20`);
            docs.set(`nutrition_months/${month}`, { [`${month}-20`]: day(`${month}-20`, 91) });
            docs.set(`history_months/${month}`, { [String(newWorkout.id)]: newWorkout });
        }

        const result = applyRemoteDocuments(original, docs, catalog);
        expect((result.history ?? []).map(item => item.id)).toEqual([
            'future-untouched', 'past-untouched', ...reversed.map(month => `cloud-${month}`),
        ]);
        expect(Object.keys(result.nutrition ?? {})).toEqual([
            '2027-01-02', '2025-12-31', ...reversed.map(month => `${month}-20`),
        ]);
        expect(result.nutrition?.['2027-01-02']?.weight).toBe(87);
        expect(result.nutrition?.['2026-01-20']?.weight).toBe(91);
        expect(original).toEqual(snapshot);
    });

    it('preserves unrelated months when a confirmed monthly document is empty', () => {
        const original = state([
            workout('jan', '2026-01-08'), workout('feb', '2026-02-09'), workout('march', '2026-03-10'),
        ], {
            '2026-01-08': day('2026-01-08', 75),
            '2026-02-09': day('2026-02-09', 76),
            '2026-03-10': day('2026-03-10', 77),
        });
        const docs = new Map<string, DocumentData>([
            ['history_months/2026-02', {}],
            ['nutrition_months/2026-02', {}],
        ]);
        const result = applyRemoteDocuments(original, docs, catalog);
        expect((result.history ?? []).map(item => item.id)).toEqual(['jan', 'march']);
        expect(Object.keys(result.nutrition ?? {})).toEqual(['2026-01-08', '2026-03-10']);
        expect((original.history ?? []).map(item => item.id)).toEqual(['jan', 'feb', 'march']);
    });

    it('keeps quarantine behavior when a monthly document contains an identity mismatch', () => {
        const original = state([workout('old', '2026-01-01')]);
        const docs = new Map<string, DocumentData>([
            ['history_months/2026-01', {
                wrong: workout('different-id', '2026-01-09'),
                good: workout('good', '2026-01-10'),
            }],
        ]);
        const result = applyRemoteDocuments(original, docs, catalog);
        expect((result.history ?? []).map(item => item.id)).toEqual(['good']);
    });
});
